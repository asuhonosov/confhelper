const STORAGE_KEY = 'hookah-flow-state-v1';
const SETTINGS_KEY = 'hookah-flow-settings-v1';
const PREFERENCES_KEY = 'hookah-flow-preferences-v1';

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

const DEFAULT_TABLE_DURATION_MINUTES = 120;
const PREHEAT_MINUTES = 10;
const HOOKAHS_PER_TABLE = 8;
const WARNING_THRESHOLD_MS = 3 * 60 * 1000;

const tableContainer = document.querySelector('[data-table-list]');
const cardTemplate = document.getElementById('table-card-template');
const chipTemplate = document.getElementById('hookah-chip-template');
const bulkRedButton = document.querySelector('[data-bulk-action="red"]');
const bulkRedYellowButton = document.querySelector('[data-bulk-action="red-yellow"]');
const bulkRedCount = document.querySelector('[data-count-red]');
const bulkRedYellowCount = document.querySelector('[data-count-red-yellow]');
const hideInactiveToggle = document.querySelector('[data-hide-inactive]');
const sortByUpcomingToggle = document.querySelector('[data-sort-upcoming]');
const notificationsToggle = document.querySelector('[data-toggle-notifications]');
const notificationsPanel = document.querySelector('[data-notifications-panel]');
const logList = document.querySelector('[data-log-list]');
const clearLogButton = document.querySelector('[data-action="clear-log"]');
const clockNode = document.querySelector('[data-clock]');
const settingsDialog = document.querySelector('[data-settings]');
const settingsForm = document.querySelector('[data-settings-form]');
const settingsOpenButton = document.querySelector('[data-open-settings]');
const transferDialog = document.querySelector('[data-transfer]');
const transferForm = document.querySelector('[data-transfer-form]');
const transferOpenButton = document.querySelector('[data-open-transfer]');
const confirmDialog = document.querySelector('[data-confirm]');
const confirmMessage = document.querySelector('[data-confirm-message]');
const confirmAccept = document.querySelector('[data-confirm-accept]');

let settings = loadSettings();
let state = loadState();
let preferences = loadPreferences();
let notifications = [];
let hideInactiveTables = Boolean(preferences.hideInactive);
let sortByUpcoming = Boolean(preferences.sortByUpcoming);
let notificationsExpanded = false;
let pendingResetTableId = null;

initializePreferences();
applySettingsToState();
renderTables();
renderNotifications();
updateClock();

setInterval(() => {
  processTimers();
  updateClock();
}, 1000);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultState();
    }
    const tables = Array.isArray(parsed.tables) ? parsed.tables : [];
    return {
      tables: TABLE_NAMES.map((name, index) => ensureTableDefaults(tables[index], index)),
    };
  } catch (error) {
    console.warn('Не удалось загрузить сохранённое состояние.', error);
    return createDefaultState();
  }
}

function loadSettings() {
  const defaults = {
    intervalMinutes: 25,
    replacements: 3,
    preheatEnabled: false,
    tableDurationMinutes: DEFAULT_TABLE_DURATION_MINUTES,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }
    const interval = Number(parsed.intervalMinutes);
    const replacements = Number(parsed.replacements);
    const tableDuration = Number(parsed.tableDurationMinutes);
    const preheatEnabled = Boolean(parsed.preheatEnabled);
    return {
      intervalMinutes: getAllowedInterval(interval),
      replacements: getAllowedReplacement(replacements),
      preheatEnabled,
      tableDurationMinutes: getAllowedTableDuration(tableDuration),
    };
  } catch (error) {
    console.warn('Не удалось загрузить настройки, будут использованы значения по умолчанию.', error);
    return defaults;
  }
}

function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Не удалось загрузить предпочтения.', error);
    return {};
  }
}

function createDefaultState() {
  return {
    tables: TABLE_NAMES.map((name, index) => createTable(index)),
  };
}

function createTable(index) {
  return {
    id: `table-${index + 1}`,
    name: TABLE_NAMES[index] ?? `Стол ${index + 1}`,
    hookahs: Array.from({ length: HOOKAHS_PER_TABLE }, (_, hookahIndex) => createHookah(hookahIndex + 1)),
    sessionStartedAt: null,
    sessionEndTime: null,
    sessionExpired: false,
  };
}

