import { supabase } from './supabaseClient.js';

export async function fetchShoppingList() {
  const { data, error } = await supabase.from('shopping_list').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function addShoppingItem(item_name, note) {
  const { data, error } = await supabase.from('shopping_list').insert({ item_name, note: note || null }).select().single();
  if (error) throw error;
  return data;
}

export async function toggleShoppingItem(id, checked) {
  const { data, error } = await supabase.from('shopping_list').update({ checked }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteShoppingItem(id) {
  const { error } = await supabase.from('shopping_list').delete().eq('id', id);
  if (error) throw error;
}

export async function clearCheckedItems(items) {
  const ids = items.filter((i) => i.checked).map((i) => i.id);
  if (!ids.length) return;
  const { error } = await supabase.from('shopping_list').delete().in('id', ids);
  if (error) throw error;
}
