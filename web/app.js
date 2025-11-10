const STORAGE_KEY = 'hookah-table-manager-state-v6';
const PREFERENCES_KEY = 'hookah-table-manager-preferences-v2';
const TABLE_NAMES = [
  'Стол 1',
  'Стол 2',
  'Стол 3',
  'Стол 4',
  'Стол 5',
  'Стол 6',
  'Стол 7',
  'Стол 8',
  'Стол 9',
  'Стол 10',
  'Стол 11',
  'Стол 12',
  'Стол 13',
  'Стол 14',
  'Бар №1',
  'Бар №2',
  'Бар №3',
  'Бар №4',
  'Стафф',
];
const TABLE_COUNT = TABLE_NAMES.length;
const HOOKAHS_PER_TABLE = 8;
const DEFAULT_ENABLED_HOOKAHS = 2;
const MIN_ENABLED_HOOKAHS = 1;
const SESSION_DURATION_MINUTES = 120;
const DEFAULT_INTERVAL_MINUTES = 20;
const FREQUENCY_OPTIONS = [1, 5, 10, 15, 20, 25];
const WARNING_THRESHOLD_MS = 3 * 60 * 1000;

const tableContainer = document.querySelector('[data-table-list]');
const clearLogButton = document.querySelector('[data-action="clear-log"]');
const logList = document.querySelector('[data-log-list]');
const cardTemplate = document.getElementById('table-card-template');
const chipTemplate = document.getElementById('hookah-chip-template');
const modal = document.querySelector('[data-modal]');
const modalName = modal?.querySelector('[data-modal-name]');
const modalHookahList = modal?.querySelector('[data-modal-hookah-list]');
const modalFreeButton = modal?.querySelector('[data-role="free"]');
const modalAddHookahButton = modal?.querySelector('[data-action="add-hookah"]');
const modalRemoveHookahButton = modal?.querySelector('[data-action="remove-hookah"]');
const notificationsPanel = document.querySelector('[data-notifications-panel]');
const notificationsToggle = document.querySelector('[data-toggle-notifications]');
const bulkRedButton = document.querySelector('[data-bulk-action="red"]');
const bulkRedYellowButton = document.querySelector('[data-bulk-action="red-yellow"]');
const bulkRedCount = document.querySelector('[data-count-red]');
const bulkRedYellowCount = document.querySelector('[data-count-red-yellow]');
const hideInactiveToggle = document.querySelector('[data-hide-inactive]');
const sortByUpcomingToggle = document.querySelector('[data-sort-upcoming]');
const clockNode = document.querySelector('[data-clock]');

let tables = loadTables();
let notifications = [];
let selectedTableId = null;
let notificationsExpanded = false;
let preferences = loadPreferences();
let hideInactiveTables = Boolean(preferences.hideInactive);
let sortByUpcoming = Boolean(preferences.sortByUpcoming);

function createHookah(index) {
  return {
    id: `hookah-${index}`,
    index,
    label: `Кальян ${index}`,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    status: 'idle',
    startedAt: null,
    expectedEndTime: null,
    nextReminderTime: null,
    alertState: 'none',
  };
}

function normalizeEnabledHookahCount(value) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    return DEFAULT_ENABLED_HOOKAHS;
  }
  return Math.min(HOOKAHS_PER_TABLE, Math.max(MIN_ENABLED_HOOKAHS, Math.floor(number)));
}

function ensureHookahDefaults(rawHookah, index) {
  const base = createHookah(index + 1);
  if (!rawHookah || typeof rawHookah !== 'object') {
    return base;
  }
  const hookah = { ...base, ...rawHookah };
  hookah.id = base.id;
  hookah.index = base.index;
  hookah.label = base.label;
  if (!FREQUENCY_OPTIONS.includes(Number(hookah.intervalMinutes))) {
    hookah.intervalMinutes = DEFAULT_INTERVAL_MINUTES;
  } else {
    hookah.intervalMinutes = Number(hookah.intervalMinutes);
  }
  if (!['idle', 'active', 'completed'].includes(hookah.status)) {
    hookah.status = 'idle';
  }
  hookah.startedAt = typeof hookah.startedAt === 'number' ? hookah.startedAt : null;
  hookah.expectedEndTime = typeof hookah.expectedEndTime === 'number' ? hookah.expectedEndTime : null;
  hookah.nextReminderTime = typeof hookah.nextReminderTime === 'number' ? hookah.nextReminderTime : null;
  hookah.alertState = hookah.alertState === 'due' ? 'due' : 'none';
  return hookah;
}

function getTableName(index) {
  return TABLE_NAMES[index] ?? `Стол ${index + 1}`;
}

