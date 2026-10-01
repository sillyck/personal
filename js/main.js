import { supabase, supabaseReady } from './supabaseClient.js';
import { signIn, signOut, getSession, onAuthChange } from './auth.js';
import {
  WEEKDAY_SHORT, FREQUENCY_PRESETS, frequencyPhrase, CATEGORIES, ASSIGNEES,
  DURATION_PRESETS, DURATION_BUCKETS, formatDuration, matchesDurationBucket,
  STATUS_ORDER, STATUS_LABELS, PRIORITY_LEVELS,
  fetchRooms, fetchTasks, createTask, updateTask, deleteTask, markTaskDone, fetchCompletions,
  dueInfo, priorityInfo, effectiveStatus, setTaskStatus, computeUpcomingDueDates, formatDateKey,
} from './tasks.js';
import { PROACTIVE_CATEGORIES, fetchProactiveContent } from './proactive.js';
import { computeStats } from './stats.js';
import {
  SUPERMARKETS, SECTIONS, fetchShoppingList, addShoppingItem, updateShoppingItem, toggleShoppingItem,
  deleteShoppingItem, clearCheckedItems, fetchItemPrices, addItemPrice, deleteItemPrice,
  PRICE_STORES, loadPriceCatalog, fetchMarketPrices, saveMarketPrice, deleteMarketPrice,
} from './shopping.js';

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
let shoppingItems = [];
let itemPrices = [];
let marketPrices = [];
let priceCatalog = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const labels = ['habitacions', 'tasques', 'historial', 'vida proactiva', 'llista de la compra', 'preus de la compra', 'preus escrits a ma', 'preus per kg'];
  const results = await Promise.allSettled([
    fetchRooms(),
    fetchTasks(),
    fetchCompletions(since.toISOString().slice(0, 10)),
    fetchProactiveContent(),
    fetchShoppingList(),
    fetchItemPrices(),
    fetchMarketPrices(),
    loadPriceCatalog(),
  ]);
  [rooms, tasks, completions, proactiveContent, shoppingItems, itemPrices, marketPrices, priceCatalog] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : []
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      showToast(`No s'ha pogut carregar ${labels[i]}: ${r.reason.message}`, true);
    }
  });
  populateFilterSelects();
  populateTaskFormSelects();
  populateShoppingFormSelects();
  renderKanban();
  renderProactive();
  renderStats();
  renderShoppingList();
  renderPriceTable();
}

/* Tabs */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = true));
    document.getElementById('tab-' + btn.dataset.tab).hidden = false;
    if (btn.dataset.tab === 'calendari') renderCalendar();
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

  const durationSelect = document.getElementById('filter-duration');
  durationSelect.innerHTML = '<option value="">Tota la durada</option>' +
    DURATION_BUCKETS.map((b) => `<option value="${b.key}">${b.label}</option>`).join('');

  [roomSelect, catSelect, durationSelect].forEach((sel) => sel.addEventListener('change', renderKanban));
  document.getElementById('filter-search').addEventListener('input', renderKanban);
}

function replaceTask(updated) {
  const idx = tasks.findIndex((t) => t.id === updated.id);
  if (idx !== -1) tasks[idx] = updated;
  else tasks.push(updated);
}

function replaceInArray(arr, item) {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx !== -1) arr[idx] = item; else arr.push(item);
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
  const durationFilter = document.getElementById('filter-duration').value;
  const searchText = document.getElementById('filter-search').value.trim().toLowerCase();

  const filtered = tasks.filter((t) =>
    (!roomFilter || t.room_id === roomFilter) &&
    (!categoryFilter || t.category === categoryFilter) &&
    matchesDurationBucket(t.duration_minutes, durationFilter) &&
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
        ${task.duration_minutes ? `<span class="badge">~${formatDuration(task.duration_minutes)}</span>` : ''}
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

/* Calendari */
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const CALENDAR_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAY_SHORT[i]);

