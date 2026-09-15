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
import { fetchPlaces, createPlace, deletePlace, photoUrl } from './places.js';
import {
  fetchDocuments, uploadDocument, deleteDocument, signedDocUrl, fetchDocText, parseCsv,
  detectCsvKind, parseOrdersRows, aggregateOrdersToHoldings, parsePlusvaluesRows, upsertHoldingsFromOrders,
  fetchHoldings, createHolding, deleteHolding, setCurrentPrice, updateHolding,
  fetchAllocations, addAllocation, deleteAllocation, projectGrowth,
  ordersToOrderRows, fetchOrders, bulkUpsertOrders, fetchSnapshots, upsertSnapshotToday,
  loadMsciWorldSeries, computePortfolioHistory,
} from './finances.js';
import {
  SUPERMARKETS, SECTIONS, fetchShoppingList, addShoppingItem, updateShoppingItem, toggleShoppingItem,
  deleteShoppingItem, clearCheckedItems, fetchItemPrices, addItemPrice, deleteItemPrice,
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
let places = [];
let travelMap = null;
let countryLayer = null;
let activeCountryFeature = null;
let majorCities = {};
let documents = [];
let holdings = [];
let allocations = [];
let shoppingItems = [];
let itemPrices = [];
let worldGeo = null;
let financeMap = null;
let financeCountryLayer = null;
let activeAllocationHolding = null;
let holdingOrders = [];
let snapshots = [];
let msciSeries = [];
let portfolioHistory = null;
let financeSubtab = 'resum';

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
  const labels = ['habitacions', 'tasques', 'historial', 'vida proactiva', 'mapa', 'documents financers', 'actius', 'llista de la compra', 'distribucio geografica', 'preus de la compra', 'historial d\'ordres', 'fotografies de cartera', 'serie MSCI World'];
  const results = await Promise.allSettled([
    fetchRooms(),
    fetchTasks(),
    fetchCompletions(since.toISOString().slice(0, 10)),
    fetchProactiveContent(),
    fetchPlaces(),
    fetchDocuments(),
    fetchHoldings(),
    fetchShoppingList(),
    fetchAllocations(),
    fetchItemPrices(),
    fetchOrders(),
    fetchSnapshots(),
    loadMsciWorldSeries(),
  ]);
  [rooms, tasks, completions, proactiveContent, places, documents, holdings, shoppingItems, allocations, itemPrices, holdingOrders, snapshots, msciSeries] = results.map((r) =>
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
  renderFinances();
  renderShoppingList();
}

/* Tabs */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = true));
    document.getElementById('tab-' + btn.dataset.tab).hidden = false;
    if (btn.dataset.tab === 'mapa') initTravelMap();
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

/* Mapa de viatges */
const countryModal = document.getElementById('country-modal');
const placeForm = document.getElementById('place-form');

const SPAIN_REGIONS = [
  'Andalusia', 'Aragó', 'Astúries', 'Illes Balears', 'Canàries', 'Cantàbria',
  'Castella-La Manxa', 'Castella i Lleó', 'Catalunya', 'Comunitat Valenciana',
  'Extremadura', 'Galícia', 'Madrid', 'Múrcia', 'Navarra', 'País Basc', 'La Rioja',
  'Ceuta', 'Melilla',
];

const VISIT_COLOR_TIERS = ['#1f2620', '#4f6b57', '#6ea37e', '#8fc79c'];

function visitCount(countryCode) {
  return places.filter((p) => p.country_code === countryCode).length;
}

function countryStyle(feature) {
  const count = visitCount(feature.id);
  const tier = Math.min(count, VISIT_COLOR_TIERS.length - 1);
  return {
    fillColor: VISIT_COLOR_TIERS[tier],
    fillOpacity: count > 0 ? 0.85 : 1,
    color: '#2b332a',
    weight: 1,
  };
}

async function loadWorldGeo() {
  if (!worldGeo) {
    worldGeo = await fetch('data/world-countries.geojson').then((r) => r.json());
  }
  return worldGeo;
}

async function initTravelMap() {
  if (travelMap) {
    travelMap.invalidateSize();
    return;
  }
  travelMap = L.map('travel-map', { worldCopyJump: true }).setView([25, 10], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 8,
  }).addTo(travelMap);

  const [geo, cities] = await Promise.all([
    loadWorldGeo(),
    fetch('data/major-cities.json').then((r) => r.json()),
  ]);
  majorCities = cities;
  countryLayer = L.geoJSON(geo, {
    style: countryStyle,
    onEachFeature: (feature, layer) => {
      layer.on('click', () => openCountryModal(feature));
      layer.on('mouseover', () => layer.setStyle({ fillColor: '#8fc79c' }));
      layer.on('mouseout', () => layer.setStyle(countryStyle(feature)));
    },
  }).addTo(travelMap);
}

function restyleActiveCountry() {
  countryLayer.eachLayer((layer) => {
    if (layer.feature.id === activeCountryFeature.id) layer.setStyle(countryStyle(layer.feature));
  });
}