function getTableKind(name) {
  if (typeof name !== 'string') {
    return 'table';
  }
  if (name.startsWith('Бар')) {
    return 'bar';
  }
  if (name === 'Стафф') {
    return 'staff';
  }
  return 'table';
}

function createTable(index) {
  const name = getTableName(index);
  return {
    id: `table-${index + 1}`,
    name,
    kind: getTableKind(name),
    enabledHookahCount: DEFAULT_ENABLED_HOOKAHS,
    hookahs: Array.from({ length: HOOKAHS_PER_TABLE }, (_, hookahIndex) => createHookah(hookahIndex + 1)),
    sessionExpired: false,
  };
}

function ensureTableDefaults(rawTable, index) {
  const base = createTable(index);
  if (!rawTable || typeof rawTable !== 'object') {
    return base;
  }
  const table = { ...base, ...rawTable };
  table.id = base.id;
  table.name = base.name;
  table.kind = getTableKind(table.name);
  const hookahs = Array.isArray(rawTable.hookahs) ? rawTable.hookahs : [];
  table.hookahs = Array.from({ length: HOOKAHS_PER_TABLE }, (_, hookahIndex) => {
    const stored = hookahs[hookahIndex];
    return ensureHookahDefaults(stored, hookahIndex);
  });
  const inferredCount = (() => {
    if (typeof rawTable.enabledHookahCount !== 'undefined') {
      return normalizeEnabledHookahCount(rawTable.enabledHookahCount);
    }
    const highestUsed = table.hookahs.reduce((max, hookah, hookahIndex) => {
      if (!hookah) {
        return max;
      }
      const isUsed =
        hookah.status !== 'idle' ||
        hookah.startedAt != null ||
        hookah.expectedEndTime != null ||
        hookah.nextReminderTime != null;
      return isUsed ? Math.max(max, hookahIndex + 1) : max;
    }, DEFAULT_ENABLED_HOOKAHS);
    return highestUsed;
  })();
  table.enabledHookahCount = normalizeEnabledHookahCount(inferredCount);
  table.sessionExpired = Boolean(rawTable.sessionExpired);
  syncEnabledHookahCount(table);
  return table;
}

function loadTables() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultTables();
    }
    const parsed = JSON.parse(raw);
    const storedTables = Array.isArray(parsed?.tables) ? parsed.tables : [];
    return Array.from({ length: TABLE_COUNT }, (_, index) => ensureTableDefaults(storedTables[index], index));
  } catch (error) {
    console.warn('Не удалось восстановить состояние, будут использованы значения по умолчанию.', error);
    return createDefaultTables();
  }
}

function createDefaultTables() {
  return Array.from({ length: TABLE_COUNT }, (_, index) => createTable(index));
}