function getCalendarGridRange(monthDate) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - startOffset);

  const lastOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const endOffset = (lastOfMonth.getDay() + 6) % 7;
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - endOffset));

  return { gridStart, gridEnd, firstOfMonth };
}

function renderCalendar() {
  const { gridStart, gridEnd, firstOfMonth } = getCalendarGridRange(calendarMonth);
  document.getElementById('calendar-month-label').textContent =
    calendarMonth.toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });

  const byDate = new Map();
  tasks.forEach((task) => {
    computeUpcomingDueDates(task, gridStart, gridEnd).forEach((d) => {
      const key = formatDateKey(d);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(task);
    });
  });

  const todayKey = formatDateKey(new Date());
  const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
  const cells = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    const inMonth = d.getMonth() === firstOfMonth.getMonth();
    const dayTasks = byDate.get(key) || [];
    const shown = dayTasks.slice(0, 4);
    cells.push(`
      <div class="calendar-cell ${inMonth ? '' : 'outside'} ${key === todayKey ? 'today' : ''} ${dayTasks.length ? 'has-tasks' : ''}">
        <div class="calendar-day-num">${d.getDate()}</div>
        <div class="calendar-day-tasks">
          ${shown.map((t) => `<button type="button" class="calendar-chip" data-id="${t.id}" title="${t.title}">${t.title}</button>`).join('')}
          ${dayTasks.length > shown.length ? `<div class="calendar-more">+${dayTasks.length - shown.length} més</div>` : ''}
        </div>
      </div>
    `);
  }

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = CALENDAR_WEEKDAYS.map((d) => `<div class="calendar-weekday">${d}</div>`).join('') + cells.join('');
  grid.querySelectorAll('.calendar-chip').forEach((btn) =>
    btn.addEventListener('click', () => handleEdit(btn.dataset.id))
  );
}