function openCountryModal(feature) {
  activeCountryFeature = feature;
  document.getElementById('country-modal-title').textContent = feature.properties.name;
  placeForm.reset();

  const cityField = document.getElementById('place-city-field');
  const cities = majorCities[feature.id] || [];
  if (cities.length) {
    document.getElementById('place-city-select').innerHTML =
      '<option value="">-- Tria\'n una --</option>' + cities.map((c) => `<option value="${c}">${c}</option>`).join('');
    cityField.hidden = false;
  } else {
    cityField.hidden = true;
  }

  const regionField = document.getElementById('place-region-field');
  if (feature.id === 'ESP') {
    document.getElementById('place-region').innerHTML =
      '<option value="">Sense especificar</option>' +
      SPAIN_REGIONS.map((r) => `<option value="${r}">${r}</option>`).join('');
    regionField.hidden = false;
  } else {
    regionField.hidden = true;
  }

  renderCountryPlaces();
  countryModal.hidden = false;
}

function renderCountryPlaces() {
  const list = document.getElementById('country-places-list');
  const items = places.filter((p) => p.country_code === activeCountryFeature.id);
  if (items.length === 0) {
    list.innerHTML = '<p class="empty-col">Encara no hi ha cap lloc apuntat aqui.</p>';
    return;
  }
  list.innerHTML = items.map((p) => {
    const dateRange = p.visited_to && p.visited_to !== p.visited_from
      ? `${p.visited_from} → ${p.visited_to}`
      : p.visited_from;
    return `
    <div class="place-item">
      ${p.photo_path ? `<img src="${photoUrl(p.photo_path)}" class="place-photo" alt="">` : ''}
      <div class="place-info">
        <div class="place-name">${p.place_name || p.region_name || 'Visitat'}</div>
        <div class="place-date">${dateRange}${p.region_name && p.place_name ? ` · ${p.region_name}` : ''}</div>
        ${p.notes ? `<div class="place-notes">${p.notes}</div>` : ''}
      </div>
      <button type="button" class="delete-btn" data-place-id="${p.id}">Elimina</button>
    </div>
  `;
  }).join('');
  list.querySelectorAll('.delete-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleDeletePlace(btn.dataset.placeId))
  );
}

async function handleDeletePlace(placeId) {
  const place = places.find((p) => p.id === placeId);
  if (!place || !confirm('Eliminar aquest lloc?')) return;
  try {
    await deletePlace(place);
    places = places.filter((p) => p.id !== placeId);
    renderCountryPlaces();
    restyleActiveCountry();
  } catch (err) {
    showToast('No s\'ha pogut eliminar el lloc: ' + err.message, true);
  }
}

document.getElementById('country-close').addEventListener('click', () => {
  countryModal.hidden = true;
});

document.getElementById('place-city-select').addEventListener('change', (e) => {
  if (e.target.value) document.getElementById('place-name').value = e.target.value;
});

placeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const photoFile = document.getElementById('place-photo').files[0] || null;
  const fields = {
    country_code: activeCountryFeature.id,
    country_name: activeCountryFeature.properties.name,
    region_name: activeCountryFeature.id === 'ESP' ? (document.getElementById('place-region').value || null) : null,
    place_name: document.getElementById('place-name').value.trim() || null,
    visited_from: document.getElementById('place-date-from').value,
    visited_to: document.getElementById('place-date-to').value || null,
    notes: document.getElementById('place-notes').value.trim() || null,
  };
  try {
    const created = await createPlace(fields, photoFile);
    places.push(created);
    placeForm.reset();
    renderCountryPlaces();
    restyleActiveCountry();
  } catch (err) {
    showToast('No s\'ha pogut desar el lloc: ' + err.message, true);
  }
});

/* Finances */
const docModal = document.getElementById('doc-modal');
const docForm = document.getElementById('doc-form');
const holdingModal = document.getElementById('holding-modal');
const holdingForm = document.getElementById('holding-form');
const csvPreviewModal = document.getElementById('csv-preview-modal');

function docTypeLabel(type) {
  return type === 'pdf' ? 'PDF' : type === 'csv' ? 'CSV' : 'Fitxer';
}