function saveTables() {
  const payload = {
    tables: tables.map((table) => ({
      ...table,
      hookahs: table.hookahs.map((hookah) => ({ ...hookah })),
    })),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch (error) {
    console.warn('Не удалось восстановить настройки, будут использованы значения по умолчанию.', error);
    return {};
  }
}

function savePreferences() {
  preferences = {
    hideInactive: hideInactiveTables,
    sortByUpcoming,
  };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

function setHideInactiveTables(nextValue) {
  hideInactiveTables = Boolean(nextValue);
  if (hideInactiveToggle) {
    hideInactiveToggle.checked = hideInactiveTables;
  }
  savePreferences();
  renderTables();
}

function setSortByUpcomingTables(nextValue) {
  sortByUpcoming = Boolean(nextValue);
  if (sortByUpcomingToggle) {
    sortByUpcomingToggle.checked = sortByUpcoming;
  }
  savePreferences();
  renderTables();
}

function updateClock() {
  if (!clockNode) {
    return;
  }
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  clockNode.textContent = `${dateFormatter.format(now)} ${timeFormatter.format(now)} МСК`;
}

function getModalHookahCount(table) {
  if (!table) {
    return DEFAULT_ENABLED_HOOKAHS;
  }
  return normalizeEnabledHookahCount(table.enabledHookahCount);
}

function getCardHookahCount(table) {
  if (!table) {
    return DEFAULT_ENABLED_HOOKAHS;
  }
  const highestActive = table.hookahs.reduce((max, hookah) => {
    if (!hookah) {
      return max;
    }
    return hookah.status === 'active' ? Math.max(max, hookah.index) : max;
  }, 0);
  const storedCount = normalizeEnabledHookahCount(table.enabledHookahCount);
  const baseline = Math.min(DEFAULT_ENABLED_HOOKAHS, Math.max(storedCount, MIN_ENABLED_HOOKAHS));
  const target = Math.max(baseline, highestActive, MIN_ENABLED_HOOKAHS);
  return Math.min(HOOKAHS_PER_TABLE, target);
}

function getCardHookahs(table) {
  const count = getCardHookahCount(table);
  return table.hookahs.slice(0, count);
}

function getModalHookahs(table) {
  const count = getModalHookahCount(table);
  return table.hookahs.slice(0, count);
}

function syncEnabledHookahCount(table) {
  if (!table) {
    return;
  }
  const highestActive = table.hookahs.reduce((max, hookah) => {
    if (!hookah || hookah.status !== 'active') {
      return max;
    }
    return Math.max(max, hookah.index);
  }, 0);
  let nextCount = normalizeEnabledHookahCount(table.enabledHookahCount);
  if (highestActive <= DEFAULT_ENABLED_HOOKAHS) {
    nextCount = Math.min(nextCount, DEFAULT_ENABLED_HOOKAHS);
  }
  nextCount = Math.max(nextCount, highestActive, MIN_ENABLED_HOOKAHS);
  table.enabledHookahCount = Math.min(HOOKAHS_PER_TABLE, nextCount);
}

function renderTables() {
  if (!tableContainer || !cardTemplate || !chipTemplate) {
    return;
  }
  const now = Date.now();
  let dueCount = 0;
  let dueOrSoonCount = 0;

  tables.forEach((table) => {
    table.hookahs.forEach((hookah) => {
      if (!hookah || hookah.status !== 'active') {
        return;
      }
      const alertLevel = getHookahAlertLevel(hookah, now);
      if (alertLevel === 'due') {
        dueCount += 1;
        dueOrSoonCount += 1;
      } else if (alertLevel === 'soon') {
        dueOrSoonCount += 1;
      }
    });
  });

  const entries = tables.map((table, index) => ({
    table,
    index,
    sortValue: getTableSortValue(table, now),
  }));

  if (sortByUpcoming) {
    entries.sort((a, b) => {
      if (a.sortValue === b.sortValue) {
        return a.index - b.index;
      }
      if (a.sortValue === Number.NEGATIVE_INFINITY) {
        return -1;
      }
      if (b.sortValue === Number.NEGATIVE_INFINITY) {
        return 1;
      }
      const aFinite = Number.isFinite(a.sortValue);
      const bFinite = Number.isFinite(b.sortValue);
      if (aFinite && bFinite) {
        return a.sortValue - b.sortValue;
      }
      if (aFinite) {
        return -1;
      }
      if (bFinite) {
        return 1;
      }
      return a.index - b.index;
    });
  }

  tableContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  entries.forEach(({ table }) => {
    const cardHookahs = getCardHookahs(table);
    const shouldHide =
      hideInactiveTables &&
      !table.sessionExpired &&
      !table.hookahs.some((hookah) => hookah.status === 'active');
    if (shouldHide) {
      return;
    }

    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.tableId = table.id;
    node.dataset.kind = table.kind ?? 'table';
    node.dataset.alert = getTableAlertLevel(table, now);
    if (table.sessionExpired) {
      node.dataset.tableAlert = 'expired';
    } else {
      node.removeAttribute('data-table-alert');
    }

    const nameNode = node.querySelector('[data-name]');
    const summaryNode = node.querySelector('[data-summary]');
    const hookahList = node.querySelector('[data-hookah-list]');
    const alertFooter = node.querySelector('[data-table-alert]');

    if (nameNode) {
      nameNode.textContent = table.name;
    }
    if (summaryNode) {
      summaryNode.textContent = getTableSummary(table, now, table.sessionExpired);
    }
    if (alertFooter) {
      alertFooter.textContent = '';
    }
    if (hookahList) {
      hookahList.innerHTML = '';
      const hookahFragment = document.createDocumentFragment();
      cardHookahs.forEach((hookah) => {
        const hookahNode = chipTemplate.content.firstElementChild.cloneNode(true);
        const alertLevel = getHookahAlertLevel(hookah, now);
        hookahNode.dataset.alert = alertLevel;
        hookahNode.dataset.hookahIndex = hookah.index;

        const indexNode = hookahNode.querySelector('[data-index]');
        const timerNode = hookahNode.querySelector('[data-timer]');

        if (indexNode) {
          indexNode.textContent = String(hookah.index);
        }
        if (timerNode) {
          timerNode.textContent = getHookahTimerText(hookah, now);
        }

        hookahFragment.appendChild(hookahNode);
      });
      hookahList.appendChild(hookahFragment);
    }

    fragment.appendChild(node);
  });

  tableContainer.appendChild(fragment);

  updateBulkControls(dueCount, dueOrSoonCount);

  if (selectedTableId) {
    renderModal();
  }
}

function updateBulkControls(dueCount, dueOrSoonCount) {
  if (bulkRedCount) {
    bulkRedCount.textContent = String(dueCount);
  }
  if (bulkRedYellowCount) {
    bulkRedYellowCount.textContent = String(dueOrSoonCount);
  }
  if (bulkRedButton) {
    bulkRedButton.disabled = dueCount === 0;
  }
  if (bulkRedYellowButton) {
    bulkRedYellowButton.disabled = dueOrSoonCount === 0;
  }
}

function setNotificationsExpanded(expanded) {
  notificationsExpanded = expanded;
  if (notificationsToggle) {
    notificationsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    notificationsToggle.textContent = expanded ? 'Скрыть уведомления' : 'Показать уведомления';
  }
  if (notificationsPanel) {
    notificationsPanel.hidden = !expanded;
    notificationsPanel.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  }
  document.body.classList.toggle('notifications-open', expanded);
}

function getTableSummary(table, now, sessionExpired = false) {
  const activeHookahs = table.hookahs.filter((hookah) => hookah.status === 'active');
  if (activeHookahs.length > 0) {
    const remaining = activeHookahs
      .map((hookah) => (hookah.expectedEndTime ? hookah.expectedEndTime - now : 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (remaining.length > 0) {
      const maxMs = Math.max(...remaining);
      return `Осталось: ${formatTableRemaining(maxMs)}`;
    }
    return 'Осталось: менее минуты';
  }
  if (sessionExpired) {
    return 'Осталось: 0 мин';
  }
  return '—';
}

function getTableAlertLevel(table, now) {
  const levels = getCardHookahs(table).map((hookah) => getHookahAlertLevel(hookah, now));
  if (levels.includes('due')) {
    return 'due';
  }
  if (levels.includes('soon')) {
    return 'soon';
  }
  if (levels.includes('ok')) {
    return 'ok';
  }
  return 'inactive';
}

function getTableSortValue(table, now) {
  if (table.sessionExpired) {
    return Number.NEGATIVE_INFINITY;
  }

  let sortValue = Infinity;
  let hasActive = false;

  table.hookahs.forEach((hookah) => {
    if (!hookah || hookah.status !== 'active') {
      return;
    }
    hasActive = true;
    const alertLevel = getHookahAlertLevel(hookah, now);
    if (alertLevel === 'due') {
      sortValue = Math.min(sortValue, 0);
      return;
    }
    if (hookah.nextReminderTime) {
      const diff = hookah.nextReminderTime - now;
      if (Number.isFinite(diff)) {
        sortValue = Math.min(sortValue, diff);
      }
    }
  });

  if (!hasActive) {
    return Infinity;
  }

  return sortValue;
}

function getHookahAlertLevel(hookah, now) {
  if (hookah.status !== 'active') {
    return 'inactive';
  }
  if (hookah.alertState === 'due') {
    return 'due';
  }
  if (!hookah.nextReminderTime) {
    return 'ok';
  }
  const timeLeft = hookah.nextReminderTime - now;
  if (timeLeft <= 0) {
    return 'due';
  }
  if (timeLeft <= WARNING_THRESHOLD_MS) {
    return 'soon';
  }
  return 'ok';
}

function getHookahTimerText(hookah, now) {
  if (hookah.status !== 'active') {
    return '—';
  }
  if (hookah.alertState === 'due') {
    return 'Замена углей';
  }
  if (!hookah.nextReminderTime) {
    return '—';
  }
  return formatCountdown(hookah.nextReminderTime - now);
}

function getHookahStatusLabel(hookah) {
  switch (hookah.status) {
    case 'active':
      return hookah.alertState === 'due' ? 'Ожидает' : 'Активен';
    case 'completed':
      return 'Завершён';
    default:
      return 'Свободен';
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTableRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'менее минуты';
  }
  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) {
    parts.push(`${hours} ч`);
  }
  if (minutes || parts.length === 0) {
    parts.push(`${minutes} мин`);
  }
  return parts.join(' ');
}

function formatSessionLength(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return `${DEFAULT_INTERVAL_MINUTES} мин`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    const remainder = hours % 10;
    const lastTwo = hours % 100;
    let unit = 'часов';
    if (remainder === 1 && lastTwo !== 11) {
      unit = 'час';
    } else if (remainder >= 2 && remainder <= 4 && (lastTwo < 12 || lastTwo > 14)) {
      unit = 'часа';
    }
    return `${hours} ${unit}`;
  }
  return `${minutes} мин`;
}

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) {
    return '—';
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) {
    parts.push(`${hours} ч`);
  }
  if (hours || minutes) {
    parts.push(`${minutes} мин`);
  }
  parts.push(`${seconds} с`);
  return parts.join(' ');
}

