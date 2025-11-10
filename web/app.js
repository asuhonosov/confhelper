const STORAGE_KEY = 'hookah-table-manager-state-v1';
const DEFAULT_TABLE_COUNT = 4;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 180;
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;

const tableContainer = document.querySelector('[data-table-list]');
const addTableButton = document.querySelector('[data-action="add-table"]');
const clearLogButton = document.querySelector('[data-action="clear-log"]');
const logList = document.querySelector('[data-log-list]');

const template = document.getElementById('table-card-template');

let tables = loadTables();
let notifications = [];

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `tbl-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function createTable(index) {
  return {
    id: createId(),
    name: `Стол ${index}`,
    intervalMinutes: 20,
    sessionDuration: 90,
    status: 'idle',
    startedAt: null,
    expectedEndTime: null,
    nextReminderTime: null,
    completedAt: null,
  };
}

function ensureTableDefaults(table, index) {
  const safeTable = { ...createTable(index + 1), ...table };
  safeTable.intervalMinutes = clamp(
    Number(safeTable.intervalMinutes) || 20,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES,
  );
  safeTable.sessionDuration = clamp(
    Number(safeTable.sessionDuration) || 90,
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
  );
  safeTable.status = ['idle', 'active', 'completed'].includes(safeTable.status)
    ? safeTable.status
    : 'idle';
  safeTable.startedAt = safeTable.startedAt ?? null;
  safeTable.expectedEndTime = safeTable.expectedEndTime ?? null;
  safeTable.nextReminderTime = safeTable.nextReminderTime ?? null;
  safeTable.completedAt = safeTable.completedAt ?? null;
  return safeTable;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadTables() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return Array.from({ length: DEFAULT_TABLE_COUNT }, (_, idx) => createTable(idx + 1));
    }
    const parsed = JSON.parse(raw);
    const restoredTables = Array.isArray(parsed.tables)
      ? parsed.tables.map(ensureTableDefaults)
      : [];
    if (!restoredTables.length) {
      return Array.from({ length: DEFAULT_TABLE_COUNT }, (_, idx) => createTable(idx + 1));
    }
    reconcileActiveTables(restoredTables);
    return restoredTables;
  } catch (error) {
    console.warn('Не удалось восстановить сохранённые столы', error);
    return Array.from({ length: DEFAULT_TABLE_COUNT }, (_, idx) => createTable(idx + 1));
  }
}

function reconcileActiveTables(restoredTables) {
  const now = Date.now();
  restoredTables.forEach((table, index) => {
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
  if (!tables.length) {
    tableContainer.innerHTML = `
      <div class="empty-state">
        <p>Пока нет ни одного стола. Добавьте их, чтобы начать работу.</p>
        <button type="button" class="primary" data-action="add-table">Добавить стол</button>
      </div>
    `;
    return;
  }

  tableContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const now = Date.now();

  tables.forEach((table, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.tableId = table.id;

    const nameInput = node.querySelector('[data-field="name"]');
    nameInput.value = table.name;
    nameInput.dataset.tableId = table.id;

    const statusNode = node.querySelector('[data-status]');
    const statusLabel = getStatusLabel(table.status);
    statusNode.textContent = statusLabel;
    statusNode.dataset.state = table.status;

    const nextChangeNode = node.querySelector('[data-next-change]');
    const sessionRemainingNode = node.querySelector('[data-session-remaining]');
    const sessionLengthNode = node.querySelector('[data-session-length]');
    const progressNode = node.querySelector('[data-progress]');

    if (table.status === 'active') {
      const nextChangeMs = table.nextReminderTime ? table.nextReminderTime - now : null;
      nextChangeNode.textContent = formatDuration(nextChangeMs);
      const sessionRemainingMs = table.expectedEndTime ? table.expectedEndTime - now : null;
      sessionRemainingNode.textContent = formatDuration(sessionRemainingMs);
      sessionLengthNode.textContent = formatDuration(table.sessionDuration * 60 * 1000);
      const totalMs = table.sessionDuration * 60 * 1000;
      const elapsed = table.startedAt ? now - table.startedAt : 0;
      const progress = totalMs > 0 ? clamp(elapsed / totalMs, 0, 1) : 0;
      progressNode.style.width = `${Math.round(progress * 100)}%`;
    } else if (table.status === 'completed') {
      nextChangeNode.textContent = '—';
      sessionRemainingNode.textContent = 'Сеанс завершён';
      sessionLengthNode.textContent = formatDuration(table.sessionDuration * 60 * 1000);
      progressNode.style.width = '100%';
    } else {
      nextChangeNode.textContent = '—';
      sessionRemainingNode.textContent = '—';
      sessionLengthNode.textContent = formatDuration(table.sessionDuration * 60 * 1000);
      progressNode.style.width = '0%';
    }

    const intervalInput = node.querySelector('[data-field="interval"]');
    intervalInput.value = table.intervalMinutes;
    intervalInput.dataset.tableId = table.id;

    const durationInput = node.querySelector('[data-field="duration"]');
    durationInput.value = table.sessionDuration;
    durationInput.dataset.tableId = table.id;

    const actionsNode = node.querySelector('[data-actions]');
    actionsNode.append(...createButtonsForTable(table));

    fragment.appendChild(node);
  });

  tableContainer.appendChild(fragment);
}

function createButtonsForTable(table) {
  const buttons = [];
  if (table.status !== 'active') {
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'primary';
    startButton.dataset.action = 'start-table';
    startButton.textContent = table.status === 'completed' ? 'Запустить заново' : 'Запустить стол';
    startButton.dataset.tableId = table.id;
    buttons.push(startButton);
  }

  if (table.status === 'active') {
    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'danger';
    stopButton.dataset.action = 'stop-table';
    stopButton.textContent = 'Завершить стол';
    stopButton.dataset.tableId = table.id;
    buttons.push(stopButton);

    const resetReminder = document.createElement('button');
    resetReminder.type = 'button';
    resetReminder.className = 'secondary';
    resetReminder.dataset.action = 'reset-reminder';
    resetReminder.textContent = 'Напомнить через интервал';
    resetReminder.dataset.tableId = table.id;
    buttons.push(resetReminder);
  }

  if (table.status === 'completed') {
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'secondary';
    resetButton.dataset.action = 'reset-table';
    resetButton.textContent = 'Сбросить стол';
    resetButton.dataset.tableId = table.id;
    buttons.push(resetButton);
  }

  if (table.status !== 'active') {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'text-button';
    removeButton.dataset.action = 'remove-table';
    removeButton.textContent = 'Удалить';
    removeButton.dataset.tableId = table.id;
    buttons.push(removeButton);
  }

  return buttons;
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

function addTable() {
  const nextIndex = tables.length + 1;
  tables.push(createTable(nextIndex));
  saveTables();
  renderTables();
  showNotification(`Добавлен новый стол №${nextIndex}`, 'info');
}

function removeTable(tableId) {
  const index = tables.findIndex((table) => table.id === tableId);
  if (index === -1) {
    return;
  }
  const [removed] = tables.splice(index, 1);
  saveTables();
  renderTables();
  showNotification(`Стол «${removed.name}» удалён`, 'info');
}

function startTable(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const now = Date.now();
  const intervalMs = table.intervalMinutes * 60 * 1000;
  const durationMs = table.sessionDuration * 60 * 1000;
  table.status = 'active';
  table.startedAt = now;
  table.expectedEndTime = now + durationMs;
  table.nextReminderTime = now + intervalMs;
  table.completedAt = null;
  saveTables();
  renderTables();
  showNotification(`Стол «${table.name}» запущен. Первое напоминание через ${table.intervalMinutes} мин.`, 'success');
}

function stopTable(tableId) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  table.status = 'idle';
  table.startedAt = null;
  table.expectedEndTime = null;
  table.nextReminderTime = null;
  table.completedAt = null;
  saveTables();
  renderTables();
  showNotification(`Стол «${table.name}» завершён вручную.`, 'info');
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
  saveTables();
  renderTables();
  showNotification(`Следующее напоминание для стола «${table.name}» перенесено.`, 'info');
}

function updateTableName(tableId, newName) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const trimmed = newName.trim();
  table.name = trimmed || table.name;
  saveTables();
}

function updateInterval(tableId, newInterval) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const sanitized = clamp(Number(newInterval) || table.intervalMinutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
  table.intervalMinutes = sanitized;
  if (table.status === 'active') {
    const now = Date.now();
    table.nextReminderTime = Math.min(
      now + sanitized * 60 * 1000,
      table.expectedEndTime || now + sanitized * 60 * 1000,
    );
  }
  saveTables();
  renderTables();
}

function updateDuration(tableId, newDuration) {
  const table = tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  const sanitized = clamp(Number(newDuration) || table.sessionDuration, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);
  table.sessionDuration = sanitized;
  if (table.status === 'active') {
    const now = Date.now();
    const durationMs = sanitized * 60 * 1000;
    const elapsed = table.startedAt ? now - table.startedAt : 0;
    table.expectedEndTime = table.startedAt ? table.startedAt + durationMs : now + durationMs;
    if (table.expectedEndTime <= now) {
      table.expectedEndTime = now;
    }
    table.nextReminderTime = Math.min(
      table.nextReminderTime || now + table.intervalMinutes * 60 * 1000,
      table.expectedEndTime,
    );
  }
  saveTables();
  renderTables();
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
      Math.ceil((table.sessionDuration || 90) / Math.max(1, table.intervalMinutes)) + 2,
    );
    let iterations = 0;
    while (table.nextReminderTime && now >= table.nextReminderTime && table.status === 'active' && iterations < maxIterations) {
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
  const action = event.target.dataset.action;
  if (!action) {
    return;
  }
  const tableId = event.target.dataset.tableId;
  if (!tableId && action !== 'add-table' && action !== 'clear-log') {
    return;
  }

  switch (action) {
    case 'start-table':
      startTable(tableId);
      break;
    case 'stop-table':
      stopTable(tableId);
      break;
    case 'reset-table':
      resetTable(tableId);
      break;
    case 'reset-reminder':
      resetReminder(tableId);
      break;
    case 'remove-table':
      removeTable(tableId);
      break;
    case 'add-table':
      addTable();
      break;
    default:
      break;
  }
}

function handleTableNameInput(event) {
  if (event.target.dataset.field !== 'name') {
    return;
  }
  const tableId = event.target.dataset.tableId;
  updateTableName(tableId, event.target.value);
}

function handleTableSettingsChange(event) {
  const field = event.target.dataset.field;
  if (!field) {
    return;
  }
  const tableId = event.target.dataset.tableId;
  if (field === 'interval') {
    updateInterval(tableId, event.target.value);
  } else if (field === 'duration') {
    updateDuration(tableId, event.target.value);
  }
}

addTableButton?.addEventListener('click', addTable);
clearLogButton?.addEventListener('click', clearLog);
tableContainer.addEventListener('click', handleTableContainerClick);
tableContainer.addEventListener('input', handleTableNameInput);
tableContainer.addEventListener('change', handleTableSettingsChange);

renderTables();
renderNotifications();

setInterval(processTimers, 1000);