document.getElementById('calendar-prev').addEventListener('click', () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('calendar-next').addEventListener('click', () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById('calendar-today').addEventListener('click', () => {
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  renderCalendar();
});

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
    renderCalendar();
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
    renderCalendar();
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
  document.getElementById('task-duration').value = task.duration_minutes;
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
  document.querySelectorAll('#frequency-presets .preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = FREQUENCY_PRESETS[Number(btn.dataset.preset)];
      document.getElementById('task-interval').value = preset.interval;
      setSelectedWeekdays(preset.weekdays);
    });
  });

  document.getElementById('duration-presets').innerHTML = DURATION_PRESETS.map((min) =>
    `<button type="button" class="preset-btn" data-duration="${min}">${formatDuration(min)}</button>`
  ).join('');
  document.querySelectorAll('#duration-presets .preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('task-duration').value = btn.dataset.duration;
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
    duration_minutes: Number(document.getElementById('task-duration').value),
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
    renderCalendar();
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

/* Llista de la compra */
function populateShoppingFormSelects() {
  document.getElementById('shopping-section').innerHTML =
    '<option value="">Secció (opcional)</option>' + SECTIONS.map((s) => `<option value="${s}">${s}</option>`).join('');
}

document.getElementById('qty-minus').addEventListener('click', () => {
  const input = document.getElementById('shopping-qty');
  input.value = Math.max(0, Number(input.value || 0) - 1);
});
document.getElementById('qty-plus').addEventListener('click', () => {
  const input = document.getElementById('shopping-qty');
  input.value = Number(input.value || 0) + 1;
});

const NUMERIC_ONLY = /^\d+([.,]\d+)?$/;

function formatQty(item) {
  const q = Number(item.quantity);
  const qtyStr = Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
  const unit = item.unit && !NUMERIC_ONLY.test(item.unit.trim()) ? item.unit : null;
  return unit ? `${qtyStr} ${unit}` : `x${qtyStr}`;
}

function itemRowHtml(item) {
  return `
    <div class="shopping-item ${item.checked ? 'checked' : ''}">
      <label class="shopping-check">
        <input type="checkbox" data-shopping-id="${item.id}" ${item.checked ? 'checked' : ''}>
        <span class="shopping-item-name">${esc(item.item_name)}</span>
      </label>
      <span class="shopping-qty">${esc(formatQty(item))}</span>
      ${item.note ? `<span class="shopping-item-note">${esc(item.note)}</span>` : ''}
      <span class="shopping-item-actions">
        <button type="button" class="edit-btn" data-price-item="${item.id}" title="Preus i súper on comprar-ho">Súper</button>
        <button type="button" class="delete-btn" data-shopping-delete="${item.id}">Elimina</button>
      </span>
    </div>`;
}

const NO_SUPER = 'Sense súper triat';

function superOrder(name) {
  if (name === NO_SUPER) return -1;
  const i = SUPERMARKETS.indexOf(name);
  return i === -1 ? SUPERMARKETS.length : i;
}

function renderShoppingList() {
  const list = document.getElementById('shopping-list');
  const pending = shoppingItems.filter((i) => !i.checked);
  const checked = shoppingItems.filter((i) => i.checked);
  document.getElementById('shopping-count').textContent =
    `${pending.length} per comprar${checked.length ? ` · ${checked.length} comprats` : ''}`;
  document.getElementById('shopping-clear-btn').hidden = checked.length === 0;

  if (shoppingItems.length === 0) {
    list.innerHTML = '<p class="empty-state">La llista és buida. Afegeix-hi productes aquí dalt, o des de <strong>Preus per kg</strong> amb el botó +.</p>';
    return;
  }

  const bySuper = new Map();
  pending.forEach((item) => {
    const superKey = item.chosen_supermarket || NO_SUPER;
    if (!bySuper.has(superKey)) bySuper.set(superKey, new Map());
    const bySection = bySuper.get(superKey);
    const sectionKey = item.section || 'Sense secció';
    if (!bySection.has(sectionKey)) bySection.set(sectionKey, []);
    bySection.get(sectionKey).push(item);
  });

  let html = '';
  [...bySuper.entries()].sort((a, b) => superOrder(a[0]) - superOrder(b[0])).forEach(([superName, bySection]) => {
    const count = [...bySection.values()].reduce((n, items) => n + items.length, 0);
    html += `<section class="shopping-group"><h3 class="shopping-group-title">${esc(superName)} <span class="col-count">${count}</span></h3>`;
    for (const [sectionName, items] of bySection) {
      html += `<div class="shopping-section-title">${esc(sectionName)}</div>` + items.map(itemRowHtml).join('');
    }
    html += '</section>';
  });
  if (checked.length) {
    html += `<section class="shopping-group done"><h3 class="shopping-group-title">Comprats <span class="col-count">${checked.length}</span></h3>${checked.map(itemRowHtml).join('')}</section>`;
  }
  list.innerHTML = html;

  list.querySelectorAll('[data-shopping-id]').forEach((cb) =>
    cb.addEventListener('change', () => handleToggleShopping(cb.dataset.shoppingId, cb.checked))
  );
  list.querySelectorAll('[data-shopping-delete]').forEach((btn) =>
    btn.addEventListener('click', () => handleDeleteShopping(btn.dataset.shoppingDelete))
  );
  list.querySelectorAll('[data-price-item]').forEach((btn) =>
    btn.addEventListener('click', () => openPriceModal(btn.dataset.priceItem))
  );
}

async function handleToggleShopping(id, checked) {
  try {
    const updated = await toggleShoppingItem(id, checked);
    replaceInArray(shoppingItems, updated);
    renderShoppingList();
  } catch (err) {
    showToast('No s\'ha pogut actualitzar: ' + err.message, true);
  }
}

async function handleDeleteShopping(id) {
  try {
    await deleteShoppingItem(id);
    shoppingItems = shoppingItems.filter((i) => i.id !== id);
    itemPrices = itemPrices.filter((p) => p.shopping_item_id !== id);
    renderShoppingList();
  } catch (err) {
    showToast('No s\'ha pogut eliminar: ' + err.message, true);
  }
}

document.getElementById('shopping-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const itemInput = document.getElementById('shopping-item');
  const qtyInput = document.getElementById('shopping-qty');
  const unitInput = document.getElementById('shopping-unit');
  const sectionSelect = document.getElementById('shopping-section');
  const noteInput = document.getElementById('shopping-note');
  try {
    const created = await addShoppingItem({
      item_name: itemInput.value.trim(),
      quantity: Number(qtyInput.value || 1),
      unit: (() => { const u = unitInput.value.trim(); return u && !NUMERIC_ONLY.test(u) ? u : null; })(),
      section: sectionSelect.value || null,
      note: noteInput.value.trim() || null,
    });
    shoppingItems.push(created);
    itemInput.value = '';
    qtyInput.value = '1';
    unitInput.value = '';
    sectionSelect.value = '';
    noteInput.value = '';
    itemInput.focus();
    renderShoppingList();
  } catch (err) {
    showToast('No s\'ha pogut afegir: ' + err.message, true);
  }
});

