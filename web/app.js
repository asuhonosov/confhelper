const STORAGE_KEY = 'hookah-table-manager-state-v2';
const TABLE_COUNT = 18;
const SESSION_DURATION_MINUTES = 90;
const DEFAULT_INTERVAL_MINUTES = 20;
const FREQUENCY_OPTIONS = [1, 5, 15, 20, 30];
const WARNING_THRESHOLD_MS = 60 * 1000;

const tableContainer = document.querySelector('[data-table-list]');
const clearLogButton = document.querySelector('[data-action="clear-log"]');
const logList = document.querySelector('[data-log-list]');
const template = document.getElementById('table-card-template');
const modal = document.querySelector('[data-modal]');
const modalName = modal?.querySelector('[data-modal-name]');
const modalInterval = modal?.querySelector('[data-modal-interval]');
const modalNextChange = modal?.querySelector('[data-modal-next-change]');
const modalSessionRemaining = modal?.querySelector('[data-modal-session-remaining]');
const modalActions = modal?.querySelector('[data-modal-actions]');
const modalStartButton = modalActions?.querySelector('[data-role="start"]');
const modalRemindButton = modalActions?.querySelector('[data-role="remind"]');
const modalStopButton = modalActions?.querySelector('[data-role="stop"]');
const modalFreeButton = modalActions?.querySelector('[data-role="free"]');
const frequencyOptions = modal?.querySelector('[data-frequency-options]');

let audioContext = null;
let audioUnlockBound = false;

