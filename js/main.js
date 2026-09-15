import { supabase, supabaseReady } from './supabaseClient.js';
import { signIn, signOut, getSession, onAuthChange } from './auth.js';
import {
  WEEKDAY_SHORT, FREQUENCY_PRESETS, frequencyPhrase, CATEGORIES, EFFORTS, ASSIGNEES,
  STATUS_ORDER, STATUS_LABELS, PRIORITY_LEVELS,
  fetchRooms, fetchTasks, createTask, updateTask, deleteTask, markTaskDone, fetchCompletions,
  dueInfo, priorityInfo, effectiveStatus, setTaskStatus,
} from './tasks.js';
import { PROACTIVE_CATEGORIES, fetchProactiveContent } from './proactive.js';
import { computeStats } from './stats.js';

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

let rooms = [];
let tasks = [];
let completions = [];
let proactiveContent = [];
let activeProactiveCategory = 'decoracio';

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

if (!supabaseReady) {
  showLoginError('Encara falta connectar la base de dades (Supabase). Configura js/config.js amb la URL i la clau publica del projecte.');
  loginForm.querySelector('button').disabled = true;
} else {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      await signIn(email, password);
    } catch (err) {
      showLoginError('No s\'ha pogut entrar: ' + err.message);
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await signOut();
  });

  onAuthChange((session) => {
    if (session) {
      loginView.hidden = true;
      appView.hidden = false;
      loadAll();
    } else {
      appView.hidden = true;
      loginView.hidden = false;
    }
  });

  getSession().then((session) => {
    if (session) {
      loginView.hidden = true;
      appView.hidden = false;
      loadAll();
    }
  });
}

async function loadAll() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  [rooms, tasks, completions, proactiveContent] = await Promise.all([
    fetchRooms(),
    fetchTasks(),
    fetchCompletions(since.toISOString().slice(0, 10)),
    fetchProactiveContent(),
  ]);
  populateFilterSelects();
  populateTaskFormSelects();
  renderKanban();
  renderProactive();
  renderStats();
}

/* Tabs */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = true));
    document.getElementById('tab-' + btn.dataset.tab).hidden = false;
  });
});

/* Filters */
function populateFilterSelects() {
  const roomSelect = document.getElementById('filter-room');
  roomSelect.innerHTML = '<option value="">Totes les habitacions</option>' +
    rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');

  const catSelect = document.getElementById('filter-category');
  catSelect.innerHTML = '<option value="">Totes les categories</option>' +
    CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');

  const effortSelect = document.getElementById('filter-effort');
  effortSelect.innerHTML = '<option value="">Tot l\'esforç</option>' +
    EFFORTS.map((ef) => `<option value="${ef}">${ef}</option>`).join('');

  [roomSelect, catSelect, effortSelect].forEach((sel) => sel.addEventListener('change', renderKanban));
  document.getElementById('filter-search').addEventListener('input', renderKanban);
}

function replaceTask(updated) {
  const idx = tasks.findIndex((t) => t.id === updated.id);
  if (idx !== -1) tasks[idx] = updated;
  else tasks.push(updated);
}

/* Kanban rendering */
const blockedModal = document.getElementById('blocked-modal');
const blockedForm = document.getElementById('blocked-form');
let pendingBlockTaskId = null;

function sortByPriority(items) {
  return items.slice().sort((a, b) => {
    const pa = priorityInfo(a).rank;
    const pb = priorityInfo(b).rank;
    if (pa !== pb) return pa - pb;
    return a.interval_days - b.interval_days;
  });
}