document.getElementById('shopping-clear-btn').addEventListener('click', async () => {
  if (!shoppingItems.some((i) => i.checked)) return;
  try {
    await clearCheckedItems(shoppingItems);
    const clearedIds = new Set(shoppingItems.filter((i) => i.checked).map((i) => i.id));
    shoppingItems = shoppingItems.filter((i) => !i.checked);
    itemPrices = itemPrices.filter((p) => !clearedIds.has(p.shopping_item_id));
    renderShoppingList();
  } catch (err) {
    showToast('No s\'han pogut netejar: ' + err.message, true);
  }
});

document.querySelectorAll('#shopping-subtabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#shopping-subtabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.shop-subpanel').forEach((p) => { p.hidden = p.id !== `shop-panel-${btn.dataset.shoptab}`; });
  });
});

/* Preus per kg */
const CATEGORY_ORDER = ['Peix', 'Carn', 'Verdura', 'Fruita'];
const CATEGORY_SECTION = { Peix: 'Peix', Carn: 'Carn', Verdura: 'Fruita i verdura', Fruita: 'Fruita i verdura' };
const MONTHS_CA = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
const priceFmt = new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STALE_DAYS = 14;

function inSeason(product, month) {
  return !product.mesos || product.mesos.includes(month);
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function priceCells(product) {
  return PRICE_STORES.map((store) => {
    if (store.auto) {
      const m = priceCatalog.preus?.[store.key]?.[product.key];
      if (m) return { value: m.preu, unit: m.unitat, title: m.producte, auto: true };
      if (!store.manual) return { value: null, auto: true };
    }
    const row = marketPrices.find((p) => p.product_key === product.key && p.store === store.key);
    return row ? { value: Number(row.price), unit: product.unitat, updatedAt: row.updated_at } : { value: null };
  });
}

function cheapestIndex(product, cells) {
  let best = -1;
  cells.forEach((c, i) => {
    if (c.value != null && c.unit === product.unitat && (best === -1 || c.value < cells[best].value)) best = i;
  });
  return best;
}

function priceCellHtml(product, store, cell, isCheapest) {
  const cls = `num${isCheapest ? ' cheapest' : ''}`;
  if (cell.auto) {
    const text = cell.value == null ? '<span class="muted">—</span>'
      : priceFmt.format(cell.value) + (cell.unit !== product.unitat ? `<span class="unit-note">/${esc(cell.unit)}</span>` : '');
    return `<td class="${cls}" title="${esc(cell.title || 'No en venen aquesta setmana')}">${text}</td>`;
  }
  const age = cell.updatedAt ? daysSince(cell.updatedAt) : null;
  const ageText = age == null ? '' : age <= 0 ? 'avui' : age === 1 ? 'ahir' : `fa ${age} dies`;
  return `<td class="${cls}${age > STALE_DAYS ? ' stale' : ''}">
    <input class="price-input" inputmode="decimal" autocomplete="off" data-key="${product.key}" data-store="${store.key}"
      value="${cell.value == null ? '' : priceFmt.format(cell.value)}" placeholder="—" aria-label="Preu de ${esc(product.nom)} a ${store.label}">
    ${ageText ? `<span class="price-age">${ageText}</span>` : ''}
  </td>`;
}

function renderPriceTable() {
  const table = document.getElementById('prices-table');
  const intro = document.getElementById('prices-intro');
  if (!priceCatalog?.productes) {
    table.innerHTML = '';
    intro.textContent = "No s'han pogut carregar els preus.";
    return;
  }
  const focused = document.activeElement?.classList.contains('price-input') ? document.activeElement.dataset : null;
  const month = new Date().getMonth() + 1;
  const seasonOnly = document.getElementById('prices-season').checked;
  const updated = priceCatalog.preus?.actualitzat;
  intro.textContent = `Preu per kg. Preus automàtics actualitzats el ${updated ? new Date(updated).toLocaleDateString('ca-ES') : '—'}.`
    + (seasonOnly ? ` Productes de temporada de ${MONTHS_CA[month - 1]}.` : '');

  const cols = PRICE_STORES.length + 2;
  let body = '';
  CATEGORY_ORDER.forEach((cat) => {
    const products = priceCatalog.productes.filter((p) => p.categoria === cat && (!seasonOnly || inSeason(p, month)));
    if (!products.length) return;
    body += `<tr class="cat-row"><th colspan="${cols}" scope="rowgroup">${cat}</th></tr>`;
    products.forEach((p) => {
      const cells = priceCells(p);
      const comparable = cells.filter((c) => c.value != null && c.unit === p.unitat).length;
      const best = comparable > 1 ? cheapestIndex(p, cells) : -1;
      const offSeason = !inSeason(p, month);
      body += `<tr class="${offSeason ? 'off-season' : ''}">
        <th class="prod-col" scope="row">${esc(p.nom)}${p.unitat === 'ud' ? ' <span class="unit-note">per unitat</span>' : ''}${offSeason ? ' <span class="unit-note">fora de temporada</span>' : ''}</th>
        ${cells.map((c, i) => priceCellHtml(p, PRICE_STORES[i], c, i === best)).join('')}
        <td><button type="button" class="add-btn" data-add-product="${p.key}" title="Afegeix a la llista" aria-label="Afegeix ${esc(p.nom)} a la llista">+</button></td>
      </tr>`;
    });
  });

  table.innerHTML = `<thead><tr><th class="prod-col" scope="col">Producte</th>${PRICE_STORES.map((s) =>
    `<th class="num" scope="col">${s.label}${s.auto ? '<span class="col-tag">auto</span>' : ''}${s.hint ? `<span class="col-hint">${s.hint}</span>` : ''}</th>`
  ).join('')}<th scope="col"><span class="visually-hidden">Afegeix</span></th></tr></thead>
    <tbody>${body || `<tr><td colspan="${cols}" class="empty-col">Cap producte de temporada aquest mes.</td></tr>`}</tbody>`;

  table.querySelectorAll('.price-input').forEach((input) => {
    input.addEventListener('change', () => handlePriceInput(input));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });
  table.querySelectorAll('[data-add-product]').forEach((btn) =>
    btn.addEventListener('click', () => handleQuickAdd(btn.dataset.addProduct))
  );
  if (focused) {
    table.querySelector(`.price-input[data-key="${focused.key}"][data-store="${focused.store}"]`)?.focus();
  }
}

async function handlePriceInput(input) {
  const { key, store } = input.dataset;
  const raw = input.value.trim().replace(',', '.');
  const others = marketPrices.filter((p) => !(p.product_key === key && p.store === store));
  try {
    if (raw === '') {
      await deleteMarketPrice(key, store);
      marketPrices = others;
    } else {
      const price = Number(raw);
      if (!Number.isFinite(price) || price < 0) throw new Error('escriu un número, per exemple 3,45');
      marketPrices = [...others, await saveMarketPrice(key, store, Math.round(price * 100) / 100)];
    }
  } catch (err) {
    showToast("No s'ha pogut desar el preu: " + err.message, true);
  }
  renderPriceTable();
}

async function handleQuickAdd(key) {
  const product = priceCatalog.productes.find((p) => p.key === key);
  const best = cheapestIndex(product, priceCells(product));
  const store = best === -1 ? null : PRICE_STORES[best].label;
  try {
    const created = await addShoppingItem({
      item_name: product.nom,
      quantity: 1,
      unit: product.unitat === 'kg' ? 'kg' : null,
      section: CATEGORY_SECTION[product.categoria],
      chosen_supermarket: store,
    });
    shoppingItems.push(created);
    renderShoppingList();
    showToast(`${product.nom} afegit a la llista${store ? ` (${store})` : ''}.`);
  } catch (err) {
    showToast("No s'ha pogut afegir: " + err.message, true);
  }
}

document.getElementById('prices-season').addEventListener('change', renderPriceTable);

/* Preus per super */
const priceModal = document.getElementById('price-modal');
const priceForm = document.getElementById('price-form');
let activePriceItemId = null;

function openPriceModal(itemId) {
  activePriceItemId = itemId;
  const item = shoppingItems.find((i) => i.id === itemId);
  document.getElementById('price-modal-title').textContent = `Preus: ${item.item_name}`;
  document.getElementById('price-supermarket').innerHTML = SUPERMARKETS.map((s) => `<option value="${s}">${s}</option>`).join('');
  renderPriceList();
  priceForm.reset();
  priceModal.hidden = false;
}

function renderPriceList() {
  const el = document.getElementById('price-list');
  const item = shoppingItems.find((i) => i.id === activePriceItemId);
  const prices = itemPrices.filter((p) => p.shopping_item_id === activePriceItemId).sort((a, b) => a.price - b.price);
  if (prices.length === 0) {
    el.innerHTML = '<p class="empty-col">Encara no hi ha preus apuntats.</p>';
    return;
  }
  el.innerHTML = prices.map((p, i) => `
    <div class="place-item">
      <div class="place-info">
        <div class="place-name">${p.supermarket}${i === 0 ? ' <span class="badge">més barat</span>' : ''}</div>
        <div class="place-date">${p.price.toFixed(2)} €</div>
      </div>
      <button type="button" class="ghost-btn" data-choose-super="${p.supermarket}">Compra aquí</button>
      <button type="button" class="delete-btn" data-price-id="${p.id}">Elimina</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-choose-super]').forEach((btn) =>
    btn.addEventListener('click', () => handleChooseSupermarket(btn.dataset.chooseSuper))
  );
  el.querySelectorAll('[data-price-id]').forEach((btn) =>
    btn.addEventListener('click', () => handleDeletePrice(btn.dataset.priceId))
  );
}

async function handleChooseSupermarket(supermarket) {
  try {
    const updated = await updateShoppingItem(activePriceItemId, { chosen_supermarket: supermarket });
    replaceInArray(shoppingItems, updated);
    renderShoppingList();
    showToast(`Comprat marcat per fer-se a ${supermarket}.`);
    priceModal.hidden = true;
  } catch (err) {
    showToast('No s\'ha pogut triar el súper: ' + err.message, true);
  }
}

async function handleDeletePrice(id) {
  try {
    await deleteItemPrice(id);
    itemPrices = itemPrices.filter((p) => p.id !== id);
    renderPriceList();
  } catch (err) {
    showToast('No s\'ha pogut eliminar: ' + err.message, true);
  }
}

document.getElementById('price-close').addEventListener('click', () => { priceModal.hidden = true; });

priceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const supermarket = document.getElementById('price-supermarket').value;
  const price = Number(document.getElementById('price-amount').value);
  try {
    const created = await addItemPrice(activePriceItemId, supermarket, price);
    itemPrices.push(created);
    priceForm.reset();
    renderPriceList();
  } catch (err) {
    showToast('No s\'ha pogut afegir el preu: ' + err.message, true);
  }
});

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
