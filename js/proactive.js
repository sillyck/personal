import { supabase } from './supabaseClient.js';

export const PROACTIVE_CATEGORIES = [
  { key: 'decoracio', label: 'Decoracio' },
  { key: 'manteniment', label: 'Manteniment' },
  { key: 'trucs', label: 'Trucs' },
  { key: 'enllacos', label: 'Enllaços' },
];

export async function fetchProactiveContent() {
  const { data, error } = await supabase.from('proactive_content').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