function openTableModal(tableId) {
  if (!modal) {
    return;
  }
  if (selectedTableId && selectedTableId !== tableId) {
    closeTableModal();
  }
  selectedTableId = tableId;
  renderModal();
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const firstButton = modal.querySelector('button');
  firstButton?.focus();
}

function closeTableModal() {
  if (!modal) {
    return;
  }
  let needsRefresh = false;
  if (selectedTableId) {
    const table = tables.find((item) => item.id === selectedTableId);
    if (table) {
      const previousCount = table.enabledHookahCount;
      syncEnabledHookahCount(table);
      if (table.enabledHookahCount !== previousCount) {
        saveTables();
        needsRefresh = true;
      }
    }
  }
  selectedTableId = null;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (needsRefresh) {
    renderTables();
  }
}

function renderModal() {
  if (!modal || !modalHookahList || !selectedTableId) {
    return;
  }
  const table = tables.find((item) => item.id === selectedTableId);
  if (!table) {
    closeTableModal();
    return;
  }
  const now = Date.now();
  const sessionLabel = formatSessionLength(SESSION_DURATION_MINUTES);
  if (modalName) {
    modalName.textContent = table.name;
  }

  modalHookahList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const visibleHookahs = getModalHookahs(table);

  visibleHookahs.forEach((hookah) => {
    const section = document.createElement('section');
    section.className = 'hookah-settings';
    section.dataset.hookahIndex = String(hookah.index);
    section.dataset.alert = getHookahAlertLevel(hookah, now);

    const header = document.createElement('header');
    header.className = 'hookah-settings__header';

    const title = document.createElement('h3');
    title.textContent = hookah.label;

    const badge = document.createElement('span');
    badge.className = `hookah-settings__badge hookah-settings__badge--${hookah.status}`;
    badge.textContent = getHookahStatusLabel(hookah);

    header.append(title, badge);

    const stats = document.createElement('dl');
    stats.className = 'hookah-settings__stats';

    const nextChange = document.createElement('div');
    const nextTitle = document.createElement('dt');
    nextTitle.textContent = 'Следующая смена углей';
    const nextValue = document.createElement('dd');
    if (hookah.status === 'active') {
      if (hookah.alertState === 'due') {
        nextValue.textContent = 'Нужно заменить угли';
      } else if (hookah.nextReminderTime) {
        nextValue.textContent = formatDuration(hookah.nextReminderTime - now);
      } else {
        nextValue.textContent = '—';
      }
    } else {
      nextValue.textContent = '—';
    }
    nextChange.append(nextTitle, nextValue);

    const session = document.createElement('div');
    const sessionTitle = document.createElement('dt');
    sessionTitle.textContent = 'До конца сеанса';
    const sessionValue = document.createElement('dd');
    if (hookah.status === 'active' && hookah.expectedEndTime) {
      sessionValue.textContent = formatDuration(hookah.expectedEndTime - now);
    } else if (hookah.status === 'completed') {
      sessionValue.textContent = 'Сеанс завершён';
    } else {
      sessionValue.textContent = '—';
    }
    session.append(sessionTitle, sessionValue);

    stats.append(nextChange, session);

    const frequencyBlock = document.createElement('div');
    frequencyBlock.className = 'hookah-settings__frequencies';

    const frequencyLabel = document.createElement('p');
    frequencyLabel.className = 'hookah-settings__frequencies-label';
    frequencyLabel.textContent = 'Частота смены углей';
    frequencyBlock.appendChild(frequencyLabel);

    const frequencyGrid = document.createElement('div');
    frequencyGrid.className = 'hookah-settings__intervals';

    FREQUENCY_OPTIONS.forEach((minutes) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.role = 'frequency';
      button.dataset.hookahIndex = String(hookah.index);
      button.dataset.frequency = String(minutes);
      button.textContent = `${minutes} мин`;
      if (minutes === hookah.intervalMinutes) {
        button.classList.add('is-active');
      }
      frequencyGrid.appendChild(button);
    });

    frequencyBlock.appendChild(frequencyGrid);

    const actions = document.createElement('div');
    actions.className = 'hookah-settings__actions';
    let primaryAction = null;

    if (hookah.status === 'active') {
      primaryAction = document.createElement('div');
      primaryAction.className = 'hookah-settings__primary-action';

      const coalButton = document.createElement('button');
      coalButton.type = 'button';
      coalButton.className = 'secondary hookah-settings__coal-button';
      coalButton.dataset.action = 'coal-change';
      coalButton.dataset.hookahIndex = String(hookah.index);
      coalButton.textContent = 'Заменил угли';
      primaryAction.appendChild(coalButton);

      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.className = 'danger';
      stopButton.dataset.action = 'complete-hookah';
      stopButton.dataset.hookahIndex = String(hookah.index);
      stopButton.textContent = 'Завершить сеанс';
      actions.appendChild(stopButton);
    } else {
      const startButton = document.createElement('button');
      startButton.type = 'button';
      startButton.className = 'primary';
      startButton.dataset.action = 'start-hookah';
      startButton.dataset.hookahIndex = String(hookah.index);
      startButton.textContent =
        hookah.status === 'completed'
          ? `Перезапустить ${sessionLabel}`
          : `Запустить ${sessionLabel}`;
      actions.appendChild(startButton);
    }

    const sectionChildren = [header];
    if (primaryAction) {
      sectionChildren.push(primaryAction);
    }
    sectionChildren.push(stats, frequencyBlock);
    if (actions.children.length) {
      sectionChildren.push(actions);
    }
    section.append(...sectionChildren);
    fragment.appendChild(section);
  });

  modalHookahList.appendChild(fragment);

  if (modalFreeButton) {
    const hasBusyHookah = table.hookahs.some((hookah) => hookah.status !== 'idle');
    modalFreeButton.textContent = 'Освободить стол';
    modalFreeButton.hidden = !hasBusyHookah;
    modalFreeButton.dataset.tableId = table.id;
  }

  if (modalAddHookahButton) {
    const canAdd = table.enabledHookahCount < HOOKAHS_PER_TABLE;
    modalAddHookahButton.textContent = canAdd
      ? `Добавить кальян (${table.enabledHookahCount}/${HOOKAHS_PER_TABLE})`
      : `Лимит кальянов достигнут (${table.enabledHookahCount}/${HOOKAHS_PER_TABLE})`;
    modalAddHookahButton.disabled = !canAdd;
  }
  if (modalRemoveHookahButton) {
    const highestActive = table.hookahs.reduce((max, hookah) => {
      if (!hookah) {
        return max;
      }
      return hookah.status === 'active' ? Math.max(max, hookah.index) : max;
    }, 0);
    const minAllowed = Math.max(MIN_ENABLED_HOOKAHS, highestActive);
    const canRemove = table.enabledHookahCount > minAllowed;
    modalRemoveHookahButton.textContent = canRemove
      ? `Удалить кальян (${table.enabledHookahCount}/${HOOKAHS_PER_TABLE})`
      : `Нельзя удалить (${table.enabledHookahCount}/${HOOKAHS_PER_TABLE})`;
    modalRemoveHookahButton.disabled = !canRemove;
  }
}

