import { supabase } from './supabaseClient.js';

export const WEEKDAY_LABELS = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
export const WEEKDAY_SHORT = ['Dg', 'Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds'];
export const CATEGORIES = ['Neteja', 'Vidres', 'Mobles', 'Manteniment', 'Ordre'];
export const EFFORTS = ['baix', 'mitja', 'alt'];
export const ASSIGNEES = [
  { key: 'marta', label: 'Marta' },
  { key: 'jordi', label: 'Jordi' },
  { key: 'ambdos', label: 'Ambdos' },
];

export const FREQUENCY_PRESETS = [
  { label: 'Cada dia', interval: 1, weekdays: [] },
  { label: 'Cada 2 dies', interval: 2, weekdays: [] },
  { label: 'Cada 3 dies', interval: 3, weekdays: [] },
  { label: 'Cada setmana', interval: 7, weekdays: [] },
  { label: 'Cada dissabte', interval: 7, weekdays: [6] },
  { label: 'Cap de setmana', interval: 7, weekdays: [6, 0] },
  { label: 'Cada 2 setmanes', interval: 14, weekdays: [] },
  { label: 'Cada mes', interval: 30, weekdays: [] },
];

export function frequencyPhrase(task) {
  const n = task.interval_days;
  const wds = task.preferred_weekdays || [];

  if (n === 7 && wds.length === 1) return `Cada ${WEEKDAY_LABELS[wds[0]].toLowerCase()}`;
  if (n === 7 && wds.length === 2 && wds.includes(6) && wds.includes(0)) return 'Cada cap de setmana';

  let base;
  if (n === 1) base = 'Cada dia';
  else if (n % 7 === 0) base = n === 7 ? 'Cada setmana' : `Cada ${n / 7} setmanes`;
  else base = `Cada ${n} dies`;

  if (wds.length === 0) return base;
  const dayNames = wds.slice().sort((a, b) => a - b).map((w) => WEEKDAY_LABELS[w]);
  return `${base} (${dayNames.join(', ')})`;
}

export const STATUS_ORDER = ['previst', 'pendent', 'en_proces', 'bloquejat', 'fet'];
export const STATUS_LABELS = {
  previst: 'Previst',
  pendent: 'Pendent',
  en_proces: 'En procés',
  bloquejat: 'Bloquejat',
  fet: 'Fet',
};

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function nextPreferredWeekday(date, preferredWeekdays) {
  if (!preferredWeekdays || preferredWeekdays.length === 0) return date;
  const d = new Date(date);
  for (let i = 0; i < 7; i++) {
    if (preferredWeekdays.includes(d.getDay())) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export function computeNextDue(task) {
  const base = task.last_completed_at
    ? addDays(task.last_completed_at, task.interval_days)
    : new Date(task.created_at);
  return nextPreferredWeekday(base, task.preferred_weekdays);
}

export function dueInfo(task) {
  const due = computeNextDue(task);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  let label;
  if (diffDays < 0) label = `Fa ${Math.abs(diffDays)} dies que toca`;
  else if (diffDays === 0) label = 'Toca avui';
  else if (diffDays === 1) label = 'Toca demà';
  else label = `Toca en ${diffDays} dies`;
  return { due, diffDays, label, overdue: diffDays < 0 };
}

export const PRIORITY_LEVELS = [
  { key: 'urgent', rank: 0, label: 'Urgent' },
  { key: 'alta', rank: 1, label: 'Alta' },
  { key: 'normal', rank: 2, label: 'Normal' },
  { key: 'baixa', rank: 3, label: 'Baixa' },
];
const PRIORITY_BY_KEY = Object.fromEntries(PRIORITY_LEVELS.map((p) => [p.key, p]));

function autoPriority(diffDays) {
  if (diffDays < 0) return PRIORITY_BY_KEY.urgent;
  if (diffDays <= 1) return PRIORITY_BY_KEY.alta;
  if (diffDays <= 7) return PRIORITY_BY_KEY.normal;
  return PRIORITY_BY_KEY.baixa;
}

export function priorityInfo(task) {
  if (task.priority_override && PRIORITY_BY_KEY[task.priority_override]) {
    return { ...PRIORITY_BY_KEY[task.priority_override], manual: true };
  }
  return { ...autoPriority(dueInfo(task).diffDays), manual: false };
}

/**
 * previst i fet es desbloquegen sols cap a pendent quan torna a tocar (mai es
 * queden per sempre). pendent, en_proces i bloquejat son manuals un cop
 * fixats: nomes els mou un canvi d'estat explicit, no el pas del temps.
 */
export function effectiveStatus(task) {
  const { diffDays } = dueInfo(task);
  const dueNow = diffDays <= 0;
  if (task.status === 'previst') return dueNow ? 'pendent' : 'previst';
  if (task.status === 'fet') return dueNow ? 'pendent' : 'fet';
  return task.status || (dueNow ? 'pendent' : 'previst');
}

export async function fetchRooms() {
  const { data, error } = await supabase.from('rooms').select('*').order('sort_order');
  if (error) throw error;
  return data;
}

export async function fetchTasks() {
  const { data, error } = await supabase.from('tasks').select('*, rooms(name)').order('title');
  if (error) throw error;
  return data;
}

export async function createTask(task) {
  const { data, error } = await supabase.from('tasks').insert(task).select('*, rooms(name)').single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, fields) {
  const { data, error } = await supabase.from('tasks').update(fields).eq('id', id).select('*, rooms(name)').single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function markTaskDone(task) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: completion, error: e1 } = await supabase
    .from('task_completions').insert({ task_id: task.id, completed_at: today }).select().single();
  if (e1) throw e1;
  const { data: updatedTask, error: e2 } = await supabase.from('tasks').update({
    last_completed_at: today,
    status: 'fet',
    blocked_reason: null,
    status_changed_at: new Date().toISOString(),
  }).eq('id', task.id).select('*, rooms(name)').single();
  if (e2) throw e2;
  completion.tasks = { title: updatedTask.title, room_id: updatedTask.room_id, assignee: updatedTask.assignee };
  return { task: updatedTask, completion };
}

export async function setTaskStatus(taskId, status, reason = null) {
  const { data, error } = await supabase.from('tasks').update({
    status,
    blocked_reason: status === 'bloquejat' ? reason : null,
    status_changed_at: new Date().toISOString(),
  }).eq('id', taskId).select('*, rooms(name)').single();
  if (error) throw error;
  return data;
}

export async function fetchCompletions(sinceDate) {
  const { data, error } = await supabase
    .from('task_completions')
    .select('*, tasks(title, room_id, assignee)')
    .gte('completed_at', sinceDate);
  if (error) throw error;
  return data;
}