function renderDocuments() {
  const grid = document.getElementById('doc-grid');
  if (documents.length === 0) {
    grid.innerHTML = '<p class="empty-col">Encara no has pujat cap document.</p>';
    return;
  }
  grid.innerHTML = documents.map((d) => `
    <div class="doc-card">
      <span class="doc-type-badge">${docTypeLabel(d.file_type)}</span>
      <div class="doc-label">${d.label}</div>
      <div class="doc-meta">${d.file_name} · ${new Date(d.uploaded_at).toLocaleDateString('ca')}</div>
      <div class="doc-actions">
        <button type="button" class="ghost-btn" data-view="${d.id}">Veure</button>
        <button type="button" class="delete-btn" data-doc-id="${d.id}">Elimina</button>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => handleViewDoc(btn.dataset.view))
  );
  grid.querySelectorAll('[data-doc-id]').forEach((btn) =>
    btn.addEventListener('click', () => handleDeleteDoc(btn.dataset.docId))
  );
}

let currentOrdersImport = null;
let currentOrdersRaw = null;

async function handleViewDoc(docId) {
  const doc = documents.find((d) => d.id === docId);
  if (!doc) return;
  try {
    if (doc.file_type === 'csv') {
      const text = await fetchDocText(doc.file_path);
      const rows = parseCsv(text);
      const kind = detectCsvKind(rows);
      document.getElementById('csv-preview-title').textContent = doc.label;
      const importBtn = document.getElementById('csv-import-btn');

      if (kind === 'ordres') {
        const orders = parseOrdersRows(rows);
        document.getElementById('csv-preview-table').innerHTML =
          '<tr><th>Data</th><th>ISIN</th><th>Import</th><th>Participacions</th><th>Estat</th></tr>' +
          orders.map((o) => `
            <tr>
              <td>${o.date}</td>
              <td>${o.isin}</td>
              <td>${o.amount != null ? o.amount.toFixed(2) + ' €' : ''}</td>
              <td>${o.units ?? ''}</td>
              <td><span class="status-badge status-${o.status === 'Finalizada' ? 'ok' : o.status === 'Rechazada' ? 'bad' : 'pending'}">${o.status}</span></td>
            </tr>
          `).join('');
        currentOrdersImport = aggregateOrdersToHoldings(orders);
        currentOrdersRaw = orders;
        importBtn.hidden = false;
        importBtn.textContent = `Actualitza actius (${currentOrdersImport.length} fons)`;
      } else if (kind === 'plusvalues') {
        const rowsData = parsePlusvaluesRows(rows);
        document.getElementById('csv-preview-table').innerHTML =
          '<tr><th>Data</th><th>Inversió</th><th>Valor de mercat</th><th>Resultat</th></tr>' +
          rowsData.map((r) => `
            <tr>
              <td>${r.date}</td>
              <td>${r.invested != null ? r.invested.toFixed(2) + ' €' : ''}</td>
              <td>${r.marketValue != null ? r.marketValue.toFixed(2) + ' €' : ''}</td>
              <td class="${r.result >= 0 ? 'result-positive' : 'result-negative'}">${r.result != null ? r.result.toFixed(2) + ' €' : ''}</td>
            </tr>
          `).join('');
        currentOrdersImport = null;
        currentOrdersRaw = null;
        importBtn.hidden = true;
      } else {
        document.getElementById('csv-preview-table').innerHTML = rows.slice(0, 30).map((row, i) =>
          `<tr>${row.map((cell) => `<${i === 0 ? 'th' : 'td'}>${cell}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`
        ).join('');
        currentOrdersImport = null;
        currentOrdersRaw = null;
        importBtn.hidden = true;
      }
      csvPreviewModal.hidden = false;
    } else {
      const url = await signedDocUrl(doc.file_path);
      window.open(url, '_blank', 'noopener');
    }
  } catch (err) {
    showToast('No s\'ha pogut obrir el document: ' + err.message, true);
  }
}

document.getElementById('csv-import-btn').addEventListener('click', async () => {
  if (!currentOrdersImport) return;
  try {
    await upsertHoldingsFromOrders(currentOrdersImport, holdings);
    holdings = await fetchHoldings();
    if (currentOrdersRaw) {
      await bulkUpsertOrders(ordersToOrderRows(currentOrdersRaw));
      holdingOrders = await fetchOrders();
    }
    renderHoldings();
    renderFinanceSummary();
    renderFinanceMap();
    showToast('Actius actualitzats des del document.');
    csvPreviewModal.hidden = true;
  } catch (err) {
    showToast('No s\'han pogut actualitzar els actius: ' + err.message, true);
  }
});

async function handleDeleteDoc(docId) {
  const doc = documents.find((d) => d.id === docId);
  if (!doc || !confirm('Eliminar aquest document?')) return;
  try {
    await deleteDocument(doc);
    documents = documents.filter((d) => d.id !== docId);
    renderDocuments();
  } catch (err) {
    showToast('No s\'ha pogut eliminar: ' + err.message, true);
  }
}

document.getElementById('new-doc-btn').addEventListener('click', () => {
  docForm.reset();
  docModal.hidden = false;
});
document.getElementById('doc-cancel').addEventListener('click', () => { docModal.hidden = true; });
document.getElementById('csv-preview-close').addEventListener('click', () => { csvPreviewModal.hidden = true; });

docForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('doc-file').files[0];
  const label = document.getElementById('doc-label').value.trim();
  try {
    const created = await uploadDocument(label, file);
    documents.unshift(created);
    docModal.hidden = true;
    renderDocuments();

    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      const rows = parseCsv(text);
      if (detectCsvKind(rows) === 'ordres') {
        const parsedOrders = parseOrdersRows(rows);
        const aggregated = aggregateOrdersToHoldings(parsedOrders);
        const updated = await upsertHoldingsFromOrders(aggregated, holdings);
        updated.forEach((h) => replaceInArray(holdings, h));
        await bulkUpsertOrders(ordersToOrderRows(parsedOrders));
        holdingOrders = await fetchOrders();
        renderHoldings();
        renderFinanceSummary();
        renderFinanceMap();
        const names = updated.map((h) => h.ticker).join(', ');
        showToast(`Detectat automaticament: actualitzats ${updated.length} actius (${names}).`);
      }
    }
  } catch (err) {
    showToast('No s\'ha pogut pujar el document: ' + err.message, true);
  }
});