let tables = loadTables();
let notifications = [];
let selectedTableId = null;

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `tbl-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function createTable(index) {
  return {
    id: `table-${index}`,
    name: `Стол ${index}`,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    sessionDuration: SESSION_DURATION_MINUTES,
    status: 'idle',
    startedAt: null,
    expectedEndTime: null,
    nextReminderTime: null,
    completedAt: null,
    alertState: 'none',
  };
}

function ensureTableDefaults(table, index) {
  const base = createTable(index + 1);
  const safeTable = { ...base, ...table };
  safeTable.id = base.id;
  safeTable.name = base.name;
  safeTable.intervalMinutes = FREQUENCY_OPTIONS.includes(Number(safeTable.intervalMinutes))
    ? Number(safeTable.intervalMinutes)
    : DEFAULT_INTERVAL_MINUTES;
  safeTable.sessionDuration = SESSION_DURATION_MINUTES;
  safeTable.status = ['idle', 'active', 'completed'].includes(safeTable.status) ? safeTable.status : 'idle';
  safeTable.startedAt = typeof safeTable.startedAt === 'number' ? safeTable.startedAt : null;
  safeTable.expectedEndTime = typeof safeTable.expectedEndTime === 'number' ? safeTable.expectedEndTime : null;
  safeTable.nextReminderTime = typeof safeTable.nextReminderTime === 'number' ? safeTable.nextReminderTime : null;
  safeTable.completedAt = typeof safeTable.completedAt === 'number' ? safeTable.completedAt : null;
  safeTable.alertState = safeTable.alertState === 'due' ? 'due' : 'none';
  return safeTable;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadTables() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultTables();
    }
    const parsed = JSON.parse(raw);
    const storedTables = Array.isArray(parsed.tables) ? parsed.tables : [];
    const storedMap = new Map();
    storedTables.forEach((table) => {
      if (table && typeof table.id === 'string') {
        storedMap.set(table.id, table);
      }
    });

    const restored = [];
    for (let index = 0; index < TABLE_COUNT; index += 1) {
      const tableId = `table-${index + 1}`;
      const stored = storedMap.get(tableId);
      restored.push(ensureTableDefaults(stored || {}, index));
    }
    reconcileActiveTables(restored);
    return restored;
  } catch (error) {
    console.warn('Не удалось восстановить сохранённые столы', error);
    return createDefaultTables();
  }
}

function createDefaultTables() {
  return Array.from({ length: TABLE_COUNT }, (_, idx) => createTable(idx + 1));
}

function reconcileActiveTables(restoredTables) {
  const now = Date.now();
  restoredTables.forEach((table) => {
    table.sessionDuration = SESSION_DURATION_MINUTES;
    if (!FREQUENCY_OPTIONS.includes(table.intervalMinutes)) {
      table.intervalMinutes = DEFAULT_INTERVAL_MINUTES;
    }
    if (table.status !== 'active') {
      return;
    }

    if (!table.expectedEndTime || now >= table.expectedEndTime) {
      table.status = 'completed';
      table.completedAt = table.expectedEndTime || now;
      table.startedAt = table.startedAt || null;
      table.expectedEndTime = table.expectedEndTime || null;
      table.nextReminderTime = null;
      return;
    }

    const intervalMs = table.intervalMinutes * 60 * 1000;
    const maxIterations = Math.ceil((table.expectedEndTime - (table.startedAt || now)) / intervalMs) + 2;
    let iterations = 0;
    while (table.nextReminderTime && table.nextReminderTime <= now && iterations < maxIterations) {
      table.nextReminderTime += intervalMs;
      iterations += 1;
    }

    if (!table.nextReminderTime || table.nextReminderTime > table.expectedEndTime) {
      table.nextReminderTime = table.expectedEndTime;
    }
  });
}

function saveTables() {
  const payload = {
    tables: tables.map((table) => ({ ...table })),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function renderTables() {
  tableContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const now = Date.now();

  tables.forEach((table) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.tableId = table.id;
    node.dataset.state = table.status;
    node.dataset.alert = getAlertLevel(table, now);

    const nameNode = node.querySelector('[data-name]');
    if (nameNode) {
      nameNode.textContent = table.name;
    }

    const statusNode = node.querySelector('[data-status]');
    if (statusNode) {
      const statusLabel = getStatusLabel(table.status);
      statusNode.textContent = statusLabel;
      statusNode.dataset.state = table.status;
    }

    const intervalNode = node.querySelector('[data-interval]');
    if (intervalNode) {
      intervalNode.textContent = `${table.intervalMinutes} мин`;
    }

    const nextChangeNode = node.querySelector('[data-next-change]');
    const sessionRemainingNode = node.querySelector('[data-session-remaining]');
    const progressNode = node.querySelector('[data-progress]');

    if (table.status === 'active') {
      const nextChangeMs = table.nextReminderTime ? table.nextReminderTime - now : null;
      if (nextChangeNode) {
        nextChangeNode.textContent = formatDuration(nextChangeMs);
      }
      const sessionRemainingMs = table.expectedEndTime ? table.expectedEndTime - now : null;
      if (sessionRemainingNode) {
        sessionRemainingNode.textContent = formatDuration(sessionRemainingMs);
      }
      if (progressNode) {
        const totalMs = table.sessionDuration * 60 * 1000;
        const elapsed = table.startedAt ? now - table.startedAt : 0;
        const progress = totalMs > 0 ? clamp(elapsed / totalMs, 0, 1) : 0;
        progressNode.style.width = `${Math.round(progress * 100)}%`;
      }
    } else if (table.status === 'completed') {
      if (nextChangeNode) {
        nextChangeNode.textContent = '—';
      }
      if (sessionRemainingNode) {
        sessionRemainingNode.textContent = 'Сеанс завершён';
      }
      if (progressNode) {
        progressNode.style.width = '100%';
      }
    } else {
      if (nextChangeNode) {
        nextChangeNode.textContent = '—';
      }
      if (sessionRemainingNode) {
        sessionRemainingNode.textContent = '—';
      }
      if (progressNode) {
        progressNode.style.width = '0%';
      }
    }

    fragment.appendChild(node);
  });

  tableContainer.appendChild(fragment);

  if (selectedTableId) {
    renderModal();
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'active':
      return 'Активен';
    case 'completed':
      return 'Завершён';
    default:
      return 'Свободен';
  }
}

function getAlertLevel(table, now) {
  if (table.status !== 'active') {
    return 'inactive';
  }
  if (table.alertState === 'due') {
    return 'due';
  }
  if (!table.nextReminderTime) {
    return 'ok';
  }
  const timeLeft = table.nextReminderTime - now;
  if (timeLeft <= 0) {
    return 'due';
  }
  if (timeLeft <= WARNING_THRESHOLD_MS) {
    return 'soon';
  }
  return 'ok';
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

function startTable(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const now = Date.now();
  const intervalMs = table.intervalMinutes * 60 * 1000;
  const durationMs = SESSION_DURATION_MINUTES * 60 * 1000;
  table.sessionDuration = SESSION_DURATION_MINUTES;
  table.status = 'active';
  table.startedAt = now;
  table.expectedEndTime = now + durationMs;
  table.nextReminderTime = Math.min(now + intervalMs, table.expectedEndTime);
  table.completedAt = null;
  table.alertState = 'none';
  saveTables();
  renderTables();
  showNotification(`Стол «${table.name}» запущен. Первое напоминание через ${table.intervalMinutes} мин.`, 'success');
}

function stopTable(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const now = Date.now();
  table.status = 'completed';
  table.startedAt = table.startedAt ?? null;
  table.expectedEndTime = table.expectedEndTime ?? now;
  table.nextReminderTime = null;
  table.completedAt = now;
  table.alertState = 'none';
  saveTables();
  renderTables();
  showNotification(`Сеанс за столом «${table.name}» завершён вручную.`, 'info');
}

function resetTable(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  table.status = 'idle';
  table.startedAt = null;
  table.expectedEndTime = null;
  table.nextReminderTime = null;
  table.completedAt = null;
  table.sessionDuration = SESSION_DURATION_MINUTES;
  table.alertState = 'none';
  saveTables();
  renderTables();
  showNotification(`Стол «${table.name}» сброшен и готов к новому сеансу.`, 'info');
}

function resetReminder(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table || table.status !== 'active') {
    return;
  }
  const now = Date.now();
  const nextTime = now + table.intervalMinutes * 60 * 1000;
  table.nextReminderTime = table.expectedEndTime
    ? Math.min(nextTime, table.expectedEndTime)
    : nextTime;
  table.alertState = 'none';
  saveTables();
  renderTables();
  showNotification(`Следующее напоминание для стола «${table.name}» перенесено.`, 'info');
}

function updateInterval(tableId, newInterval) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const parsed = Number(newInterval);
  if (!FREQUENCY_OPTIONS.includes(parsed) || parsed === table.intervalMinutes) {
    return;
  }
  table.intervalMinutes = parsed;
  if (table.status === 'active') {
    const now = Date.now();
    table.nextReminderTime = Math.min(
      now + parsed * 60 * 1000,
      table.expectedEndTime || now + parsed * 60 * 1000,
    );
    table.alertState = 'none';
  }
  saveTables();
  renderTables();
  showNotification(`Частота смены углей для стола «${table.name}» — каждые ${parsed} мин.`, 'info');
}

function processTimers() {
  const now = Date.now();
  let changed = false;

  tables.forEach((table) => {
    if (table.status !== 'active') {
      return;
    }

    if (table.expectedEndTime && now >= table.expectedEndTime) {
      completeTable(table, true);
      changed = true;
      return;
    }

    const intervalMs = table.intervalMinutes * 60 * 1000;
    const maxIterations = Math.max(
      5,
      Math.ceil(SESSION_DURATION_MINUTES / Math.max(1, table.intervalMinutes)) + 2,
    );
    let iterations = 0;
    while (table.nextReminderTime && now >= table.nextReminderTime && table.status === 'active' && iterations < maxIterations) {
      table.alertState = 'due';
      playAlertSound();
      showNotification(`Стол «${table.name}»: пора сменить угли!`, 'warning');
      const nextCandidate = table.nextReminderTime + intervalMs;
      table.nextReminderTime = table.expectedEndTime
        ? Math.min(nextCandidate, table.expectedEndTime)
        : nextCandidate;
      iterations += 1;
      changed = true;
    }

    if (table.expectedEndTime && now >= table.expectedEndTime && table.status === 'active') {
      completeTable(table, true);
      changed = true;
    }
  });

  if (changed) {
    saveTables();
  }
  renderTables();
}

function completeTable(table, auto = false) {
  table.status = 'completed';
  table.completedAt = Date.now();
  table.nextReminderTime = null;
  table.alertState = 'none';
  if (!table.expectedEndTime) {
    table.expectedEndTime = table.completedAt;
  }
  const message = auto
    ? `Сеанс за столом «${table.name}» завершён.`
    : `Стол «${table.name}» завершён.`;
  showNotification(message, 'success');
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
  logList.innerHTML = '';
  if (!notifications.length) {
    const empty = document.createElement('li');
    empty.className = 'log__item';
    empty.textContent = 'Пока нет уведомлений.';
    logList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  notifications.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'log__item';
    item.dataset.type = entry.type;

    const time = document.createElement('time');
    time.dateTime = entry.timestamp.toISOString();
    time.textContent = entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

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

function handleTableKeyDown(event) {
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

function openTableModal(tableId) {
  if (!modal) {
    return;
  }
  selectedTableId = tableId;
  renderModal();
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const focusTarget =
    (!modalStartButton?.hidden && modalStartButton) ||
    (!modalRemindButton?.hidden && modalRemindButton) ||
    (!modalStopButton?.hidden && modalStopButton) ||
    frequencyOptions?.querySelector('button.is-selected');
  focusTarget?.focus();
}

function closeTableModal() {
  if (!modal) {
    return;
  }
  selectedTableId = null;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderModal() {
  if (!modal || !selectedTableId) {
    return;
  }
  const table = tables.find((item) => item.id === selectedTableId);
  if (!table) {
    closeTableModal();
    return;
  }

  const now = Date.now();
  if (modalName) {
    modalName.textContent = table.name;
  }
  if (modalInterval) {
    modalInterval.textContent = `${table.intervalMinutes} мин`;
  }

  if (table.status === 'active') {
    const nextChangeMs = table.nextReminderTime ? table.nextReminderTime - now : null;
    if (modalNextChange) {
      modalNextChange.textContent = formatDuration(nextChangeMs);
    }
    const remainingMs = table.expectedEndTime ? table.expectedEndTime - now : null;
    if (modalSessionRemaining) {
      modalSessionRemaining.textContent = formatDuration(remainingMs);
    }
  } else if (table.status === 'completed') {
    if (modalNextChange) {
      modalNextChange.textContent = '—';
    }
    if (modalSessionRemaining) {
      modalSessionRemaining.textContent = 'Сеанс завершён';
    }
  } else {
    if (modalNextChange) {
      modalNextChange.textContent = '—';
    }
    if (modalSessionRemaining) {
      modalSessionRemaining.textContent = '—';
    }
  }

  if (frequencyOptions) {
    frequencyOptions.querySelectorAll('button[data-frequency]').forEach((button) => {
      const value = Number(button.dataset.frequency);
      if (value === table.intervalMinutes) {
        button.classList.add('is-selected');
      } else {
        button.classList.remove('is-selected');
      }
    });
  }

  if (modalStartButton) {
    modalStartButton.hidden = table.status === 'active';
    modalStartButton.dataset.action = 'start-table';
    modalStartButton.textContent = table.status === 'completed' ? 'Запустить заново' : 'Запустить стол';
  }

  if (modalRemindButton) {
    modalRemindButton.hidden = table.status !== 'active';
    modalRemindButton.dataset.action = 'reset-reminder';
    modalRemindButton.textContent = table.alertState === 'due'
      ? 'Подтвердить смену углей'
      : 'Напомнить через интервал';
  }

  if (modalStopButton) {
    if (table.status === 'active') {
      modalStopButton.hidden = false;
      modalStopButton.dataset.action = 'stop-table';
      modalStopButton.textContent = 'Завершить стол';
    } else {
      modalStopButton.hidden = true;
    }
  }

  if (modalFreeButton) {
    if (table.status === 'idle') {
      modalFreeButton.hidden = true;
    } else {
      modalFreeButton.hidden = false;
      modalFreeButton.dataset.action = 'reset-table';
      modalFreeButton.textContent = 'Освободить стол';
    }
  }
}

function handleFrequencyClick(event) {
  const button = event.target.closest('button[data-frequency]');
  if (!button || !selectedTableId) {
    return;
  }
  updateInterval(selectedTableId, Number(button.dataset.frequency));
}

function handleModalActionsClick(event) {
  const button = event.target.closest('button[data-role]');
  if (!button || button.hidden || !selectedTableId) {
    return;
  }
  const action = button.dataset.action;
  if (!action) {
    return;
  }
  switch (action) {
    case 'start-table':
      startTable(selectedTableId);
      break;
    case 'stop-table':
      stopTable(selectedTableId);
      break;
    case 'reset-table':
      resetTable(selectedTableId);
      break;
    case 'reset-reminder':
      resetReminder(selectedTableId);
      break;
    default:
      break;
  }
}

function handleModalBackdropClick(event) {
  const isBackdrop = event.target.classList?.contains('modal__backdrop');
  const closeTrigger = event.target.closest?.('[data-modal-close]');
  if (isBackdrop || closeTrigger) {
    closeTableModal();
  }
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && selectedTableId) {
    event.preventDefault();
    closeTableModal();
  }
}

clearLogButton?.addEventListener('click', clearLog);
tableContainer.addEventListener('click', handleTableContainerClick);
tableContainer.addEventListener('keydown', handleTableKeyDown);
modalActions?.addEventListener('click', handleModalActionsClick);
frequencyOptions?.addEventListener('click', handleFrequencyClick);
modal?.addEventListener('click', handleModalBackdropClick);
document.addEventListener('keydown', handleGlobalKeydown);

setupAudioUnlock();

renderTables();
renderNotifications();

setInterval(processTimers, 1000);

function ensureAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function handleAudioUnlock() {
  const ctx = ensureAudioContext();
  if (ctx && ctx.state === 'running') {
    window.removeEventListener('pointerdown', handleAudioUnlock);
    window.removeEventListener('keydown', handleAudioUnlock);
  }
}

function setupAudioUnlock() {
  if (audioUnlockBound) {
    return;
  }
  window.addEventListener('pointerdown', handleAudioUnlock, { passive: true });
  window.addEventListener('keydown', handleAudioUnlock);
  audioUnlockBound = true;
}

function playAlertSound() {
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.setValueAtTime(660, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.5);
}