function getHookahByIndex(table, hookahIndex) {
  const index = Number(hookahIndex) - 1;
  if (Number.isNaN(index) || index < 0 || index >= table.hookahs.length) {
    return null;
  }
  return table.hookahs[index];
}

function startHookah(tableId, hookahIndex) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = getHookahByIndex(table, hookahIndex);
  if (!hookah) {
    return;
  }
  const currentCount = normalizeEnabledHookahCount(table.enabledHookahCount);
  table.enabledHookahCount = Math.max(currentCount, hookah.index);
  const now = Date.now();
  const sessionMs = SESSION_DURATION_MINUTES * 60 * 1000;
  hookah.status = 'active';
  hookah.startedAt = now;
  hookah.expectedEndTime = now + sessionMs;
  hookah.alertState = 'none';
  scheduleNextReminder(hookah, now);
  table.sessionExpired = false;
  saveTables();
  renderTables();
  renderModal();
}

function addHookah(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const nextCount = Math.min(HOOKAHS_PER_TABLE, normalizeEnabledHookahCount(table.enabledHookahCount + 1));
  if (nextCount === table.enabledHookahCount) {
    return;
  }
  table.enabledHookahCount = nextCount;
  renderTables();
  renderModal();
}

function removeHookah(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const currentCount = normalizeEnabledHookahCount(table.enabledHookahCount);
  if (currentCount <= MIN_ENABLED_HOOKAHS) {
    return;
  }
  const highestActive = table.hookahs.reduce((max, hookah) => {
    if (!hookah) {
      return max;
    }
    return hookah.status === 'active' ? Math.max(max, hookah.index) : max;
  }, 0);
  const desiredCount = currentCount - 1;
  const nextCount = Math.max(MIN_ENABLED_HOOKAHS, Math.max(highestActive, desiredCount));
  if (nextCount === currentCount) {
    return;
  }
  for (let index = nextCount; index < HOOKAHS_PER_TABLE; index += 1) {
    const hookah = table.hookahs[index];
    if (!hookah) {
      continue;
    }
    if (hookah.status !== 'active') {
      hookah.status = 'idle';
      hookah.startedAt = null;
      hookah.expectedEndTime = null;
      hookah.nextReminderTime = null;
      hookah.intervalMinutes = FREQUENCY_OPTIONS.includes(hookah.intervalMinutes)
        ? hookah.intervalMinutes
        : DEFAULT_INTERVAL_MINUTES;
      hookah.alertState = 'none';
    }
  }
  table.enabledHookahCount = nextCount;
  saveTables();
  renderTables();
  renderModal();
}