function renderHoldings() {
  const table = document.getElementById('holdings-table');
  if (holdings.length === 0) {
    table.innerHTML = '<tr><td class="empty-col">Encara no has afegit cap actiu.</td></tr>';
    return;
  }
  table.innerHTML = `
    <tr><th>Ticker / ISIN</th><th>Nom</th><th>Quantitat</th><th>Preu mitjà</th><th>Preu actual</th><th>Països</th><th></th></tr>
    ${holdings.map((h) => `
      <tr>
        <td>${h.ticker}</td>
        <td>
          <form class="name-cell" data-name-form="${h.id}">
            <input type="text" value="${h.name || ''}" placeholder="Sense nom encara">
            <button type="submit" class="ghost-btn">Desa</button>
          </form>
        </td>
        <td>${h.quantity}</td>
        <td>${h.avg_cost ?? ''}</td>
        <td>
          <form class="price-cell" data-price-form="${h.id}">
            <input type="number" step="any" value="${h.current_price ?? ''}" placeholder="ex: 12.34">
            <button type="submit" class="ghost-btn">Desa</button>
          </form>
        </td>
        <td><button type="button" class="ghost-btn" data-allocations="${h.id}">Països</button></td>
        <td><button type="button" class="delete-btn" data-holding-id="${h.id}">Elimina</button></td>
      </tr>
    `).join('')}
  `;
  table.querySelectorAll('[data-holding-id]').forEach((btn) =>
    btn.addEventListener('click', () => handleDeleteHolding(btn.dataset.holdingId))
  );
  table.querySelectorAll('[data-allocations]').forEach((btn) =>
    btn.addEventListener('click', () => openAllocationModal(btn.dataset.allocations))
  );
  table.querySelectorAll('[data-price-form]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const price = form.querySelector('input').value;
      handleSetPrice(form.dataset.priceForm, price ? Number(price) : null);
    })
  );
  table.querySelectorAll('[data-name-form]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSetName(form.dataset.nameForm, form.querySelector('input').value.trim());
    })
  );
}

async function handleSetName(id, name) {
  try {
    const updated = await updateHolding(id, { name: name || null });
    replaceInArray(holdings, updated);
    showToast('Nom desat.');
  } catch (err) {
    showToast('No s\'ha pogut desar el nom: ' + err.message, true);
  }
}

async function handleSetPrice(id, price) {
  try {
    const updated = await setCurrentPrice(id, price);
    replaceInArray(holdings, updated);
    renderFinanceSummary();
    showToast('Preu actualitzat.');
  } catch (err) {
    showToast('No s\'ha pogut desar el preu: ' + err.message, true);
  }
}

function replaceInArray(arr, item) {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx !== -1) arr[idx] = item; else arr.push(item);
}

async function handleDeleteHolding(id) {
  if (!confirm('Eliminar aquest actiu? També s\'esborrarà la seva distribució per país.')) return;
  try {
    await deleteHolding(id);
    holdings = holdings.filter((h) => h.id !== id);
    allocations = allocations.filter((a) => a.holding_id !== id);
    renderHoldings();
    renderFinanceSummary();
    renderFinanceMap();
  } catch (err) {
    showToast('No s\'ha pogut eliminar: ' + err.message, true);
  }
}

document.getElementById('new-holding-btn').addEventListener('click', () => {
  holdingForm.reset();
  holdingModal.hidden = false;
});
document.getElementById('holding-cancel').addEventListener('click', () => { holdingModal.hidden = true; });

holdingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {
    ticker: document.getElementById('holding-ticker').value.trim().toUpperCase(),
    name: document.getElementById('holding-name').value.trim() || null,
    quantity: Number(document.getElementById('holding-quantity').value),
    avg_cost: document.getElementById('holding-cost').value ? Number(document.getElementById('holding-cost').value) : null,
    notes: document.getElementById('holding-notes').value.trim() || null,
  };
  try {
    const created = await createHolding(fields);
    holdings.push(created);
    holdingModal.hidden = true;
    renderHoldings();
    renderFinanceSummary();
  } catch (err) {
    showToast('No s\'ha pogut desar l\'actiu: ' + err.message, true);
  }
});

/* Distribucio geografica dels actius */
const allocationModal = document.getElementById('allocation-modal');
const allocationForm = document.getElementById('allocation-form');

async function openAllocationModal(holdingId) {
  activeAllocationHolding = holdings.find((h) => h.id === holdingId);
  if (!activeAllocationHolding) return;
  document.getElementById('allocation-modal-title').textContent = `Distribució per país: ${activeAllocationHolding.ticker}`;

  const geo = await loadWorldGeo();
  const countrySelect = document.getElementById('allocation-country');
  countrySelect.innerHTML = geo.features
    .slice().sort((a, b) => a.properties.name.localeCompare(b.properties.name))
    .map((f) => `<option value="${f.id}">${f.properties.name}</option>`).join('');

  renderAllocationList();
  allocationForm.reset();
  allocationModal.hidden = false;
}