function ensureTableDefaults(raw, index) {
  const base = createTable(index);
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const table = {
    ...base,
    ...raw,
    id: base.id,
    name: base.name,
  };
  table.hookahs = Array.from({ length: HOOKAHS_PER_TABLE }, (_, hookahIndex) => {
    const stored = Array.isArray(raw.hookahs) ? raw.hookahs[hookahIndex] : null;
    return ensureHookahDefaults(stored, hookahIndex + 1);
  });
  table.sessionStartedAt = typeof table.sessionStartedAt === 'number' ? table.sessionStartedAt : null;
  table.sessionEndTime = typeof table.sessionEndTime === 'number' ? table.sessionEndTime : null;
  table.sessionExpired = Boolean(table.sessionExpired);
  return table;
}

function createHookah(index) {
  return {
    index,
    status: 'idle',
    startedAt: null,
    lastServiceAt: null,
    intervalMinutes: settings.intervalMinutes,
    replacements: settings.replacements,
    expectedEndTime: null,
    nextReminderTime: null,
    alertNotified: null,
    preheatStartedAt: null,
    preheatUntil: null,
  };
}

function ensureHookahDefaults(raw, index) {
  const base = createHookah(index);
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const hookah = { ...base, ...raw };
  hookah.index = base.index;
  hookah.status = ['idle', 'active', 'preheat'].includes(hookah.status) ? hookah.status : 'idle';
  hookah.startedAt = typeof hookah.startedAt === 'number' ? hookah.startedAt : null;
  hookah.lastServiceAt = typeof hookah.lastServiceAt === 'number' ? hookah.lastServiceAt : null;
  hookah.intervalMinutes = getAllowedInterval(hookah.intervalMinutes);
  hookah.replacements = getAllowedReplacement(hookah.replacements);
  hookah.expectedEndTime = typeof hookah.expectedEndTime === 'number' ? hookah.expectedEndTime : null;
  hookah.nextReminderTime = typeof hookah.nextReminderTime === 'number' ? hookah.nextReminderTime : null;
  hookah.alertNotified = typeof hookah.alertNotified === 'number' ? hookah.alertNotified : null;
  hookah.preheatStartedAt = typeof hookah.preheatStartedAt === 'number' ? hookah.preheatStartedAt : null;
  hookah.preheatUntil = typeof hookah.preheatUntil === 'number' ? hookah.preheatUntil : null;
  return hookah;
}

function getAllowedInterval(value) {
  const allowed = [1, 25, 35, 45];
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || !allowed.includes(minutes)) {
    return 25;
  }
  return minutes;
}

function getAllowedReplacement(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 3;
  }
  return Math.min(4, Math.max(1, Math.floor(number)));
}