function groupByRoom(items) {
  const groups = new Map();
  const order = ['__general__', ...rooms.map((r) => r.id)];
  items.forEach((t) => {
    const key = t.room_id || '__general__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return order
    .filter((key) => groups.has(key))
    .map((key) => ({
      label: key === '__general__' ? 'General' : rooms.find((r) => r.id === key)?.name || '',
      items: sortByPriority(groups.get(key)),
    }));
}

function renderKanban() {
  const roomFilter = document.getElementById('filter-room').value;
  const categoryFilter = document.getElementById('filter-category').value;
  const effortFilter = document.getElementById('filter-effort').value;
  const searchText = document.getElementById('filter-search').value.trim().toLowerCase();

  const filtered = tasks.filter((t) =>
    (!roomFilter || t.room_id === roomFilter) &&
    (!categoryFilter || t.category === categoryFilter) &&
    (!effortFilter || t.effort === effortFilter) &&
    (!searchText || t.title.toLowerCase().includes(searchText))
  );

  const byStatus = {};
  STATUS_ORDER.forEach((s) => { byStatus[s] = []; });
  filtered.forEach((t) => byStatus[effectiveStatus(t)].push(t));

  const board = document.getElementById('kanban');
  board.innerHTML = STATUS_ORDER.map((status) => `
    <div class="kanban-col" data-status="${status}">
      <h2>${STATUS_LABELS[status]} <span class="col-count">${byStatus[status].length}</span></h2>
      <div class="kanban-cards" data-status="${status}"></div>
    </div>
  `).join('');

  STATUS_ORDER.forEach((status) => {
    const groups = groupByRoom(byStatus[status]);
    const container = board.querySelector(`.kanban-cards[data-status="${status}"]`);
    container.innerHTML = groups.length
      ? groups.map((g) => `
          <div class="room-group-label">${g.label}</div>
          ${g.items.map((t) => taskCardHtml(t)).join('')}
        `).join('')
      : '<p class="empty-col">Cap tasca</p>';
  });

  board.querySelectorAll('.delete-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.id))
  );
  board.querySelectorAll('.edit-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleEdit(btn.dataset.id))
  );
  board.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('mousedown', (e) => e.stopPropagation());
    sel.addEventListener('change', () => applyStatusChange(sel.dataset.id, sel.value));
  });
  board.querySelectorAll('.task-card-actions button').forEach((btn) =>
    btn.addEventListener('mousedown', (e) => e.stopPropagation())
  );
  wireDragEvents(board);
}

function assigneeBadgesHtml(assignee) {
  if (!assignee) return '';
  const badges = assignee === 'ambdos' ? ['marta', 'jordi'] : [assignee];
  return `<div class="assignee-badges">${badges.map((a) =>
    `<span class="assignee-badge ${a}">${a === 'marta' ? 'M' : 'J'}</span>`
  ).join('')}</div>`;
}

function taskCardHtml(task) {
  const roomName = task.rooms?.name || 'General';
  const info = dueInfo(task);
  const priority = priorityInfo(task);
  const status = effectiveStatus(task);
  return `
    <div class="task-card" draggable="true" data-id="${task.id}">
      ${assigneeBadgesHtml(task.assignee)}
      <div class="title">${task.title}</div>
      <div class="meta">
        <span class="badge">${roomName}</span>
        <span class="badge">${task.category}</span>
      </div>
      <div class="priority-row">
        <span class="priority priority-${priority.key}"><span class="priority-dot"></span>${priority.label}${priority.manual ? ' <span class="manual-tag">manual</span>' : ''}</span>
        <span class="due-info ${info.overdue ? 'overdue' : ''}">${info.label}</span>
      </div>
      <div class="frequency-line">${frequencyPhrase(task)}</div>
      ${status === 'bloquejat' && task.blocked_reason ? `<div class="blocked-note">${task.blocked_reason}</div>` : ''}
      <div class="task-card-actions">
        <select class="status-select" data-id="${task.id}" draggable="false" aria-label="Canvia l'estat">
          ${STATUS_ORDER.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        <button class="edit-btn" data-id="${task.id}" draggable="false">Edita</button>
        <button class="delete-btn" data-id="${task.id}" draggable="false">Elimina</button>
      </div>
    </div>`;
}

function wireDragEvents(board) {
  board.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });

  board.querySelectorAll('.kanban-cards').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      applyStatusChange(taskId, col.dataset.status);
    });
  });
}