function scheduleNextReminder(hookah, now = Date.now()) {
  if (hookah.expectedEndTime && hookah.expectedEndTime <= now) {
    hookah.nextReminderTime = null;
    return;
  }
  const intervalMs = hookah.intervalMinutes * 60 * 1000;
  const candidate = now + intervalMs;
  hookah.nextReminderTime = hookah.expectedEndTime
    ? Math.min(candidate, hookah.expectedEndTime)
    : candidate;
}

function manualCoalChange(tableId, hookahIndex) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = getHookahByIndex(table, hookahIndex);
  if (!hookah || hookah.status !== 'active') {
    return;
  }
  const now = Date.now();
  if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
    completeHookah(tableId, hookahIndex, { auto: true });
    return;
  }
  hookah.alertState = 'none';
  scheduleNextReminder(hookah, now);
  saveTables();
  renderTables();
  renderModal();
}

function bulkManualCoalChange(includeSoon) {
  const now = Date.now();
  let updated = false;

  tables.forEach((table) => {
    table.hookahs.forEach((hookah) => {
      if (hookah.status !== 'active') {
        return;
      }
      const alert = getHookahAlertLevel(hookah, now);
      if (alert === 'due' || (includeSoon && alert === 'soon')) {
        if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
          return;
        }
        hookah.alertState = 'none';
        scheduleNextReminder(hookah, now);
        updated = true;
      }
    });
  });

  if (updated) {
    saveTables();
    renderTables();
    renderModal();
  }
}

