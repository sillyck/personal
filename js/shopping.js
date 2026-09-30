import { supabase } from './supabaseClient.js';

export const SUPERMARKETS = ['Mercadona', 'Esclat', 'Dia', 'Aldi', 'Lidl', 'Mercat', 'Altre'];

export const PRICE_STORES = [
  { key: 'mercadona', label: 'Mercadona', auto: true },
  { key: 'esclat', label: 'Esclat' },
  { key: 'dia', label: 'Dia' },
  { key: 'aldi', label: 'Aldi' },
  { key: 'lidl', label: 'Lidl' },
  { key: 'mercat', label: 'Mercat', hint: 'setmana passada' },
];

export async function loadPriceCatalog() {
  const [productes, preus] = await Promise.all([
    fetch('data/productes.json').then((r) => r.json()),
    fetch('data/preus.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  return { productes, preus };
}

export async function fetchMarketPrices() {
  const { data, error } = await supabase.from('market_prices').select('*');
  if (error) throw error;
  return data;
}

export async function saveMarketPrice(productKey, store, price) {
  const { data, error } = await supabase.from('market_prices')
    .upsert({ product_key: productKey, store, price, updated_at: new Date().toISOString() })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteMarketPrice(productKey, store) {
  const { error } = await supabase.from('market_prices').delete().eq('product_key', productKey).eq('store', store);
  if (error) throw error;
}
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