async function applyStatusChange(taskId, newStatus) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || effectiveStatus(task) === newStatus) return;

  if (newStatus === 'bloquejat') {
    pendingBlockTaskId = taskId;
    document.getElementById('blocked-reason').value = task.blocked_reason || '';
    blockedModal.hidden = false;
    return;
  }
  if (newStatus === 'fet') {
    await handleMarkDone(taskId);
    return;
  }
  try {
    const updated = await setTaskStatus(taskId, newStatus);
    replaceTask(updated);
    renderKanban();
  } catch (err) {
    showToast('No s\'ha pogut canviar l\'estat: ' + err.message, true);
    renderKanban();
  }
}

blockedForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = document.getElementById('blocked-reason').value.trim();
  try {
    const updated = await setTaskStatus(pendingBlockTaskId, 'bloquejat', reason);
    replaceTask(updated);
    blockedModal.hidden = true;
    pendingBlockTaskId = null;
    renderKanban();
  } catch (err) {
    showToast('No s\'ha pogut bloquejar: ' + err.message, true);
  }
});

document.getElementById('blocked-cancel').addEventListener('click', () => {
  blockedModal.hidden = true;
  pendingBlockTaskId = null;
});

async function handleMarkDone(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  try {
    const { task: updated, completion } = await markTaskDone(task);
    replaceTask(updated);
    completions.push(completion);
    renderKanban();
    renderStats();
  } catch (err) {
    showToast('No s\'ha pogut marcar com a feta: ' + err.message, true);
    renderKanban();
  }
}

async function handleDelete(taskId) {
  if (!confirm('Eliminar aquesta tasca?')) return;
  try {
    await deleteTask(taskId);
    tasks = tasks.filter((t) => t.id !== taskId);
    renderKanban();
  } catch (err) {
    showToast('No s\'ha pogut eliminar: ' + err.message, true);
  }
}

function getSelectedWeekdays() {
  return Array.from(document.querySelectorAll('.weekday-toggle.active')).map((b) => Number(b.dataset.day));
}

function setSelectedWeekdays(days) {
  document.querySelectorAll('.weekday-toggle').forEach((b) => {
    b.classList.toggle('active', days.includes(Number(b.dataset.day)));
  });
}

function handleEdit(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  document.getElementById('task-modal-title').textContent = 'Edita tasca';
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-room').value = task.room_id || '';
  document.getElementById('task-category').value = task.category;
  document.getElementById('task-effort').value = task.effort;
  document.getElementById('task-interval').value = task.interval_days;
  setSelectedWeekdays(task.preferred_weekdays || []);
  document.getElementById('task-priority').value = task.priority_override || '';
  document.getElementById('task-assignee').value = task.assignee || '';
  taskModal.hidden = false;
}

/* New task modal */
const taskModal = document.getElementById('task-modal');
const taskForm = document.getElementById('task-form');

function populateTaskFormSelects() {
  document.getElementById('task-room').innerHTML = '<option value="">General (sense habitacio)</option>' +
    rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('task-category').innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('task-effort').innerHTML = EFFORTS.map((ef) => `<option value="${ef}">${ef}</option>`).join('');
  document.getElementById('task-priority').innerHTML = '<option value="">Automatica (segons la data)</option>' +
    PRIORITY_LEVELS.map((p) => `<option value="${p.key}">${p.label}</option>`).join('');
  document.getElementById('task-assignee').innerHTML = '<option value="">Sense assignar</option>' +
    ASSIGNEES.map((a) => `<option value="${a.key}">${a.label}</option>`).join('');

  document.getElementById('task-weekdays').innerHTML = WEEKDAY_SHORT.map((label, i) =>
    `<button type="button" class="weekday-toggle" data-day="${i}">${label}</button>`
  ).join('');
  document.querySelectorAll('.weekday-toggle').forEach((btn) =>
    btn.addEventListener('click', () => btn.classList.toggle('active'))
  );

  document.getElementById('frequency-presets').innerHTML = FREQUENCY_PRESETS.map((p, i) =>
    `<button type="button" class="preset-btn" data-preset="${i}">${p.label}</button>`
  ).join('');
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = FREQUENCY_PRESETS[Number(btn.dataset.preset)];
      document.getElementById('task-interval').value = preset.interval;
      setSelectedWeekdays(preset.weekdays);
    });
  });
}