function completeHookah(tableId, hookahIndex, options = {}) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = getHookahByIndex(table, hookahIndex);
  if (!hookah) {
    return;
  }
  hookah.status = 'completed';
  hookah.alertState = 'none';
  hookah.nextReminderTime = null;
  hookah.expectedEndTime = hookah.expectedEndTime ?? Date.now();
  if (options.auto) {
    const hasActive = table.hookahs.some((item) => item.status === 'active');
    if (!hasActive) {
      table.sessionExpired = true;
    }
  }
  saveTables();
  renderTables();
  renderModal();
  showNotification(`${table.name} • ${hookah.label}: сеанс завершён.`, 'success');
}

function freeTable(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  table.hookahs.forEach((hookah) => {
    hookah.status = 'idle';
    hookah.startedAt = null;
    hookah.expectedEndTime = null;
    hookah.nextReminderTime = null;
    hookah.alertState = 'none';
  });
  table.enabledHookahCount = DEFAULT_ENABLED_HOOKAHS;
  table.sessionExpired = false;
  saveTables();
  renderTables();
  renderModal();
}

function updateHookahInterval(tableId, hookahIndex, newInterval) {
  if (!FREQUENCY_OPTIONS.includes(newInterval)) {
    return;
  }
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = getHookahByIndex(table, hookahIndex);
  if (!hookah) {
    return;
  }
  if (hookah.intervalMinutes === newInterval) {
    return;
  }
  hookah.intervalMinutes = newInterval;
  if (hookah.status === 'active') {
    const now = Date.now();
    if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
      completeHookah(tableId, hookahIndex, { auto: true });
      return;
    }
    hookah.alertState = 'none';
    scheduleNextReminder(hookah, now);
  }
  saveTables();
  renderTables();
  renderModal();
}

