import { supabase, supabaseReady } from './supabaseClient.js';
import { signIn, signOut, getSession, onAuthChange } from './auth.js';
import {
  WEEKDAY_LABELS, FREQUENCY_LABELS, CATEGORIES, EFFORTS, STATUS_ORDER, STATUS_LABELS,
  fetchRooms, fetchTasks, createTask, deleteTask, markTaskDone, fetchCompletions,
  dueInfo, effectiveStatus, setTaskStatus,
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
}

/* Kanban rendering */
const blockedModal = document.getElementById('blocked-modal');
const blockedForm = document.getElementById('blocked-form');
let pendingBlockTaskId = null;

function renderKanban() {
  const roomFilter = document.getElementById('filter-room').value;
  const categoryFilter = document.getElementById('filter-category').value;
  const effortFilter = document.getElementById('filter-effort').value;

  const filtered = tasks.filter((t) =>
    (!roomFilter || t.room_id === roomFilter) &&
    (!categoryFilter || t.category === categoryFilter) &&
    (!effortFilter || t.effort === effortFilter)
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
    const items = byStatus[status].sort((a, b) => dueInfo(a).diffDays - dueInfo(b).diffDays);
    const container = board.querySelector(`.kanban-cards[data-status="${status}"]`);
    container.innerHTML = items.length
      ? items.map((t) => taskCardHtml(t)).join('')
      : '<p class="empty-col">Cap tasca</p>';
  });

  board.querySelectorAll('.delete-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.id))
  );
  board.querySelectorAll('.status-select').forEach((sel) =>
    sel.addEventListener('change', () => applyStatusChange(sel.dataset.id, sel.value))
  );
  wireDragEvents(board);
}

function taskCardHtml(task) {
  const roomName = task.rooms?.name || 'General';
  const info = dueInfo(task);
  const status = effectiveStatus(task);
  return `
    <div class="task-card" draggable="true" data-id="${task.id}">
      <div class="title">${task.title}</div>
      <div class="meta">
        <span class="badge">${roomName}</span>
        <span class="badge">${task.category}</span>
        <span class="badge">${WEEKDAY_LABELS[task.weekday]}</span>
        <span class="badge">${FREQUENCY_LABELS[task.frequency]}</span>
      </div>
      <div class="due-info ${info.overdue ? 'overdue' : ''}">${info.label}</div>
      ${status === 'bloquejat' && task.blocked_reason ? `<div class="blocked-note">${task.blocked_reason}</div>` : ''}
      <div class="task-card-actions">
        <select class="status-select" data-id="${task.id}" aria-label="Canvia l'estat">
          ${STATUS_ORDER.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        <button class="delete-btn" data-id="${task.id}">Elimina</button>
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
  await setTaskStatus(taskId, newStatus);
  tasks = await fetchTasks();
  renderKanban();
}

blockedForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = document.getElementById('blocked-reason').value.trim();
  await setTaskStatus(pendingBlockTaskId, 'bloquejat', reason);
  blockedModal.hidden = true;
  pendingBlockTaskId = null;
  tasks = await fetchTasks();
  renderKanban();
});

document.getElementById('blocked-cancel').addEventListener('click', () => {
  blockedModal.hidden = true;
  pendingBlockTaskId = null;
});

async function handleMarkDone(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  await markTaskDone(task);
  const since = new Date();
  since.setDate(since.getDate() - 30);
  [tasks, completions] = await Promise.all([fetchTasks(), fetchCompletions(since.toISOString().slice(0, 10))]);
  renderKanban();
  renderStats();
}

async function handleDelete(taskId) {
  if (!confirm('Eliminar aquesta tasca?')) return;
  await deleteTask(taskId);
  tasks = await fetchTasks();
  renderKanban();
}

/* New task modal */
const taskModal = document.getElementById('task-modal');
const taskForm = document.getElementById('task-form');

function populateTaskFormSelects() {
  document.getElementById('task-room').innerHTML = rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('task-category').innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('task-effort').innerHTML = EFFORTS.map((ef) => `<option value="${ef}">${ef}</option>`).join('');
  document.getElementById('task-weekday').innerHTML = WEEKDAY_LABELS.map((w, i) => `<option value="${i}">${w}</option>`).join('');
  document.getElementById('task-frequency').innerHTML = Object.entries(FREQUENCY_LABELS)
    .map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
}

document.getElementById('new-task-btn').addEventListener('click', () => {
  taskForm.reset();
  taskModal.hidden = false;
});

document.getElementById('task-cancel').addEventListener('click', () => {
  taskModal.hidden = true;
});

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await createTask({
    title: document.getElementById('task-title').value.trim(),
    room_id: document.getElementById('task-room').value,
    category: document.getElementById('task-category').value,
    effort: document.getElementById('task-effort').value,
    weekday: Number(document.getElementById('task-weekday').value),
    frequency: document.getElementById('task-frequency').value,
  });
  taskModal.hidden = true;
  tasks = await fetchTasks();
  renderKanban();
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
