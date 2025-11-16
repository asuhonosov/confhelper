const STORAGE_KEY = 'hookah-flow-state-v1';
const SETTINGS_KEY = 'hookah-flow-settings-v1';
const PREFERENCES_KEY = 'hookah-flow-preferences-v1';

const API_BASE = 'https://d5di85pklqmoab3etmus.aqkd4clz.apigw.yandexcloud.net';
const BAR_ID = 'red-rose-1';
const SYNC_INTERVAL_MS = 1500;

let backendStateDirty = false;
let syncInFlight = false;
let lastSyncedHash = null;

function hashState(currentState) {
  try {
    return JSON.stringify(currentState);
  } catch {
    return '';
  }
}

async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  try {
    const res = await fetch(url, config);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API error ${res.status} ${text}`);
    }
    if (res.status === 204) {
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('API request failed', e);
    throw e;
  }
}

function markStateDirtyForBackend() {
  backendStateDirty = true;
}

async function loadStateFromBackend() {
  const data = await apiRequest(`/api/state?bar_id=${encodeURIComponent(BAR_ID)}`, {
    method: 'GET',
  });
  if (!data || typeof data.state !== 'object') {
    return null;
  }
  return data.state;
}

async function saveStateToBackend() {
  const currentHash = hashState(state);
  if (currentHash === lastSyncedHash) {
    backendStateDirty = false;
    return;
  }

  await apiRequest(`/api/state?bar_id=${encodeURIComponent(BAR_ID)}`, {
    method: 'POST',
    body: JSON.stringify({ state }),
  });

  lastSyncedHash = currentHash;
  backendStateDirty = false;
}

async function logEvent(type, payload = {}) {
  const event = {
    type,
    bar_id: BAR_ID,
    ...payload,
  };

  try {
    await apiRequest(`/api/event?bar_id=${encodeURIComponent(BAR_ID)}`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.warn('Не удалось отправить событие на бэкенд.', error);
  }
}

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
  'Бар 1',
  'Бар 2',
  'Бар 3',
  'Бар 4',
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
const transferFromSelect = transferForm?.querySelector('[data-transfer-from]') ?? null;
const transferToSelect = transferForm?.querySelector('[data-transfer-to]') ?? null;
const transferErrorNode = transferForm?.querySelector('[data-transfer-error]') ?? null;
const transferSubmitButton = transferForm?.querySelector('[data-transfer-submit]') ?? null;
const transferHookahList = transferForm?.querySelector('[data-transfer-hookah-list]') ?? null;
const confirmDialog = document.querySelector('[data-confirm]');
const confirmMessage = document.querySelector('[data-confirm-message]');
const confirmAccept = document.querySelector('[data-confirm-accept]');
const headerToggleButton = document.querySelector('[data-header-toggle]');
const headerCollapseMedia = window.matchMedia ? window.matchMedia('(max-width: 1100px)') : null;
const controlPanel = document.querySelector('[data-control-panel]');
const controlPanelToggle = document.querySelector('[data-control-panel-toggle]');
const controlCollapseMedia = window.matchMedia ? window.matchMedia('(max-width: 1180px)') : null;

let settings = loadSettings();
let state = loadState();
let preferences = loadPreferences();
let notifications = [];
let hideInactiveTables = Boolean(preferences.hideInactive);
let sortByUpcoming = Boolean(preferences.sortByUpcoming);
let notificationsExpanded = false;
let pendingResetTableId = null;
let headerCollapsed = headerCollapseMedia ? headerCollapseMedia.matches : false;
let controlsCollapsed = controlCollapseMedia ? controlCollapseMedia.matches : false;

initializePreferences();
applySettingsToState();
applyVisualSettings();
renderTables();
renderNotifications();
updateClock();
applyHeaderCollapseState();
applyControlPanelState();
initializeBackendSync();

setInterval(() => {
  processTimers();
  updateClock();
}, 1000);

setInterval(() => {
  backendSyncTick();
}, SYNC_INTERVAL_MS);

async function backendSyncTick() {
  if (syncInFlight) {
    return;
  }

  syncInFlight = true;
  try {
    if (backendStateDirty) {
      await saveStateToBackend();
    } else {
      const remote = await loadStateFromBackend();
      if (remote && typeof remote === 'object') {
        const remoteHash = hashState(remote);
        if (remoteHash !== lastSyncedHash) {
          applyStateFromBackend(remote);
        }
      }
    }
  } catch (e) {
    console.warn('Backend sync tick failed', e);
  } finally {
    syncInFlight = false;
  }
}

async function initializeBackendSync() {
  try {
    const remoteState = await loadStateFromBackend();
    if (remoteState && typeof remoteState === 'object') {
      applyStateFromBackend(remoteState);
    }
    logEvent('app_opened', {});
  } catch (e) {
    console.warn('Initial backend sync failed, continue offline', e);
  }
}

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
    const interval = Number(parsed.intervalMinutes ?? defaults.intervalMinutes);
    const replacements = Number(parsed.replacements ?? defaults.replacements);
    const tableDuration = Number(parsed.tableDurationMinutes ?? defaults.tableDurationMinutes);
    const preheatEnabled = typeof parsed.preheatEnabled === 'boolean' ? parsed.preheatEnabled : defaults.preheatEnabled;
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
    sessionExpiredAt: null,
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
  table.sessionExpiredAt = typeof table.sessionExpiredAt === 'number' ? table.sessionExpiredAt : null;
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
    orderStartedAt: null,
    overtimeStartedAt: null,
  };
}

function ensureHookahDefaults(raw, index) {
  const base = createHookah(index);
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const hookah = { ...base, ...raw };
  hookah.index = base.index;
  hookah.status = ['idle', 'ordered', 'active', 'preheat'].includes(hookah.status)
    ? hookah.status
    : 'idle';
  hookah.startedAt = typeof hookah.startedAt === 'number' ? hookah.startedAt : null;
  hookah.lastServiceAt = typeof hookah.lastServiceAt === 'number' ? hookah.lastServiceAt : null;
  hookah.intervalMinutes = getAllowedInterval(hookah.intervalMinutes);
  hookah.replacements = getAllowedReplacement(hookah.replacements);
  hookah.expectedEndTime = typeof hookah.expectedEndTime === 'number' ? hookah.expectedEndTime : null;
  hookah.nextReminderTime = typeof hookah.nextReminderTime === 'number' ? hookah.nextReminderTime : null;
  hookah.alertNotified = typeof hookah.alertNotified === 'number' ? hookah.alertNotified : null;
  hookah.preheatStartedAt = typeof hookah.preheatStartedAt === 'number' ? hookah.preheatStartedAt : null;
  hookah.preheatUntil = typeof hookah.preheatUntil === 'number' ? hookah.preheatUntil : null;
  hookah.orderStartedAt = typeof hookah.orderStartedAt === 'number' ? hookah.orderStartedAt : null;
  hookah.overtimeStartedAt = typeof hookah.overtimeStartedAt === 'number' ? hookah.overtimeStartedAt : null;
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
  markStateDirtyForBackend();
}

function applyStateFromBackend(remoteState) {
  state = remoteState || {};

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  lastSyncedHash = hashState(state);
  backendStateDirty = false;

  applySettingsToState();
  renderTables();
  renderNotifications();
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function savePreferences() {
  preferences.hideInactive = hideInactiveTables;
  preferences.sortByUpcoming = sortByUpcoming;
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

function applyVisualSettings() {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.style.removeProperty('--table-columns');
}

function applySettingsToState() {
  const now = Date.now();
  state.tables.forEach((table) => {
    table.hookahs.forEach((hookah) => {
      hookah.intervalMinutes = settings.intervalMinutes;
      hookah.replacements = settings.replacements;
      if (!Number.isFinite(hookah.replacements) || hookah.replacements < 1) {
        hookah.replacements = 1;
      }

      if (hookah.status === 'idle') {
        hookah.expectedEndTime = null;
        hookah.nextReminderTime = null;
        hookah.alertNotified = null;
        hookah.startedAt = null;
        hookah.lastServiceAt = null;
        hookah.preheatStartedAt = null;
        hookah.preheatUntil = null;
        hookah.orderStartedAt = null;
        hookah.overtimeStartedAt = null;
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

      if (hookah.status === 'overtime') {
        hookah.expectedEndTime = hookah.expectedEndTime ?? hookah.startedAt + getHookahTotalMs(hookah);
        hookah.nextReminderTime = null;
        hookah.alertNotified = null;
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
        if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
          enterHookahOvertime(table, hookah, hookah.expectedEndTime);
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

function isHookahEngaged(hookah) {
  if (!hookah) {
    return false;
  }
  return (
    hookah.status === 'active' ||
    hookah.status === 'preheat' ||
    hookah.status === 'ordered' ||
    hookah.status === 'overtime'
  );
}

function getVisibleHookahIndices(table) {
  const engaged = table.hookahs.filter((hookah) => isHookahEngaged(hookah));
  const visible = engaged.map((hookah) => hookah.index);
  const desired = Math.min(HOOKAHS_PER_TABLE, Math.max(1, visible.length + 1));

  if (visible.length < desired) {
    table.hookahs.forEach((hookah) => {
      if (visible.length >= desired) {
        return;
      }
      if (!visible.includes(hookah.index)) {
        visible.push(hookah.index);
      }
    });
  }

  return visible.slice(0, desired);
}

function getFreeHookahSlots(table) {
  return table.hookahs.filter((hookah) => hookah.status === 'idle').length;
}

function getActiveHookahCount(table) {
  return table.hookahs.filter((hookah) => isHookahEngaged(hookah)).length;
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
      const hasActive = table.hookahs.some((hookah) => isHookahEngaged(hookah));
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
      const visibleIndices = getVisibleHookahIndices(table);
      visibleIndices.forEach((hookahIndex) => {
        const hookah = table.hookahs[hookahIndex - 1];
        if (!hookah) {
          return;
        }
        const hookahNode = chipTemplate.content.firstElementChild.cloneNode(true);
        const button = hookahNode.querySelector('[data-action="toggle-hookah"]');
        const timerNode = hookahNode.querySelector('[data-timer]');
        const removeButton = hookahNode.querySelector('[data-action="remove-hookah"]');

        hookahNode.dataset.tableId = table.id;
        hookahNode.dataset.hookahIndex = hookah.index;

        const alert = getHookahAlertLevel(hookah, now);
        hookahNode.dataset.alert = alert;

        if (hookah.status === 'active') {
          hookahNode.dataset.state = 'active';
          if (timerNode) {
            const startedAt = hookah.startedAt ?? now;
            timerNode.textContent = formatStopwatch(now - startedAt);
          }
        } else if (hookah.status === 'overtime') {
          hookahNode.dataset.state = 'overtime';
          if (timerNode) {
            const startedAt = hookah.startedAt ?? now;
            timerNode.textContent = formatStopwatch(now - startedAt);
          }
        } else if (hookah.status === 'ordered') {
          hookahNode.dataset.state = 'ordered';
          if (timerNode) {
            const startedAt = hookah.orderStartedAt ?? now;
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
      });
    }

    fragment.appendChild(node);
  });

  tableContainer.appendChild(fragment);
  updateBulkControls(dueCount, dueOrSoonCount);
}

function getTableSummary(table, now) {
  if (table.sessionExpired) {
    if (table.sessionExpiredAt) {
      return `+${formatStopwatch(now - table.sessionExpiredAt)}`;
    }
    return '+00:00';
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
    return 'expired';
  }
  let hasSoon = false;
  let hasServing = false;
  let hasPending = false;
  let hasOvertime = false;
  table.hookahs.forEach((hookah) => {
    if (hookah.status === 'ordered') {
      hasPending = true;
      return;
    }
    if (hookah.status === 'preheat') {
      hasServing = true;
      return;
    }
    if (hookah.status === 'overtime') {
      hasOvertime = true;
      return;
    }
    if (hookah.status !== 'active') {
      return;
    }
    hasServing = true;
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
  if (hasServing) {
    return 'ok';
  }
  if (hasOvertime) {
    return 'overtime';
  }
  if (hasPending) {
    return 'pending';
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
  if (hookah.status === 'ordered') {
    return 'ordered';
  }
  if (hookah.status === 'preheat') {
    return 'preheat';
  }
  if (hookah.status === 'overtime') {
    return 'overtime';
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

  if (hookah.status !== 'active' && hookah.status !== 'overtime') {
    container.hidden = true;
    markers.innerHTML = '';
    meta.textContent = '';
    return;
  }

  const segments = hookah.replacements + 1;
  const totalMs = getHookahTotalMs(hookah);
  const elapsed = now - (hookah.startedAt || now);
  const ratio = hookah.status === 'overtime' ? 1 : clamp(elapsed / totalMs);
  const replacementsDone = Math.min(
    hookah.replacements,
    Math.floor(elapsed / (hookah.intervalMinutes * 60 * 1000)),
  );

  const totalReplacements = Math.max(1, hookah.replacements);
  meta.textContent = `Замены ${Math.min(replacementsDone, totalReplacements)} / ${totalReplacements}`;

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
  const activeHookahs = table.hookahs.filter(
    (hookah) => hookah.status === 'active' || hookah.status === 'preheat' || hookah.status === 'overtime',
  );
  if (!activeHookahs.length) {
    table.sessionStartedAt = null;
    table.sessionEndTime = null;
    table.sessionExpired = false;
    table.sessionExpiredAt = null;
    return;
  }

  const now = Date.now();
  const durationMs = getTableDurationMs();
  const startTimes = activeHookahs.map((hookah) => {
    if (hookah.status === 'active' || hookah.status === 'overtime') {
      return hookah.startedAt ?? now;
    }
    return hookah.preheatStartedAt ?? now;
  });
  const earliestStart = Math.min(...startTimes);

  table.sessionStartedAt = earliestStart;

  const endCandidates = activeHookahs.map((hookah) => {
    const base = hookah.status === 'active' || hookah.status === 'overtime'
      ? hookah.startedAt ?? now
      : hookah.preheatStartedAt ?? now;
    return base + durationMs;
  });

  table.sessionEndTime = Math.max(...endCandidates);
}

function activateHookahSession(table, hookah, startTime = Date.now()) {
  hookah.status = 'active';
  hookah.preheatStartedAt = null;
  hookah.preheatUntil = null;
  hookah.orderStartedAt = null;
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
  hookah.overtimeStartedAt = null;

  if (!table.sessionStartedAt || table.sessionExpired) {
    table.sessionStartedAt = startTime;
  }
  table.sessionExpired = false;
  table.sessionExpiredAt = null;
  updateTableSession(table);
}

function enterHookahOvertime(table, hookah, timestamp = Date.now()) {
  if (!hookah) {
    return;
  }
  logEvent('coal_overtime', {
    table_id: table.id,
    hookah_id: hookah.index,
  });
  hookah.status = 'overtime';
  hookah.overtimeStartedAt = hookah.overtimeStartedAt ?? timestamp;
  hookah.nextReminderTime = null;
  hookah.alertNotified = null;
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
    case 'overtime':
      return '#9da3c0';
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
  return `${hours}:${minutes.toString().padStart(2, '0')}`;
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
      table.sessionExpiredAt = table.sessionExpiredAt ?? table.sessionEndTime ?? now;
      table.sessionEndTime = null;
      showNotification(`${table.name}: время стола закончилось.`, 'danger');
      logEvent('table_session_expired', {
        table_id: table.id,
      });
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

      if (hookah.status === 'overtime') {
        return;
      }

      if (hookah.status !== 'active') {
        return;
      }

      if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
        enterHookahOvertime(table, hookah, hookah.expectedEndTime);
        dirty = true;
        return;
      }

      if (!hookah.nextReminderTime) {
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

function orderHookah(tableId, hookahIndex) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const hookah = table.hookahs[hookahIndex - 1];
  if (!hookah || hookah.status !== 'idle') {
    return;
  }
  const now = Date.now();
  hookah.status = 'ordered';
  hookah.orderStartedAt = now;
  hookah.startedAt = null;
  hookah.lastServiceAt = null;
  hookah.expectedEndTime = null;
  hookah.nextReminderTime = null;
  hookah.alertNotified = null;
  hookah.preheatStartedAt = null;
  hookah.preheatUntil = null;
  hookah.overtimeStartedAt = null;
  logEvent('hookah_ordered', {
    table_id: tableId,
    hookah_id: hookahIndex,
  });
  saveState();
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
  hookah.orderStartedAt = null;
  hookah.overtimeStartedAt = null;

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
    }
    table.sessionExpired = false;
    table.sessionExpiredAt = null;
    updateTableSession(table);
    logEvent('hookah_preheat_started', {
      table_id: tableId,
      hookah_id: hookahIndex,
    });
  } else {
    activateHookahSession(table, hookah, now);
    logEvent('hookah_session_started', {
      table_id: tableId,
      hookah_id: hookahIndex,
    });
  }

  saveState();
  renderTables();
}

function advanceHookahCycle(table, hookah, now) {
  if (!hookah || hookah.status !== 'active') {
    return;
  }

  if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
    enterHookahOvertime(table, hookah, hookah.expectedEndTime);
    return;
  }

  const intervalMs = hookah.intervalMinutes * 60 * 1000;
  const startTime = hookah.startedAt ?? now;
  const previousReminder = hookah.nextReminderTime ?? (hookah.lastServiceAt ?? startTime) + intervalMs;
  let nextReminderTime = previousReminder + intervalMs;

  if (hookah.expectedEndTime && nextReminderTime >= hookah.expectedEndTime) {
    nextReminderTime = hookah.expectedEndTime;
  }

  while (
    (!hookah.expectedEndTime && nextReminderTime <= now) ||
    (hookah.expectedEndTime && nextReminderTime <= now && nextReminderTime < hookah.expectedEndTime)
  ) {
    nextReminderTime += intervalMs;
    if (hookah.expectedEndTime && nextReminderTime >= hookah.expectedEndTime) {
      nextReminderTime = hookah.expectedEndTime;
      break;
    }
  }

  hookah.lastServiceAt = now;
  hookah.nextReminderTime = nextReminderTime;
  hookah.alertNotified = null;
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
  advanceHookahCycle(table, hookah, now);
  logEvent('coal_replace', {
    table_id: tableId,
    hookah_id: hookahIndex,
  });
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
    hookah.orderStartedAt = null;
    hookah.overtimeStartedAt = null;
  });
  table.sessionStartedAt = null;
  table.sessionEndTime = null;
  table.sessionExpired = false;
  table.sessionExpiredAt = null;
  updateTableSession(table);
  logEvent('table_reset', {
    table_id: tableId,
  });
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
  hookah.orderStartedAt = null;
  hookah.overtimeStartedAt = null;

  if (!table.hookahs.some((item) => isHookahEngaged(item))) {
    table.sessionExpired = false;
    table.sessionExpiredAt = null;
  }

  updateTableSession(table);
  logEvent('hookah_removed', {
    table_id: tableId,
    hookah_id: hookahIndex,
  });
  saveState();
  renderTables();
}

function transferHookahs(fromId, toId, hookahIndices = []) {
  if (!fromId || !toId) {
    return { success: false, reason: 'Укажите столы для переноса.' };
  }
  if (fromId === toId) {
    return { success: false, reason: 'Выберите другой стол для переноса.' };
  }
  const source = state.tables.find((item) => item.id === fromId);
  const target = state.tables.find((item) => item.id === toId);
  if (!source || !target) {
    return { success: false, reason: 'Не удалось определить выбранные столы.' };
  }
  const selection = (hookahIndices ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const selectedSet = new Set(selection);
  const activeHookahs = source.hookahs.filter(
    (hookah) =>
      (hookah.status === 'active' ||
        hookah.status === 'preheat' ||
        hookah.status === 'ordered' ||
        hookah.status === 'overtime') &&
      (selectedSet.size === 0 || selectedSet.has(hookah.index)),
  );
  if (!activeHookahs.length) {
    return { success: false, reason: 'Выберите кальяны для переноса.' };
  }
  const transferredIndices = new Set(activeHookahs.map((hookah) => hookah.index));
  const availableSlots = target.hookahs.filter((hookah) => hookah.status === 'idle');
  if (availableSlots.length < activeHookahs.length) {
    return { success: false, reason: 'Недостаточно свободных кальянов на целевом столе.' };
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
    destination.orderStartedAt = hookah.orderStartedAt;
    destination.overtimeStartedAt = hookah.overtimeStartedAt;
  });

  source.hookahs.forEach((hookah) => {
    if (
      transferredIndices.has(hookah.index) &&
      (hookah.status === 'active' || hookah.status === 'preheat' || hookah.status === 'ordered' || hookah.status === 'overtime')
    ) {
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
      hookah.orderStartedAt = null;
      hookah.overtimeStartedAt = null;
    }
  });

  target.sessionExpired = false;
  target.sessionExpiredAt = null;
  updateTableSession(target);

  const sourceHasServing = source.hookahs.some((hookah) => hookah.status === 'active' || hookah.status === 'preheat');
  if (!sourceHasServing) {
    source.sessionExpired = false;
    source.sessionExpiredAt = null;
    source.sessionStartedAt = null;
    source.sessionEndTime = null;
  }

  updateTableSession(source);

  saveState();
  renderTables();
  logEvent('hookah_transfer', {
    from_table_id: fromId,
    to_table_id: toId,
    hookah_indices: Array.from(transferredIndices),
  });
  return { success: true };
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

function applyHeaderCollapseState() {
  const body = document.body;
  if (!body) {
    return;
  }
  body.classList.toggle('header-collapsed', headerCollapsed);
  if (headerToggleButton) {
    headerToggleButton.setAttribute('aria-expanded', headerCollapsed ? 'false' : 'true');
    headerToggleButton.textContent = headerCollapsed ? 'Показать шапку' : 'Скрыть шапку';
  }
}

function applyControlPanelState() {
  const body = document.body;
  if (!body) {
    return;
  }
  body.classList.toggle('controls-collapsed', controlsCollapsed);
  if (controlPanelToggle) {
    controlPanelToggle.setAttribute('aria-expanded', controlsCollapsed ? 'false' : 'true');
    controlPanelToggle.textContent = controlsCollapsed ? 'Показать панель' : 'Скрыть панель';
  }
  if (controlPanel) {
    controlPanel.setAttribute('aria-hidden', controlsCollapsed ? 'true' : 'false');
  }
}

function closeDialog(node) {
  if (!node) {
    return;
  }
  if (node === confirmDialog) {
    pendingResetTableId = null;
  }
  if (node === transferDialog) {
    clearTransferError();
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


function buildTransferDestinationOptions(excludeId, preferredValue, requiredSlots = 1) {
  if (!transferToSelect) {
    return;
  }

  transferToSelect.innerHTML = '';

  const destinations = state.tables.filter((table) => table.id !== excludeId);
  if (!destinations.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Нет доступных столов';
    placeholder.disabled = true;
    placeholder.selected = true;
    transferToSelect.appendChild(placeholder);
    return;
  }

  const options = destinations.map((table) => {
    const option = document.createElement('option');
    option.value = table.id;
    const freeSlots = getFreeHookahSlots(table);
    option.textContent = `${table.name} (свободно ${freeSlots})`;
    option.dataset.freeSlots = String(freeSlots);
    if (freeSlots < requiredSlots) {
      option.disabled = true;
      option.textContent += ' — нет мест';
    }
    transferToSelect.appendChild(option);
    return option;
  });

  const availableOptions = options.filter((option) => !option.disabled);
  let target = null;
  if (availableOptions.length) {
    target = availableOptions.find((option) => option.value === preferredValue) ?? availableOptions[0];
  } else {
    target = options.find((option) => option.value === preferredValue) ?? options[0] ?? null;
  }
  if (target) {
    transferToSelect.value = target.value;
  }
}

function renderTransferHookahChoices(tableId) {
  if (!transferHookahList) {
    return;
  }
  transferHookahList.innerHTML = '';

  if (!tableId) {
    const empty = document.createElement('p');
    empty.className = 'transfer-hookah-list__empty';
    empty.textContent = 'Выберите стол для отображения активных кальянов.';
    transferHookahList.appendChild(empty);
    return;
  }

  const table = state.tables.find((item) => item.id === tableId) ?? null;
  if (!table) {
    const empty = document.createElement('p');
    empty.className = 'transfer-hookah-list__empty';
    empty.textContent = 'Стол не найден.';
    transferHookahList.appendChild(empty);
    return;
  }

  const hookahs = table.hookahs.filter((hookah) => isHookahEngaged(hookah));
  if (!hookahs.length) {
    const empty = document.createElement('p');
    empty.className = 'transfer-hookah-list__empty';
    empty.textContent = 'На столе нет активных кальянов для переноса.';
    transferHookahList.appendChild(empty);
    return;
  }

  const now = Date.now();
  hookahs.forEach((hookah) => {
    const option = document.createElement('label');
    option.className = 'transfer-hookah-option';
    option.dataset.alert = getHookahAlertLevel(hookah, now);
    option.dataset.state = hookah.status;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'hookahs';
    checkbox.value = hookah.index;
    checkbox.checked = true;

    const body = document.createElement('span');
    body.className = 'transfer-hookah-option__body';

    const title = document.createElement('span');
    title.className = 'transfer-hookah-option__title';
    title.textContent = `Кальян ${hookah.index}`;

    const meta = document.createElement('span');
    meta.className = 'transfer-hookah-option__meta';
    meta.textContent = getTransferHookahDescription(hookah, now);

    body.appendChild(title);
    body.appendChild(meta);

    option.appendChild(checkbox);
    option.appendChild(body);
    transferHookahList.appendChild(option);
  });
}

function getSelectedTransferHookahs() {
  if (!transferHookahList) {
    return [];
  }
  return Array.from(transferHookahList.querySelectorAll('input[name="hookahs"]:checked'))
    .map((input) => Number(input.value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function getTransferSelectionCount() {
  return getSelectedTransferHookahs().length;
}

function getTransferHookahDescription(hookah, now) {
  switch (hookah.status) {
    case 'ordered': {
      const elapsed = hookah.orderStartedAt ? now - hookah.orderStartedAt : 0;
      return `ожидание ${formatStopwatch(elapsed)}`;
    }
    case 'preheat': {
      const remaining = hookah.preheatUntil ? hookah.preheatUntil - now : PREHEAT_MINUTES * 60 * 1000;
      return `прогрев ${formatCountdownClock(remaining)}`;
    }
    case 'active': {
      if (hookah.expectedEndTime && now >= hookah.expectedEndTime) {
        return `overtime +${formatCountdownClock(now - hookah.expectedEndTime)}`;
      }
      if (hookah.nextReminderTime) {
        const diff = hookah.nextReminderTime - now;
        if (diff > 0) {
          return `до замены ${formatCountdownClock(diff)}`;
        }
        return 'замена сейчас';
      }
      return 'в работе';
    }
    case 'overtime': {
      const overtimeBase = hookah.overtimeStartedAt ?? hookah.expectedEndTime ?? hookah.startedAt ?? now;
      return `overtime +${formatCountdownClock(now - overtimeBase)}`;
    }
    default:
      return '';
  }
}

function populateTransferForm() {
  if (!transferForm || !transferFromSelect) {
    return;
  }

  transferFromSelect.innerHTML = '';

  const activeTables = state.tables.filter((table) => getActiveHookahCount(table) > 0);
  let initialFrom = '';

  if (!activeTables.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Нет активных столов';
    placeholder.disabled = true;
    placeholder.selected = true;
    transferFromSelect.appendChild(placeholder);
  } else {
    activeTables.forEach((table) => {
      const optionFrom = document.createElement('option');
      optionFrom.value = table.id;
      optionFrom.textContent = table.name;
      optionFrom.dataset.activeCount = String(getActiveHookahCount(table));
      transferFromSelect.appendChild(optionFrom);
    });
    initialFrom = activeTables[0].id;
    transferFromSelect.value = initialFrom;
  }

  renderTransferHookahChoices(initialFrom);
  const preferredDestination = transferToSelect?.value ?? '';
  syncTransferDestination(preferredDestination);
  clearTransferError();
  updateTransferSubmitState();
}

function clearTransferError() {
  if (!transferErrorNode) {
    return;
  }
  transferErrorNode.textContent = '';
  transferErrorNode.hidden = true;
}

function showTransferError(message) {
  if (!transferErrorNode) {
    return;
  }
  transferErrorNode.textContent = message;
  transferErrorNode.hidden = false;
}

function syncTransferDestination(preferredValue = '') {
  if (!transferFromSelect) {
    return;
  }
  const fromId = transferFromSelect.value;
  const previousValue = preferredValue || transferToSelect?.value || '';
  const requiredSlots = Math.max(1, getTransferSelectionCount());
  buildTransferDestinationOptions(fromId, previousValue, requiredSlots);
}

function updateTransferSubmitState() {
  if (!transferSubmitButton) {
    return;
  }
  if (!transferFromSelect || !transferToSelect) {
    transferSubmitButton.disabled = true;
    clearTransferError();
    return;
  }

  const fromId = transferFromSelect.value;
  const toId = transferToSelect.value;
  const selectionCount = getTransferSelectionCount();
  const fromTable = state.tables.find((item) => item.id === fromId) ?? null;
  const toTable = state.tables.find((item) => item.id === toId) ?? null;
  let message = '';
  let disabled = false;

  if (!fromId) {
    message = 'Выберите стол с активными кальянами';
    disabled = true;
  } else if (!selectionCount) {
    message = 'Отметьте кальяны для переноса';
    disabled = true;
  } else if (!toId || !transferToSelect.options.length) {
    message = 'Нет доступного стола для переноса';
    disabled = true;
  } else if (!fromTable || !toTable) {
    message = 'Выберите доступные столы';
    disabled = true;
  } else if (fromId === toId) {
    message = 'Выберите разные столы';
    disabled = true;
  } else {
    const freeSlots = getFreeHookahSlots(toTable);
    if (freeSlots < selectionCount) {
      message = `Свободных мест: ${freeSlots}. Нужно минимум ${selectionCount}.`;
      disabled = true;
    }
  }

  transferSubmitButton.disabled = disabled;

  if (disabled && message) {
    showTransferError(message);
  } else {
    clearTransferError();
  }
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
        advanceHookahCycle(table, hookah, now);
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
    // Snapshot existing settings so we can emit the diff in logs.
    const previousSettings = { ...settings };
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
    logEvent('settings_changed', {
      old_settings: previousSettings,
      new_settings: settings,
    });
    saveSettings();
    applySettingsToState();
    applyVisualSettings();
    renderTables();
    applyInactiveFilter();
    renderNotifications();
    saveState();
    closeDialog(settingsDialog);
  });
}
if (transferOpenButton) {
  transferOpenButton.addEventListener('click', () => {
    populateTransferForm();
    openDialog(transferDialog);
  });
}

if (transferFromSelect) {
  transferFromSelect.addEventListener('change', () => {
    clearTransferError();
    renderTransferHookahChoices(transferFromSelect.value);
    syncTransferDestination();
    updateTransferSubmitState();
  });
}

if (transferHookahList) {
  transferHookahList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('input[name="hookahs"]')) {
      return;
    }
    clearTransferError();
    syncTransferDestination();
    updateTransferSubmitState();
  });
}

if (transferToSelect) {
  transferToSelect.addEventListener('change', () => {
    clearTransferError();
    updateTransferSubmitState();
  });
}

if (transferForm) {
  transferForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(transferForm);
    const fromId = formData.get('from');
    const toId = formData.get('to');
    const selectedHookahs = getSelectedTransferHookahs();
    if (!selectedHookahs.length) {
      showTransferError('Отметьте кальяны для переноса');
      updateTransferSubmitState();
      return;
    }
    const result = transferHookahs(fromId, toId, selectedHookahs);
    if (result.success) {
      clearTransferError();
      closeDialog(transferDialog);
    } else if (result.reason) {
      showTransferError(result.reason);
    }
    updateTransferSubmitState();
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

if (headerToggleButton) {
  headerToggleButton.addEventListener('click', () => {
    headerCollapsed = !headerCollapsed;
    applyHeaderCollapseState();
  });
}

const headerMediaHandler = (event) => {
  headerCollapsed = event.matches;
  applyHeaderCollapseState();
};

if (headerCollapseMedia) {
  if (headerCollapseMedia.addEventListener) {
    headerCollapseMedia.addEventListener('change', headerMediaHandler);
  } else if (headerCollapseMedia.addListener) {
    headerCollapseMedia.addListener(headerMediaHandler);
  }
}

if (controlPanelToggle) {
  controlPanelToggle.addEventListener('click', () => {
    controlsCollapsed = !controlsCollapsed;
    applyControlPanelState();
  });
}

const controlPanelMediaHandler = (event) => {
  controlsCollapsed = event.matches;
  applyControlPanelState();
};

if (controlCollapseMedia) {
  if (controlCollapseMedia.addEventListener) {
    controlCollapseMedia.addEventListener('change', controlPanelMediaHandler);
  } else if (controlCollapseMedia.addListener) {
    controlCollapseMedia.addListener(controlPanelMediaHandler);
  }
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
      orderHookah(tableId, hookahIndex);
      return;
    }
    if (hookah.status === 'ordered') {
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