function getAllowedTableDuration(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) {
    return DEFAULT_TABLE_DURATION_MINUTES;
  }
  return Math.min(360, Math.max(30, Math.floor(minutes)));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function savePreferences() {
  preferences.hideInactive = hideInactiveTables;
  preferences.sortByUpcoming = sortByUpcoming;
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

function applySettingsToState() {
  const now = Date.now();
  state.tables.forEach((table) => {
    table.hookahs.forEach((hookah) => {
      hookah.intervalMinutes = settings.intervalMinutes;
      hookah.replacements = settings.replacements;

      if (hookah.status === 'idle') {
        hookah.expectedEndTime = null;
        hookah.nextReminderTime = null;
        hookah.alertNotified = null;
        hookah.startedAt = null;
        hookah.lastServiceAt = null;
        hookah.preheatStartedAt = null;
        hookah.preheatUntil = null;
        return;
      }

      if (hookah.status === 'preheat') {
        hookah.expectedEndTime = null;
        hookah.nextReminderTime = null;
        hookah.alertNotified = null;
        if (!settings.preheatEnabled) {
          activateHookahSession(table, hookah, now);
        } else {
          hookah.preheatStartedAt = hookah.preheatStartedAt ?? now;
          hookah.preheatUntil = hookah.preheatStartedAt + PREHEAT_MINUTES * 60 * 1000;
        }
        return;
      }

      if (hookah.status === 'active') {
        if (!hookah.startedAt) {
          hookah.startedAt = now;
        }
        const totalMs = getHookahTotalMs(hookah);
        hookah.expectedEndTime = hookah.startedAt + totalMs;
        const intervalMs = hookah.intervalMinutes * 60 * 1000;
        hookah.lastServiceAt = hookah.lastServiceAt ?? hookah.startedAt;
        hookah.nextReminderTime = hookah.lastServiceAt + intervalMs;
        if (hookah.expectedEndTime && hookah.nextReminderTime > hookah.expectedEndTime) {
          hookah.nextReminderTime = hookah.expectedEndTime;
        }
      }
    });
    updateTableSession(table);
  });
  saveState();
}

function initializePreferences() {
  if (hideInactiveToggle) {
    hideInactiveToggle.checked = hideInactiveTables;
  }
  if (sortByUpcomingToggle) {
    sortByUpcomingToggle.checked = sortByUpcoming;
  }
}

function getHookahTotalMs(hookah) {
  const segments = hookah.replacements + 1;
  return hookah.intervalMinutes * segments * 60 * 1000;
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function getVisibleHookahCount(table) {
  const active = table.hookahs.filter((hookah) => hookah.status === 'active' || hookah.status === 'preheat').length;
  const desired = Math.min(HOOKAHS_PER_TABLE, Math.max(1, active + 1));
  return desired;
}

function getFreeHookahSlots(table) {
  return table.hookahs.filter((hookah) => hookah.status === 'idle').length;
}

function renderTables() {
  if (!tableContainer) {
    return;
  }
  const now = Date.now();
  let dueCount = 0;
  let dueOrSoonCount = 0;

  const items = state.tables.map((table) => ({ table, sortValue: getTableSortValue(table, now) }));
  if (sortByUpcoming) {
    items.sort((a, b) => a.sortValue - b.sortValue);
  }

  tableContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  items.forEach(({ table }) => {
    if (hideInactiveTables && !table.sessionStartedAt && !table.sessionExpired) {
      const hasActive = table.hookahs.some((hookah) => hookah.status === 'active' || hookah.status === 'preheat');
      if (!hasActive) {
        return;
      }
    }

    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.tableId = table.id;

    const alertLevel = getTableAlertLevel(table, now);
    node.dataset.alert = alertLevel;

    const nameNode = node.querySelector('[data-name]');
    const summaryNode = node.querySelector('[data-summary]');
    const hookahList = node.querySelector('[data-hookah-list]');
    const footer = node.querySelector('[data-table-alert]');
    const closeButton = node.querySelector('[data-action="close-table"]');

    if (nameNode) {
      nameNode.textContent = table.name;
    }
    if (summaryNode) {
      summaryNode.textContent = getTableSummary(table, now);
    }
    if (footer) {
      footer.textContent = table.sessionExpired ? 'Время стола закончилось' : '';
    }
    if (closeButton) {
      closeButton.dataset.tableId = table.id;
      closeButton.textContent = table.sessionStartedAt || table.sessionExpired ? 'Освободить стол' : 'Стол свободен';
      closeButton.disabled = !table.sessionStartedAt && !table.sessionExpired;
      closeButton.classList.toggle('table-card__close--danger', Boolean(table.sessionStartedAt || table.sessionExpired));
    }

    if (hookahList) {
      hookahList.innerHTML = '';
      const visible = getVisibleHookahCount(table);
      for (let index = 0; index < visible; index += 1) {
        const hookah = table.hookahs[index];
        if (!hookah) {
          continue;
        }
        const hookahNode = chipTemplate.content.firstElementChild.cloneNode(true);
        const button = hookahNode.querySelector('[data-action="toggle-hookah"]');
        const indexNode = hookahNode.querySelector('[data-index]');
        const timerNode = hookahNode.querySelector('[data-timer]');
        const removeButton = hookahNode.querySelector('[data-action="remove-hookah"]');

        hookahNode.dataset.tableId = table.id;
        hookahNode.dataset.hookahIndex = hookah.index;

        if (indexNode) {
          indexNode.textContent = String(hookah.index);
        }

        const alert = getHookahAlertLevel(hookah, now);
        hookahNode.dataset.alert = alert;

        if (hookah.status === 'active') {
          hookahNode.dataset.state = 'active';
          if (timerNode) {
            const startedAt = hookah.startedAt ?? now;
            timerNode.textContent = formatStopwatch(now - startedAt);
          }
        } else if (hookah.status === 'preheat') {
          hookahNode.dataset.state = 'preheat';
          if (timerNode) {
            const remaining = hookah.preheatUntil ? hookah.preheatUntil - now : PREHEAT_MINUTES * 60 * 1000;
            timerNode.textContent = formatCountdownClock(remaining);
          }
        } else {
          hookahNode.dataset.state = 'add';
          if (timerNode) {
            timerNode.textContent = '00:00';
          }
        }

        if (button) {
          button.dataset.tableId = table.id;
          button.dataset.hookahIndex = hookah.index;
        }

        if (removeButton) {
          removeButton.dataset.tableId = table.id;
          removeButton.dataset.hookahIndex = hookah.index;
          removeButton.hidden = hookahNode.dataset.state === 'add';
        }

        renderHookahProgress(hookahNode, hookah, alert, now);

        if (hookah.status === 'active') {
          if (alert === 'due') {
            dueCount += 1;
            dueOrSoonCount += 1;
          } else if (alert === 'soon') {
            dueOrSoonCount += 1;
          }
        }

        hookahList.appendChild(hookahNode);
      }
    }

    fragment.appendChild(node);
  });

  tableContainer.appendChild(fragment);
  updateBulkControls(dueCount, dueOrSoonCount);
}

function getTableSummary(table, now) {
  if (table.sessionExpired) {
    return '00:00';
  }
  if (table.sessionEndTime && now < table.sessionEndTime) {
    const remaining = table.sessionEndTime - now;
    return formatCountdown(remaining);
  }
  const active = table.hookahs.filter((hookah) => hookah.status === 'active');
  if (active.length > 0) {
    const latestEnd = active
      .map((hookah) => hookah.expectedEndTime || 0)
      .filter((value) => value > now);
    if (latestEnd.length) {
      return formatCountdown(Math.max(...latestEnd) - now);
    }
    return 'менее минуты';
  }
  return '—';
}

function getTableAlertLevel(table, now) {
  if (table.sessionExpired) {
    return 'due';
  }
  let hasSoon = false;
  let hasActive = false;
  table.hookahs.forEach((hookah) => {
    if (hookah.status === 'preheat') {
      hasActive = true;
      return;
    }
    if (hookah.status !== 'active') {
      return;
    }
    hasActive = true;
    const alert = getHookahAlertLevel(hookah, now);
    if (alert === 'due') {
      hasSoon = true;
      return;
    }
    if (alert === 'soon') {
      hasSoon = true;
    }
  });
  if (hasSoon) {
    return 'soon';
  }
  if (hasActive) {
    return 'ok';
  }
  return 'inactive';
}

function getTableSortValue(table, now) {
  if (table.sessionExpired) {
    return -Infinity;
  }
  let value = Infinity;
  table.hookahs.forEach((hookah) => {
    if (hookah.status !== 'active') {
      return;
    }
    if (hookah.nextReminderTime) {
      value = Math.min(value, hookah.nextReminderTime - now);
    }
  });
  return value;
}

function getHookahAlertLevel(hookah, now) {
  if (hookah.status === 'preheat') {
    return 'preheat';
  }
  if (hookah.status !== 'active') {
    return 'inactive';
  }
  if (!hookah.nextReminderTime) {
    return 'ok';
  }
  const diff = hookah.nextReminderTime - now;
  if (diff <= 0) {
    return 'due';
  }
  if (diff <= WARNING_THRESHOLD_MS) {
    return 'soon';
  }
  return 'ok';
}

function renderHookahProgress(node, hookah, alert, now) {
  const container = node.querySelector('[data-progress]');
  const bar = node.querySelector('[data-progress-bar]');
  const fill = node.querySelector('[data-progress-fill]');
  const markers = node.querySelector('[data-progress-markers]');
  const meta = node.querySelector('[data-progress-meta]');

  if (!container || !bar || !fill || !markers || !meta) {
    return;
  }

  if (hookah.status !== 'active') {
    container.hidden = true;
    markers.innerHTML = '';
    meta.textContent = '';
    return;
  }

  const segments = hookah.replacements + 1;
  const totalMs = getHookahTotalMs(hookah);
  const elapsed = now - (hookah.startedAt || now);
  const ratio = clamp(elapsed / totalMs);
  const replacementsDone = Math.min(hookah.replacements, Math.floor(elapsed / (hookah.intervalMinutes * 60 * 1000)));

  meta.textContent = `Замен: ${replacementsDone} / ${hookah.replacements}`;

  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  fill.style.backgroundColor = getProgressColor(alert);

  markers.innerHTML = '';
  for (let index = 1; index < segments; index += 1) {
    const marker = document.createElement('span');
    marker.className = 'hookah-chip__bar-marker';
    marker.style.left = `${(index / segments) * 100}%`;
    markers.appendChild(marker);
  }

  container.hidden = false;
}

function getTableDurationMs() {
  const minutes = getAllowedTableDuration(settings.tableDurationMinutes);
  return minutes * 60 * 1000;
}

function updateTableSession(table) {
  const activeHookahs = table.hookahs.filter((hookah) => hookah.status === 'active' || hookah.status === 'preheat');
  if (!activeHookahs.length) {
    table.sessionStartedAt = null;
    table.sessionEndTime = null;
    table.sessionExpired = false;
    return;
  }

  const now = Date.now();
  const durationMs = getTableDurationMs();
  const startTimes = activeHookahs.map((hookah) => {
    if (hookah.status === 'active') {
      return hookah.startedAt ?? now;
    }
    return hookah.preheatStartedAt ?? now;
  });
  const earliestStart = Math.min(...startTimes);

  table.sessionStartedAt = earliestStart;

  const endCandidates = activeHookahs.map((hookah) => {
    const base = hookah.status === 'active' ? hookah.startedAt ?? now : hookah.preheatStartedAt ?? now;
    return base + durationMs;
  });

  table.sessionEndTime = Math.max(...endCandidates);
}

function activateHookahSession(table, hookah, startTime = Date.now()) {
  hookah.status = 'active';
  hookah.preheatStartedAt = null;
  hookah.preheatUntil = null;
  hookah.startedAt = startTime;
  hookah.lastServiceAt = startTime;
  hookah.intervalMinutes = settings.intervalMinutes;
  hookah.replacements = settings.replacements;
  hookah.expectedEndTime = startTime + getHookahTotalMs(hookah);
  const intervalMs = hookah.intervalMinutes * 60 * 1000;
  hookah.nextReminderTime = startTime + intervalMs;
  if (hookah.expectedEndTime && hookah.nextReminderTime > hookah.expectedEndTime) {
    hookah.nextReminderTime = hookah.expectedEndTime;
  }
  hookah.alertNotified = null;

  if (!table.sessionStartedAt || table.sessionExpired) {
    table.sessionStartedAt = startTime;
    table.sessionExpired = false;
  }
  updateTableSession(table);
}

function getProgressColor(alert) {
  switch (alert) {
    case 'due':
      return '#ff5468';
    case 'soon':
      return '#ffc857';
    case 'ok':
      return '#2e9b62';
    default:
      return 'rgba(255,255,255,0.25)';
  }
}

function formatCountdown(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / (60 * 1000)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}ч`);
  }
  parts.push(`${minutes.toString().padStart(2, '0')}м`);
  return parts.join(' ');
}

function formatCountdownClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatStopwatch(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / (60 * 1000)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function updateBulkControls(due, dueOrSoon) {
  if (bulkRedCount) {
    bulkRedCount.textContent = String(due);
  }
  if (bulkRedYellowCount) {
    bulkRedYellowCount.textContent = String(dueOrSoon);
  }
  if (bulkRedButton) {
    bulkRedButton.disabled = due === 0;
  }
  if (bulkRedYellowButton) {
    bulkRedYellowButton.disabled = dueOrSoon === 0;
  }
}

function processTimers() {
  const now = Date.now();
  let dirty = false;

  state.tables.forEach((table) => {
    if (table.sessionEndTime && now >= table.sessionEndTime && !table.sessionExpired) {
      table.sessionExpired = true;
      table.sessionEndTime = null;
      showNotification(`${table.name}: время стола закончилось.`, 'danger');
      dirty = true;
    }

    table.hookahs.forEach((hookah) => {
      if (hookah.status === 'preheat') {
        if (!settings.preheatEnabled) {
          activateHookahSession(table, hookah, now);
          dirty = true;
          return;
        }
        if (!hookah.preheatUntil) {
          hookah.preheatStartedAt = hookah.preheatStartedAt ?? now;
          hookah.preheatUntil = hookah.preheatStartedAt + PREHEAT_MINUTES * 60 * 1000;
          dirty = true;
          return;
        }
        if (now >= hookah.preheatUntil) {
          activateHookahSession(table, hookah, hookah.preheatUntil);
          dirty = true;
        }
        return;
      }

      if (hookah.status !== 'active' || !hookah.nextReminderTime) {
        return;
      }
      if (now >= hookah.nextReminderTime) {
        if (hookah.alertNotified !== hookah.nextReminderTime) {
          showNotification(`${table.name} • Кальян ${hookah.index}: пора сменить угли.`, 'warning');
          hookah.alertNotified = hookah.nextReminderTime;
          dirty = true;
        }
      }
    });
  });

  if (dirty) {
    saveState();
  }
  renderTables();
}

function startHookah(tableId, hookahIndex) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = table.hookahs[hookahIndex - 1];
  if (!hookah) {
    return;
  }
  const now = Date.now();
  hookah.intervalMinutes = settings.intervalMinutes;
  hookah.replacements = settings.replacements;

  if (settings.preheatEnabled) {
    hookah.status = 'preheat';
    hookah.preheatStartedAt = now;
    hookah.preheatUntil = now + PREHEAT_MINUTES * 60 * 1000;
    hookah.startedAt = null;
    hookah.lastServiceAt = null;
    hookah.expectedEndTime = null;
    hookah.nextReminderTime = null;
    hookah.alertNotified = null;
    if (!table.sessionStartedAt || table.sessionExpired) {
      table.sessionStartedAt = now;
      table.sessionExpired = false;
    }
    updateTableSession(table);
  } else {
    activateHookahSession(table, hookah, now);
  }

  saveState();
  renderTables();
}

function acknowledgeHookah(tableId, hookahIndex) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = table.hookahs[hookahIndex - 1];
  if (!hookah || hookah.status !== 'active') {
    return;
  }
  const now = Date.now();
  hookah.lastServiceAt = now;
  const intervalMs = hookah.intervalMinutes * 60 * 1000;
  hookah.nextReminderTime = now + intervalMs;
  if (hookah.expectedEndTime && hookah.nextReminderTime > hookah.expectedEndTime) {
    hookah.nextReminderTime = hookah.expectedEndTime;
  }
  hookah.alertNotified = null;
  saveState();
  renderTables();
}

function resetTable(tableId) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  table.hookahs.forEach((hookah) => {
    hookah.status = 'idle';
    hookah.startedAt = null;
    hookah.lastServiceAt = null;
    hookah.expectedEndTime = null;
    hookah.nextReminderTime = null;
    hookah.alertNotified = null;
    hookah.intervalMinutes = settings.intervalMinutes;
    hookah.replacements = settings.replacements;
    hookah.preheatStartedAt = null;
    hookah.preheatUntil = null;
  });
  table.sessionStartedAt = null;
  table.sessionEndTime = null;
  table.sessionExpired = false;
  updateTableSession(table);
  saveState();
  renderTables();
}

function removeHookah(tableId, hookahIndex) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = table.hookahs[hookahIndex - 1];
  if (!hookah) {
    return;
  }

  hookah.status = 'idle';
  hookah.startedAt = null;
  hookah.lastServiceAt = null;
  hookah.expectedEndTime = null;
  hookah.nextReminderTime = null;
  hookah.alertNotified = null;
  hookah.preheatStartedAt = null;
  hookah.preheatUntil = null;
  hookah.intervalMinutes = settings.intervalMinutes;
  hookah.replacements = settings.replacements;

  if (!table.hookahs.some((item) => item.status === 'active' || item.status === 'preheat')) {
    table.sessionExpired = false;
  }

  updateTableSession(table);
  saveState();
  renderTables();
}

function transferHookahs(fromId, toId) {
  if (!fromId || !toId || fromId === toId) {
    return false;
  }
  const source = state.tables.find((item) => item.id === fromId);
  const target = state.tables.find((item) => item.id === toId);
  if (!source || !target) {
    return false;
  }
  const activeHookahs = source.hookahs.filter((hookah) => hookah.status === 'active' || hookah.status === 'preheat');
  if (!activeHookahs.length) {
    return false;
  }
  const availableSlots = target.hookahs.filter((hookah) => hookah.status === 'idle');
  if (availableSlots.length < activeHookahs.length) {
    alert('Недостаточно свободных кальянов на выбранном столе.');
    return false;
  }

  activeHookahs.forEach((hookah) => {
    const destination = availableSlots.shift();
    if (!destination) {
      return;
    }
    destination.status = hookah.status;
    destination.startedAt = hookah.startedAt;
    destination.lastServiceAt = hookah.lastServiceAt;
    destination.intervalMinutes = hookah.intervalMinutes;
    destination.replacements = hookah.replacements;
    destination.expectedEndTime = hookah.expectedEndTime;
    destination.nextReminderTime = hookah.nextReminderTime;
    destination.alertNotified = hookah.alertNotified;
    destination.preheatStartedAt = hookah.preheatStartedAt;
    destination.preheatUntil = hookah.preheatUntil;
  });

  source.hookahs.forEach((hookah) => {
    if (hookah.status === 'active' || hookah.status === 'preheat') {
      hookah.status = 'idle';
      hookah.startedAt = null;
      hookah.lastServiceAt = null;
      hookah.expectedEndTime = null;
      hookah.nextReminderTime = null;
      hookah.alertNotified = null;
      hookah.intervalMinutes = settings.intervalMinutes;
      hookah.replacements = settings.replacements;
      hookah.preheatStartedAt = null;
      hookah.preheatUntil = null;
    }
  });

  target.sessionExpired = false;
  updateTableSession(target);

  source.sessionExpired = false;
  if (!source.hookahs.some((hookah) => hookah.status === 'active' || hookah.status === 'preheat')) {
    source.sessionStartedAt = null;
    source.sessionEndTime = null;
  }

  updateTableSession(source);

  saveState();
  renderTables();
  return true;
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
    const empty = document.createElement('li');
    empty.className = 'notifications__item';
    empty.textContent = 'Новых уведомлений нет';
    logList.appendChild(empty);
    return;
  }
  notifications.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'notifications__item';
    if (entry.type === 'warning') {
      item.classList.add('notifications__item--warning');
    }
    if (entry.type === 'danger') {
      item.classList.add('notifications__item--danger');
    }
    item.textContent = entry.message;
    const time = document.createElement('time');
    time.textContent = entry.timestamp.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    item.appendChild(time);
    logList.appendChild(item);
  });
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function setNotificationsExpanded(expanded) {
  notificationsExpanded = expanded;
  document.body.classList.toggle('notifications-open', expanded);
  if (notificationsToggle) {
    notificationsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    notificationsToggle.textContent = expanded ? 'Скрыть уведомления' : 'Показать уведомления';
  }
  if (notificationsPanel) {
    notificationsPanel.hidden = !expanded;
    notificationsPanel.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  }
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

function closeDialog(node) {
  if (!node) {
    return;
  }
  if (node === confirmDialog) {
    pendingResetTableId = null;
  }
  node.hidden = true;
  node.setAttribute('aria-hidden', 'true');
}

function openDialog(node) {
  if (!node) {
    return;
  }
  node.hidden = false;
  node.setAttribute('aria-hidden', 'false');
}

function populateSettingsForm() {
  if (!settingsForm) {
    return;
  }
  const intervalField = settingsForm.querySelector('[name="interval"]');
  const replacementsField = settingsForm.querySelector('[name="replacements"]');
  const preheatField = settingsForm.querySelector('[name="preheat"]');
  const tableDurationField = settingsForm.querySelector('[name="tableDuration"]');
  if (intervalField) {
    intervalField.value = String(settings.intervalMinutes);
  }
  if (replacementsField) {
    replacementsField.value = String(settings.replacements);
  }
  if (preheatField) {
    preheatField.checked = Boolean(settings.preheatEnabled);
  }
  if (tableDurationField) {
    tableDurationField.value = String(getAllowedTableDuration(settings.tableDurationMinutes));
  }
}

function populateTransferForm() {
  if (!transferForm) {
    return;
  }
  const fromSelect = transferForm.querySelector('[name="from"]');
  const toSelect = transferForm.querySelector('[name="to"]');
  if (!fromSelect || !toSelect) {
    return;
  }
  fromSelect.innerHTML = '';
  toSelect.innerHTML = '';
  state.tables.forEach((table) => {
    const optionFrom = document.createElement('option');
    optionFrom.value = table.id;
    optionFrom.textContent = table.name;
    fromSelect.appendChild(optionFrom);

    const optionTo = document.createElement('option');
    optionTo.value = table.id;
    const freeSlots = getFreeHookahSlots(table);
    optionTo.textContent = `${table.name} (свободно ${freeSlots})`;
    toSelect.appendChild(optionTo);
  });
}

function handleBulkAction(includeYellow = false) {
  const now = Date.now();
  state.tables.forEach((table) => {
    table.hookahs.forEach((hookah) => {
      if (hookah.status !== 'active') {
        return;
      }
      const alert = getHookahAlertLevel(hookah, now);
      if (alert === 'due' || (includeYellow && alert === 'soon')) {
        hookah.lastServiceAt = now;
        const intervalMs = hookah.intervalMinutes * 60 * 1000;
        hookah.nextReminderTime = now + intervalMs;
        if (hookah.expectedEndTime && hookah.nextReminderTime > hookah.expectedEndTime) {
          hookah.nextReminderTime = hookah.expectedEndTime;
        }
        hookah.alertNotified = null;
      }
    });
  });
  saveState();
  renderTables();
}

if (bulkRedButton) {
  bulkRedButton.addEventListener('click', () => handleBulkAction(false));
}

if (bulkRedYellowButton) {
  bulkRedYellowButton.addEventListener('click', () => handleBulkAction(true));
}

if (hideInactiveToggle) {
  hideInactiveToggle.addEventListener('change', (event) => {
    hideInactiveTables = Boolean(event.currentTarget.checked);
    savePreferences();
    renderTables();
  });
}

if (sortByUpcomingToggle) {
  sortByUpcomingToggle.addEventListener('change', (event) => {
    sortByUpcoming = Boolean(event.currentTarget.checked);
    savePreferences();
    renderTables();
  });
}

if (notificationsToggle) {
  notificationsToggle.addEventListener('click', () => {
    setNotificationsExpanded(!notificationsExpanded);
  });
}

if (clearLogButton) {
  clearLogButton.addEventListener('click', () => {
    notifications = [];
    renderNotifications();
  });
}

if (settingsOpenButton) {
  settingsOpenButton.addEventListener('click', () => {
    populateSettingsForm();
    openDialog(settingsDialog);
  });
}

if (settingsForm) {
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(settingsForm);
    const interval = getAllowedInterval(Number(formData.get('interval')));
    const replacements = getAllowedReplacement(Number(formData.get('replacements')));
    const preheatEnabled = formData.get('preheat') === 'on';
    const tableDuration = getAllowedTableDuration(Number(formData.get('tableDuration')));
    settings = {
      intervalMinutes: interval,
      replacements,
      preheatEnabled,
      tableDurationMinutes: tableDuration,
    };
    saveSettings();
    applySettingsToState();
    renderTables();
    closeDialog(settingsDialog);
  });
}

if (transferOpenButton) {
  transferOpenButton.addEventListener('click', () => {
    populateTransferForm();
    openDialog(transferDialog);
  });
}

if (transferForm) {
  transferForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(transferForm);
    const fromId = formData.get('from');
    const toId = formData.get('to');
    if (transferHookahs(fromId, toId)) {
      closeDialog(transferDialog);
    }
  });
}

if (confirmAccept) {
  confirmAccept.addEventListener('click', () => {
    if (pendingResetTableId) {
      const targetId = pendingResetTableId;
      resetTable(targetId);
    }
    closeDialog(confirmDialog);
  });
}

function getDialogDismissButtons() {
  return document.querySelectorAll('[data-dialog-dismiss]');
}

getDialogDismissButtons().forEach((button) => {
  button.addEventListener('click', () => {
    closeDialog(button.closest('.dialog'));
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    [settingsDialog, transferDialog, confirmDialog].forEach((dialog) => closeDialog(dialog));
  }
});

tableContainer?.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-action="remove-hookah"]');
  if (removeButton) {
    const tableId = removeButton.dataset.tableId;
    const hookahIndex = Number(removeButton.dataset.hookahIndex);
    if (tableId && hookahIndex) {
      removeHookah(tableId, hookahIndex);
    }
    return;
  }

  const button = event.target.closest('[data-action="toggle-hookah"]');
  if (button) {
    const tableId = button.dataset.tableId;
    const hookahIndex = Number(button.dataset.hookahIndex);
    const table = state.tables.find((item) => item.id === tableId);
    if (!table) {
      return;
    }
    const hookah = table.hookahs[hookahIndex - 1];
    if (!hookah) {
      return;
    }
    if (hookah.status === 'idle') {
      startHookah(tableId, hookahIndex);
      return;
    }
    if (hookah.status === 'preheat') {
      activateHookahSession(table, hookah, Date.now());
      saveState();
      renderTables();
      return;
    }
    if (hookah.status === 'active') {
      acknowledgeHookah(tableId, hookahIndex);
      return;
    }
  }

  const closeButton = event.target.closest('[data-action="close-table"]');
  if (closeButton) {
    const tableId = closeButton.dataset.tableId;
    if (!tableId) {
      return;
    }
    const table = state.tables.find((item) => item.id === tableId);
    if (!table) {
      return;
    }
    if (!table.sessionStartedAt && !table.sessionExpired) {
      return;
    }
    pendingResetTableId = tableId;
    if (confirmMessage) {
      confirmMessage.textContent = `${table.name}: освободить стол? Активные кальяны будут остановлены.`;
    }
    openDialog(confirmDialog);
  }
});

function handleDialogBackdropClicks() {
  document.querySelectorAll('.dialog__backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', () => {
      closeDialog(backdrop.closest('.dialog'));
    });
  });
}

handleDialogBackdropClicks();