function processTimers() {
  const now = Date.now();
  let dirty = false;

  tables.forEach((table) => {
    table.hookahs.forEach((hookah) => {
      if (hookah.status !== 'active') {
        return;
      }

      if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
        completeHookah(table.id, hookah.index, { auto: true });
        dirty = true;
        return;
      }

      if (hookah.alertState === 'due') {
        return;
      }

      if (hookah.nextReminderTime && now >= hookah.nextReminderTime) {
        hookah.alertState = 'due';
        hookah.nextReminderTime = null;
        showNotification(`${table.name} • ${hookah.label}: пора заменить угли.`, 'warning');
        dirty = true;
      }
    });
  });

  if (dirty) {
    saveTables();
    renderModal();
  }
  renderTables();
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function showNotification(message, type = 'info') {
  const entry = {
    id: createId(),
    message,
    type,
    timestamp: new Date(),
  };
  notifications.unshift(entry);
  if (notifications.length > 50) {
    notifications.pop();
  }
  renderNotifications();
}

function renderNotifications() {
  if (!logList) {
    return;
  }
  logList.innerHTML = '';
  if (!notifications.length) {
    const item = document.createElement('li');
    item.className = 'notifications__item notifications__item--empty';
    item.textContent = 'Пока нет уведомлений.';
    logList.appendChild(item);
    return;
  }

  const fragment = document.createDocumentFragment();
  notifications.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'notifications__item';
    item.dataset.type = entry.type;

    const time = document.createElement('time');
    time.dateTime = entry.timestamp.toISOString();
    time.textContent = entry.timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const message = document.createElement('span');
    message.textContent = entry.message;

    item.append(time, message);
    fragment.appendChild(item);
  });

  logList.appendChild(fragment);
}

function clearLog() {
  notifications = [];
  renderNotifications();
}

function handleTableContainerClick(event) {
  const card = event.target.closest('[data-action="open-table"]');
  if (!card) {
    return;
  }
  const tableId = card.dataset.tableId;
  if (tableId) {
    openTableModal(tableId);
  }
}

function handleTableKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const card = event.target.closest('[data-action="open-table"]');
  if (!card) {
    return;
  }
  event.preventDefault();
  const tableId = card.dataset.tableId;
  if (tableId) {
    openTableModal(tableId);
  }
}

function handleModalClick(event) {
  const target = event.target;
  const closeTrigger = target.closest('[data-modal-close]');
  if (target.classList?.contains('modal__backdrop') || closeTrigger) {
    closeTableModal();
    return;
  }
  const button = target.closest('button');
  if (!button || !selectedTableId) {
    return;
  }
  const hookahIndex = button.dataset.hookahIndex;
  if (button.dataset.role === 'frequency' && hookahIndex) {
    updateHookahInterval(selectedTableId, hookahIndex, Number(button.dataset.frequency));
    return;
  }
  switch (button.dataset.action) {
    case 'start-hookah':
      if (hookahIndex) {
        startHookah(selectedTableId, hookahIndex);
      }
      break;
    case 'coal-change':
      if (hookahIndex) {
        manualCoalChange(selectedTableId, hookahIndex);
      }
      break;
    case 'complete-hookah':
      if (hookahIndex) {
        completeHookah(selectedTableId, hookahIndex);
      }
      break;
    case 'add-hookah':
      addHookah(selectedTableId);
      break;
    case 'remove-hookah':
      removeHookah(selectedTableId);
      break;
    default:
      break;
  }
}

function handleFreeTableClick() {
  if (!selectedTableId || !modalFreeButton || modalFreeButton.hidden) {
    return;
  }
  freeTable(selectedTableId);
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && selectedTableId) {
    event.preventDefault();
    closeTableModal();
  }
}

clearLogButton?.addEventListener('click', clearLog);
tableContainer?.addEventListener('click', handleTableContainerClick);
tableContainer?.addEventListener('keydown', handleTableKeydown);
modal?.addEventListener('click', handleModalClick);
modalFreeButton?.addEventListener('click', handleFreeTableClick);
document.addEventListener('keydown', handleGlobalKeydown);
notificationsToggle?.addEventListener('click', () => {
  setNotificationsExpanded(!notificationsExpanded);
});
bulkRedButton?.addEventListener('click', () => {
  bulkManualCoalChange(false);
});
bulkRedYellowButton?.addEventListener('click', () => {
  bulkManualCoalChange(true);
});
hideInactiveToggle?.addEventListener('change', (event) => {
  setHideInactiveTables(event.target.checked);
});
sortByUpcomingToggle?.addEventListener('change', (event) => {
  setSortByUpcomingTables(event.target.checked);
});
setNotificationsExpanded(false);
if (hideInactiveToggle) {
  hideInactiveToggle.checked = hideInactiveTables;
}
if (sortByUpcomingToggle) {
  sortByUpcomingToggle.checked = sortByUpcoming;
}
updateClock();

renderTables();
renderNotifications();
processTimers();
setInterval(processTimers, 1000);
setInterval(updateClock, 1000);