function renderAllocationList() {
  const list = document.getElementById('allocation-list');
  const items = allocations.filter((a) => a.holding_id === activeAllocationHolding.id);
  const total = items.reduce((s, a) => s + Number(a.percentage), 0);
  if (items.length === 0) {
    list.innerHTML = '<p class="empty-col">Cap país afegit encara.</p>';
    return;
  }
  list.innerHTML = items.map((a) => `
    <div class="place-item">
      <div class="place-info">
        <div class="place-name">${a.country_name}</div>
        <div class="place-date">${a.percentage}%</div>
      </div>
      <button type="button" class="delete-btn" data-alloc-id="${a.id}">Elimina</button>
    </div>
  `).join('') + `<p class="stat-note">Suma actual: ${total.toFixed(1)}%${total > 100 ? ' (per sobre de 100, revisa-ho)' : ''}</p>`;
  list.querySelectorAll('[data-alloc-id]').forEach((btn) =>
    btn.addEventListener('click', () => handleDeleteAllocation(btn.dataset.allocId))
  );
}

async function handleDeleteAllocation(id) {
  try {
    await deleteAllocation(id);
    allocations = allocations.filter((a) => a.id !== id);
    renderAllocationList();
    renderFinanceMap();
  } catch (err) {
    showToast('No s\'ha pogut eliminar: ' + err.message, true);
  }
}

document.getElementById('allocation-close').addEventListener('click', () => {
  allocationModal.hidden = true;
  renderFinanceMap();
});

allocationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const select = document.getElementById('allocation-country');
  const countryCode = select.value;
  const countryName = select.options[select.selectedIndex].text;
  const pct = Number(document.getElementById('allocation-pct').value);
  try {
    const created = await addAllocation(activeAllocationHolding.id, countryCode, countryName, pct);
    allocations.push(created);
    allocationForm.reset();
    renderAllocationList();
  } catch (err) {
    showToast('No s\'ha pogut afegir: ' + err.message, true);
  }
});

function holdingValue(h) {
  return h.quantity * (h.current_price ?? h.avg_cost ?? 0);
}

const FINANCE_SUBTABS = [
  { key: 'resum', label: 'Resum' },
  { key: 'cartera', label: 'Cartera' },
  { key: 'projeccio', label: 'Projecció' },
  { key: 'documents', label: 'Documents' },
];

function renderFinanceSubtabs() {
  const nav = document.getElementById('finance-subtabs');
  nav.innerHTML = FINANCE_SUBTABS.map((t) =>
    `<button type="button" data-fintab="${t.key}" class="${t.key === financeSubtab ? 'active' : ''}">${t.label}</button>`
  ).join('');
  nav.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      financeSubtab = btn.dataset.fintab;
      applyFinanceSubtab();
    });
  });
}

function applyFinanceSubtab() {
  document.querySelectorAll('#finance-subtabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.fintab === financeSubtab)
  );
  document.querySelectorAll('.finance-subpanel').forEach((p) => { p.hidden = true; });
  document.getElementById('finance-panel-' + financeSubtab).hidden = false;
  if (financeSubtab === 'cartera') initFinanceMap();
}

function renderFinanceSummary() {
  const invested = holdings.reduce((s, h) => s + h.quantity * (h.avg_cost || 0), 0);
  const current = holdings.reduce((s, h) => s + holdingValue(h), 0);

  portfolioHistory = (msciSeries && msciSeries.length)
    ? computePortfolioHistory({ orders: holdingOrders, msciSeries, snapshots, currentValue: current })
    : null;

  const shownInvested = portfolioHistory ? portfolioHistory.today.contributed : invested;
  const gain = current - shownInvested;

  document.getElementById('stat-current-value').textContent = current.toFixed(0) + ' €';
  document.getElementById('stat-invested').textContent = shownInvested.toFixed(0) + ' €';
  const gainEl = document.getElementById('stat-gain');
  gainEl.textContent = (gain >= 0 ? '+' : '') + gain.toFixed(0) + ' €';
  gainEl.className = 'value ' + (gain >= 0 ? 'result-positive' : 'result-negative');

  const vsMsciEl = document.getElementById('stat-vs-msci');
  if (portfolioHistory && portfolioHistory.today.diffPct != null) {
    const { diffAbs, diffPct } = portfolioHistory.today;
    vsMsciEl.textContent = `${diffAbs >= 0 ? '+' : ''}${diffAbs.toFixed(0)} € (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%)`;
    vsMsciEl.className = 'value ' + (diffAbs >= 0 ? 'result-positive' : 'result-negative');
  } else {
    vsMsciEl.textContent = '-';
    vsMsciEl.className = 'value';
  }

  document.getElementById('proj-start').value = current > 0 ? current.toFixed(2) : shownInvested.toFixed(2);

  if (portfolioHistory) {
    renderHistoryChart(portfolioHistory);
    if (current > 0) upsertSnapshotToday(current, portfolioHistory.today.contributed).catch(() => {});
  } else {
    document.getElementById('history-chart-wrap').hidden = true;
    document.getElementById('history-empty').hidden = false;
  }
}

