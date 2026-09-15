import { supabase } from './supabaseClient.js';

export const WEEKDAY_LABELS = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
export const FREQUENCY_LABELS = {
  setmanal: 'Setmanal',
  quinzenal: 'Quinzenal',
  mensual: 'Mensual',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};
export const CATEGORIES = ['Neteja', 'Vidres', 'Mobles', 'Manteniment', 'Ordre'];
export const EFFORTS = ['baix', 'mitja', 'alt'];

export const STATUS_ORDER = ['previst', 'pendent', 'en_proces', 'bloquejat', 'fet'];
export const STATUS_LABELS = {
  previst: 'Previst',
  pendent: 'Pendent',
  en_proces: 'En procés',
  bloquejat: 'Bloquejat',
  fet: 'Fet',
};

function addInterval(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case 'setmanal': d.setDate(d.getDate() + 7); break;
    case 'quinzenal': d.setDate(d.getDate() + 14); break;
    case 'mensual': d.setMonth(d.getMonth() + 1); break;
    case 'trimestral': d.setMonth(d.getMonth() + 3); break;
    case 'semestral': d.setMonth(d.getMonth() + 6); break;
    case 'anual': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

function snapToWeekday(date, weekday) {
  const d = new Date(date);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

export function computeNextDue(task) {
  const base = task.last_completed_at
    ? addInterval(task.last_completed_at, task.frequency)
    : new Date(task.created_at);
  return snapToWeekday(base, task.weekday);
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

/**
 * previst/pendent es recalculen sempre a partir de la data. en_proces i
 * bloquejat son manuals i no es toquen soles. fet es manual pero es desbloca
 * cap a pendent quan torna a tocar (mai es queda fet per sempre).
 */
export function effectiveStatus(task) {
  const { diffDays } = dueInfo(task);
  const dueNow = diffDays <= 0;
  if (task.status === 'en_proces' || task.status === 'bloquejat') return task.status;
  if (task.status === 'fet') return dueNow ? 'pendent' : 'fet';
  return dueNow ? 'pendent' : 'previst';
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
  const { data, error } = await supabase.from('tasks').insert(task).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function markTaskDone(task) {
  const today = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await supabase.from('task_completions').insert({ task_id: task.id, completed_at: today });
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('tasks').update({
    last_completed_at: today,
    status: 'fet',
    blocked_reason: null,
    status_changed_at: new Date().toISOString(),
  }).eq('id', task.id);
  if (e2) throw e2;
}

export async function setTaskStatus(taskId, status, reason = null) {
  const { error } = await supabase.from('tasks').update({
    status,
    blocked_reason: status === 'bloquejat' ? reason : null,
    status_changed_at: new Date().toISOString(),
  }).eq('id', taskId);
  if (error) throw error;
}

export async function fetchCompletions(sinceDate) {
  const { data, error } = await supabase
    .from('task_completions')
    .select('*, tasks(title, room_id, weekday)')
    .gte('completed_at', sinceDate);
  if (error) throw error;
  return data;
}