let editingTaskId = null;

document.getElementById('new-task-btn').addEventListener('click', () => {
  editingTaskId = null;
  taskForm.reset();
  setSelectedWeekdays([]);
  document.getElementById('task-modal-title').textContent = 'Nova tasca';
  taskModal.hidden = false;
});

document.getElementById('task-cancel').addEventListener('click', () => {
  taskModal.hidden = true;
});

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {
    title: document.getElementById('task-title').value.trim(),
    room_id: document.getElementById('task-room').value || null,
    category: document.getElementById('task-category').value,
    effort: document.getElementById('task-effort').value,
    interval_days: Number(document.getElementById('task-interval').value),
    preferred_weekdays: getSelectedWeekdays(),
    assignee: document.getElementById('task-assignee').value || null,
    priority_override: document.getElementById('task-priority').value || null,
  };
  try {
    if (editingTaskId) {
      replaceTask(await updateTask(editingTaskId, fields));
    } else {
      tasks.push(await createTask(fields));
    }
    taskModal.hidden = true;
    editingTaskId = null;
    renderKanban();
  } catch (err) {
    showToast('No s\'ha pogut desar la tasca: ' + err.message, true);
  }
});

/* Vida proactiva */
function renderProactive() {
  const subtabs = document.getElementById('proactive-subtabs');
  subtabs.innerHTML = PROACTIVE_CATEGORIES.map((c) =>
    `<button data-cat="${c.key}" class="${c.key === activeProactiveCategory ? 'active' : ''}">${c.label}</button>`
  ).join('');
  subtabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeProactiveCategory = btn.dataset.cat;
      renderProactive();
    });
  });

  const grid = document.getElementById('proactive-grid');
  const items = proactiveContent.filter((c) => c.category === activeProactiveCategory);
  if (items.length === 0) {
    grid.innerHTML = '<p class="empty-col">Encara no hi ha contingut en aquesta categoria.</p>';
    return;
  }
  grid.innerHTML = items.map((item) => `
    <div class="proactive-card">
      <h3>${item.title}</h3>
      ${item.body ? `<p>${item.body}</p>` : ''}
      ${item.url ? `<a href="${item.url}" target="_blank" rel="noopener">Mes informacio</a>` : ''}
    </div>
  `).join('');
}

/* Estadistiques */
function renderStats() {
  const stats = computeStats(tasks, completions, rooms);
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = `
    <div class="stat-card">
      <div class="value">${stats.totalTasks}</div>
      <div class="label">Tasques totals</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.overdueCount}</div>
      <div class="label">Endarrerides ara mateix</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.last7}</div>
      <div class="label">Fetes en 7 dies</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.last30}</div>
      <div class="label">Fetes en 30 dies</div>
    </div>
    <div class="stat-card wide">
      <div class="label" style="margin-bottom:10px;">Repartiment de feina (30 dies)</div>
      ${stats.perAssignee.map((a) => `
        <div class="bar-row">
          <span class="name">${a.label}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(a.count / stats.maxAssigneeCount) * 100}%"></span></span>
          <span class="count">${a.count}</span>
        </div>
      `).join('')}
      <p class="stat-note">Compta les tasques fetes assignades a cadascu (les d'"ambdos" sumen als dos). No distingeix qui les ha marcat, nomes a qui estaven assignades.</p>
    </div>
    <div class="stat-card wide">
      <div class="label" style="margin-bottom:10px;">Per habitacio (30 dies)</div>
      ${stats.perRoom.map((r) => `
        <div class="bar-row">
          <span class="name">${r.room}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(r.count / stats.maxRoomCount) * 100}%"></span></span>
          <span class="count">${r.count}</span>
        </div>
      `).join('')}
    </div>
  `;
}