function renderHistoryChart(history) {
  document.getElementById('history-empty').hidden = true;
  document.getElementById('history-chart-wrap').hidden = false;
  const container = document.getElementById('history-chart');

  const width = 680;
  const height = 320;
  const padL = 55;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const points = history.points;
  const actualPoints = history.snapshots
    .concat([{ date: history.today.date, actualValue: history.today.actualValue }])
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((p, i, arr) => i === arr.length - 1 || p.date !== arr[i + 1].date);

  const minT = new Date(points[0].date).getTime();
  const maxT = new Date(history.today.date).getTime();
  const span = Math.max(1, maxT - minT);
  const xFor = (dateStr) => padL + ((new Date(dateStr).getTime() - minT) / span) * plotW;

  const maxValue = Math.max(
    ...points.map((p) => Math.max(p.contributed, p.msciValue)),
    ...actualPoints.map((p) => p.actualValue),
    1
  );
  const yFor = (v) => padT + plotH - (v / maxValue) * plotH;

  const contributedPts = points.map((p) => `${xFor(p.date)},${yFor(p.contributed)}`).join(' ');
  const msciPts = points.map((p) => `${xFor(p.date)},${yFor(p.msciValue)}`).join(' ');
  const actualPts = actualPoints.map((p) => `${xFor(p.date)},${yFor(p.actualValue)}`).join(' ');

  const ySteps = 4;
  const yGridlines = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = (maxValue / ySteps) * i;
    return `<line class="chart-axis-line" x1="${padL}" y1="${yFor(v)}" x2="${width - padR}" y2="${yFor(v)}"></line>
      <text class="chart-axis-label" x="${padL - 8}" y="${yFor(v) + 3}" text-anchor="end">${formatCompactEur(v)}</text>`;
  }).join('');

  const tickCount = 5;
  const xLabels = Array.from({ length: tickCount }, (_, i) => {
    const t = minT + (span / (tickCount - 1)) * i;
    const label = new Date(t).toLocaleDateString('ca-ES', { month: 'short', year: 'numeric' });
    return `<text class="chart-axis-label" x="${padL + (plotW / (tickCount - 1)) * i}" y="${height - padB + 16}" text-anchor="middle">${label}</text>`;
  }).join('');

  const actualDotX = xFor(history.today.date);
  const actualDotY = yFor(history.today.actualValue);

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block">
      ${yGridlines}
      <polyline class="chart-contributed-line" points="${contributedPts}"></polyline>
      <polyline class="chart-msci-line" points="${msciPts}"></polyline>
      ${actualPoints.length > 1 ? `<polyline class="chart-actual-line" points="${actualPts}"></polyline>` : ''}
      <circle class="chart-actual-dot" cx="${actualDotX}" cy="${actualDotY}" r="5"></circle>
      ${xLabels}
      <line class="chart-axis-line" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}"></line>
      <g id="hist-hover-group" style="display:none">
        <line class="chart-crosshair" id="hist-crosshair" y1="${padT}" y2="${padT + plotH}"></line>
        <circle class="chart-hover-dot muted" id="hist-dot-contrib" r="4"></circle>
        <circle class="chart-hover-dot msci" id="hist-dot-msci" r="4"></circle>
      </g>
      <rect id="hist-hover-target" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
    </svg>
  `;

  const svg = container.querySelector('svg');
  const hoverGroup = document.getElementById('hist-hover-group');
  const crosshair = document.getElementById('hist-crosshair');
  const dotContrib = document.getElementById('hist-dot-contrib');
  const dotMsci = document.getElementById('hist-dot-msci');
  const target = document.getElementById('hist-hover-target');
  const tooltip = document.getElementById('history-tooltip');

  target.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (width / rect.width);
    const tAtMouse = minT + ((mouseX - padL) / plotW) * span;
    let idx = 0;
    let bestDiff = Infinity;
    points.forEach((p, i) => {
      const diff = Math.abs(new Date(p.date).getTime() - tAtMouse);
      if (diff < bestDiff) { bestDiff = diff; idx = i; }
    });
    const p = points[idx];
    const cx = xFor(p.date);

    hoverGroup.style.display = '';
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    dotContrib.setAttribute('cx', cx);
    dotContrib.setAttribute('cy', yFor(p.contributed));
    dotMsci.setAttribute('cx', cx);
    dotMsci.setAttribute('cy', yFor(p.msciValue));

    tooltip.innerHTML = `
      <div class="tt-year">${new Date(p.date).toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' })}</div>
      <div class="tt-row"><span>Aportat</span><span>${formatEur(p.contributed)}</span></div>
      <div class="tt-row"><span>MSCI World (hipotètic)</span><span>${formatEur(p.msciValue)}</span></div>
    `;
    tooltip.classList.add('visible');
    const containerRect = container.getBoundingClientRect();
    const ttLeft = (cx / width) * containerRect.width;
    tooltip.style.left = Math.min(Math.max(ttLeft - 70, 0), containerRect.width - 180) + 'px';
    tooltip.style.top = '0px';
  });

  target.addEventListener('mouseleave', () => {
    hoverGroup.style.display = 'none';
    tooltip.classList.remove('visible');
  });
}

async function handleRebuildHistory() {
  const csvDocs = documents.filter((d) => d.file_type === 'csv');
  if (!csvDocs.length) {
    showToast('No hi ha cap CSV pujat encara. Puja\'l a "Documents".', true);
    return;
  }
  try {
    let rowCount = 0;
    for (const doc of csvDocs) {
      const text = await fetchDocText(doc.file_path);
      const rows = parseCsv(text);
      if (detectCsvKind(rows) !== 'ordres') continue;
      const orderRows = ordersToOrderRows(parseOrdersRows(rows));
      await bulkUpsertOrders(orderRows);
      rowCount += orderRows.length;
    }
    holdingOrders = await fetchOrders();
    renderFinanceSummary();
    showToast(rowCount ? `Historial reconstruit: ${rowCount} operacions.` : 'No s\'ha trobat cap CSV d\'ordres entre els documents.');
  } catch (err) {
    showToast('No s\'ha pogut reconstruir l\'historial: ' + err.message, true);
  }
}

document.getElementById('rebuild-history-btn').addEventListener('click', handleRebuildHistory);

function countryFillColor(pct) {
  if (pct <= 0) return '#1f2620';
  if (pct < 5) return '#3a5a45';
  if (pct < 15) return '#4f6b57';
  if (pct < 30) return '#6ea37e';
  return '#8fc79c';
}

async function initFinanceMap() {
  if (financeMap) {
    financeMap.invalidateSize();
    renderFinanceMap();
    return;
  }
  financeMap = L.map('finance-map', { worldCopyJump: true }).setView([20, 0], 1);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 8,
  }).addTo(financeMap);
  const geo = await loadWorldGeo();
  financeCountryLayer = L.geoJSON(geo, {
    style: (feature) => ({ fillColor: '#1f2620', fillOpacity: 0.85, color: '#2b332a', weight: 1 }),
    onEachFeature: (feature, layer) => layer.bindTooltip('', { sticky: true }),
  }).addTo(financeMap);
  renderFinanceMap();
}

function renderFinanceMap() {
  if (!financeCountryLayer) return;
  const totalInvested = holdings.reduce((s, h) => s + h.quantity * (h.avg_cost || 0), 0);
  const byCountry = {};
  allocations.forEach((a) => {
    const holding = holdings.find((h) => h.id === a.holding_id);
    if (!holding) return;
    const investedInHolding = holding.quantity * (holding.avg_cost || 0);
    const weighted = investedInHolding * (Number(a.percentage) / 100);
    byCountry[a.country_code] = (byCountry[a.country_code] || 0) + weighted;
  });
  financeCountryLayer.eachLayer((layer) => {
    const value = byCountry[layer.feature.id] || 0;
    const pct = totalInvested > 0 ? (value / totalInvested) * 100 : 0;
    layer.setStyle({ fillColor: countryFillColor(pct), fillOpacity: pct > 0 ? 0.85 : 1 });
    layer.setTooltipContent(`${layer.feature.properties.name}: ${pct.toFixed(1)}%`);
  });
}

/* Projeccio */
document.getElementById('proj-bump-enable').addEventListener('change', (e) => {
  document.getElementById('proj-bump-fields').hidden = !e.target.checked;
});

function formatEur(v) {
  return v.toLocaleString('ca-ES', { maximumFractionDigits: 0 }) + ' €';
}

function formatCompactEur(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(0) + 'k €';
  return v.toFixed(0) + ' €';
}

function renderProjectionChart(results) {
  document.getElementById('projection-chart-wrap').hidden = false;
  const container = document.getElementById('projection-chart');

  const width = 680;
  const height = 320;
  const padL = 55;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxYear = results[results.length - 1].years;
  const maxValue = Math.max(...results.map((r) => r.value), 1);

  const xFor = (y) => padL + (y / maxYear) * plotW;
  const yFor = (v) => padT + plotH - (v / maxValue) * plotH;

  const valuePoints = results.map((r) => `${xFor(r.years)},${yFor(r.value)}`).join(' ');
  const contributedPoints = results.map((r) => `${xFor(r.years)},${yFor(r.contributed)}`).join(' ');
  const areaPath = `M${xFor(0)},${yFor(0)} L${valuePoints.split(' ').join(' L')} L${xFor(maxYear)},${yFor(0)} Z`;

  const ySteps = 4;
  const yGridlines = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = (maxValue / ySteps) * i;
    return `<line class="chart-axis-line" x1="${padL}" y1="${yFor(v)}" x2="${width - padR}" y2="${yFor(v)}"></line>
      <text class="chart-axis-label" x="${padL - 8}" y="${yFor(v) + 3}" text-anchor="end">${formatCompactEur(v)}</text>`;
  }).join('');

  const xStep = maxYear <= 10 ? 1 : 5;
  const xLabels = results.filter((r) => r.years % xStep === 0).map((r) =>
    `<text class="chart-axis-label" x="${xFor(r.years)}" y="${height - padB + 16}" text-anchor="middle">${r.years}a</text>`
  ).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block">
      ${yGridlines}
      <path class="chart-value-area" d="${areaPath}"></path>
      <polyline class="chart-value-line" points="${valuePoints}"></polyline>
      <polyline class="chart-contributed-line" points="${contributedPoints}"></polyline>
      ${xLabels}
      <line class="chart-axis-line" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}"></line>
      <g id="chart-hover-group" style="display:none">
        <line class="chart-crosshair" id="chart-crosshair" y1="${padT}" y2="${padT + plotH}"></line>
        <circle class="chart-hover-dot" id="chart-hover-dot-value" r="4"></circle>
        <circle class="chart-hover-dot" id="chart-hover-dot-contrib" r="4"></circle>
      </g>
      <rect id="chart-hover-target" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
    </svg>
  `;

  const svg = container.querySelector('svg');
  const hoverGroup = document.getElementById('chart-hover-group');
  const crosshair = document.getElementById('chart-crosshair');
  const dotValue = document.getElementById('chart-hover-dot-value');
  const dotContrib = document.getElementById('chart-hover-dot-contrib');
  const target = document.getElementById('chart-hover-target');
  const tooltip = document.getElementById('projection-tooltip');

  target.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (width / rect.width);
    const yearAtMouse = ((mouseX - padL) / plotW) * maxYear;
    const idx = Math.max(0, Math.min(results.length - 1, Math.round(yearAtMouse)));
    const r = results[idx];
    const cx = xFor(r.years);

    hoverGroup.style.display = '';
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    dotValue.setAttribute('cx', cx);
    dotValue.setAttribute('cy', yFor(r.value));
    dotContrib.setAttribute('cx', cx);
    dotContrib.setAttribute('cy', yFor(r.contributed));

    tooltip.innerHTML = `
      <div class="tt-year">Any ${r.years}</div>
      <div class="tt-row"><span>Valor total</span><span>${formatEur(r.value)}</span></div>
      <div class="tt-row"><span>Aportat</span><span>${formatEur(r.contributed)}</span></div>
    `;
    tooltip.classList.add('visible');
    const containerRect = container.getBoundingClientRect();
    const ttLeft = (cx / width) * containerRect.width;
    tooltip.style.left = Math.min(Math.max(ttLeft - 60, 0), containerRect.width - 160) + 'px';
    tooltip.style.top = '0px';
  });

  target.addEventListener('mouseleave', () => {
    hoverGroup.style.display = 'none';
    tooltip.classList.remove('visible');
  });
}

