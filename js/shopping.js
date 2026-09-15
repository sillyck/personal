import { supabase } from './supabaseClient.js';

export const SUPERMARKETS = ['Bonpreu', 'BonÀrea', 'Mercadona', 'Lidl', 'Aldi', 'Altre'];
export const SECTIONS = [
  'Fruita i verdura', 'Carn', 'Peix', 'Làctics i ous', 'Pa i rebosteria',
  'Congelats', 'Conserves i pasta', 'Begudes', 'Neteja i higiene', 'Altres',
];

export async function fetchShoppingList() {
  const { data, error } = await supabase.from('shopping_list').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function addShoppingItem(fields) {
  const { data, error } = await supabase.from('shopping_list').insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function updateShoppingItem(id, fields) {
  const { data, error } = await supabase.from('shopping_list').update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function toggleShoppingItem(id, checked) {
  return updateShoppingItem(id, { checked });
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

export async function fetchItemPrices() {
  const { data, error } = await supabase.from('shopping_item_prices').select('*');
  if (error) throw error;
  return data;
}

export async function addItemPrice(shoppingItemId, supermarket, price) {
  const { data, error } = await supabase.from('shopping_item_prices').insert({
    shopping_item_id: shoppingItemId, supermarket, price,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteItemPrice(id) {
  const { error } = await supabase.from('shopping_item_prices').delete().eq('id', id);
  if (error) throw error;
}