document.getElementById('projection-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const startValue = Number(document.getElementById('proj-start').value);
  const monthlyContribution = Number(document.getElementById('proj-monthly').value);
  const annualReturnPct = Number(document.getElementById('proj-return').value);
  let bump = null;
  if (document.getElementById('proj-bump-enable').checked) {
    const bumpDate = document.getElementById('proj-bump-date').value;
    const newMonthly = Number(document.getElementById('proj-bump-amount').value);
    if (bumpDate && newMonthly) {
      const months = Math.max(0, Math.round((new Date(bumpDate) - new Date()) / (1000 * 60 * 60 * 24 * 30.44)));
      bump = { afterMonths: months, newMonthly };
    }
  }
  const yearsList = Array.from({ length: 31 }, (_, i) => i);
  const results = projectGrowth({ startValue, monthlyContribution, annualReturnPct, yearsList, bump });
  renderProjectionChart(results);
});

function renderFinances() {
  renderFinanceSubtabs();
  renderDocuments();
  renderHoldings();
  renderFinanceSummary();
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

function formatQty(item) {
  const q = Number(item.quantity);
  const qtyStr = Number.isInteger(q) ? String(q) : String(q);
  return item.unit ? `${qtyStr} ${item.unit}` : `x${qtyStr}`;
}

function itemRowHtml(item) {
  return `
    <label class="shopping-item ${item.checked ? 'checked' : ''}">
      <input type="checkbox" data-shopping-id="${item.id}" ${item.checked ? 'checked' : ''}>
      <span class="shopping-item-name">${item.item_name}</span>
      <span class="badge">${formatQty(item)}</span>
      ${item.note ? `<span class="shopping-item-note">${item.note}</span>` : ''}
      <button type="button" class="ghost-btn" data-price-item="${item.id}">Preus</button>
      <button type="button" class="delete-btn" data-shopping-delete="${item.id}">Elimina</button>
    </label>`;
}

function renderShoppingList() {
  const list = document.getElementById('shopping-list');
  const pending = shoppingItems.filter((i) => !i.checked);
  const checked = shoppingItems.filter((i) => i.checked);
  document.getElementById('shopping-count').textContent = `${pending.length} pendents, ${checked.length} marcats`;

  if (shoppingItems.length === 0) {
    list.innerHTML = '<p class="empty-col">La llista esta buida.</p>';
    return;
  }

  const bySuper = new Map();
  pending.forEach((item) => {
    const superKey = item.chosen_supermarket || 'Súper per triar';
    if (!bySuper.has(superKey)) bySuper.set(superKey, new Map());
    const bySection = bySuper.get(superKey);
    const sectionKey = item.section || 'Sense secció';
    if (!bySection.has(sectionKey)) bySection.set(sectionKey, []);
    bySection.get(sectionKey).push(item);
  });

  let html = '';
  for (const [superName, bySection] of bySuper) {
    html += `<div class="shopping-group-title">${superName}</div>`;
    for (const [sectionName, items] of bySection) {
      html += `<div class="shopping-section-title">${sectionName}</div>`;
      html += items.map(itemRowHtml).join('');
    }
  }
  if (checked.length) {
    html += `<div class="shopping-group-title">Marcats</div>` + checked.map(itemRowHtml).join('');
  }
  list.innerHTML = html;

  list.querySelectorAll('[data-shopping-id]').forEach((cb) =>
    cb.addEventListener('change', () => handleToggleShopping(cb.dataset.shoppingId, cb.checked))
  );
  list.querySelectorAll('[data-shopping-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDeleteShopping(btn.dataset.shoppingDelete);
    });
  });
  list.querySelectorAll('[data-price-item]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPriceModal(btn.dataset.priceItem);
    });
  });
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
      unit: unitInput.value.trim() || null,
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
