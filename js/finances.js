import { supabase } from './supabaseClient.js';

export async function fetchDocuments() {
  const { data, error } = await supabase.from('finance_documents').select('*').order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data;
}

function fileTypeOf(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  return 'altre';
}

function sanitizeFilename(name) {
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  const safeBase = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'document';
  return safeBase + ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
}

export async function uploadDocument(label, file) {
  const path = `${Date.now()}-${sanitizeFilename(file.name)}`;
  const { error: uploadError } = await supabase.storage.from('finance-docs').upload(path, file);
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from('finance_documents').insert({
    label,
    file_name: file.name,
    file_path: path,
    file_type: fileTypeOf(file),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteDocument(doc) {
  await supabase.storage.from('finance-docs').remove([doc.file_path]);
  const { error } = await supabase.from('finance_documents').delete().eq('id', doc.id);
  if (error) throw error;
}

export async function signedDocUrl(path) {
  const { data, error } = await supabase.storage.from('finance-docs').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function fetchDocText(path) {
  const { data, error } = await supabase.storage.from('finance-docs').download(path);
  if (error) throw error;
  return data.text();
}

export async function fetchHoldings() {
  const { data, error } = await supabase.from('holdings').select('*').order('ticker');
  if (error) throw error;
  return data;
}

export async function createHolding(fields) {
  const { data, error } = await supabase.from('holdings').insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function updateHolding(id, fields) {
  const { data, error } = await supabase.from('holdings').update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteHolding(id) {
  const { error } = await supabase.from('holdings').delete().eq('id', id);
  if (error) throw error;
}

export async function setCurrentPrice(id, price) {
  const { data, error } = await supabase.from('holdings').update({ current_price: price }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function fetchAllocations() {
  const { data, error } = await supabase.from('holding_allocations').select('*');
  if (error) throw error;
  return data;
}

export async function addAllocation(holdingId, countryCode, countryName, percentage) {
  const { data, error } = await supabase.from('holding_allocations').insert({
    holding_id: holdingId, country_code: countryCode, country_name: countryName, percentage,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteAllocation(id) {
  const { error } = await supabase.from('holding_allocations').delete().eq('id', id);
  if (error) throw error;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',' || c === ';') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

/**
 * Numeros amb format espanyol: punt de milers, coma decimal ("11.504,7").
 */
function parseEsNumber(str) {
  if (!str) return null;
  const n = parseFloat(str.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/**
 * Columna "Importe estimado" de MyInvestor ve com "350.19 EUR", amb punt
 * decimal normal (no de milers), a diferencia de la resta de columnes.
 */
function parseAmountEur(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/eur/i, '').trim());
  return Number.isNaN(n) ? null : n;
}

export function detectCsvKind(rows) {
  if (!rows.length) return 'desconegut';
  const header = rows[0].map((h) => h.toLowerCase());
  if (header.some((h) => h.includes('resultado fiscal'))) return 'plusvalues';
  if (header.some((h) => h.includes('participaciones')) || header.some((h) => h.includes('estado'))) return 'ordres';
  return 'desconegut';
}

export function parseOrdersRows(rows) {
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = {
    date: header.findIndex((h) => h.includes('fecha')),
    isin: header.findIndex((h) => h.includes('isin')),
    amount: header.findIndex((h) => h.includes('importe')),
    units: header.findIndex((h) => h.includes('participaciones')),
    status: header.findIndex((h) => h.includes('estado')),
  };
  return rows.slice(1).map((r) => ({
    date: r[idx.date],
    isin: r[idx.isin],
    amount: parseAmountEur(r[idx.amount]),
    units: parseEsNumber(r[idx.units]),
    status: r[idx.status],
  }));
}

export function aggregateOrdersToHoldings(orders) {
  const byIsin = {};
  orders
    .filter((o) => o.status === 'Finalizada' && o.units)
    .forEach((o) => {
      if (!byIsin[o.isin]) byIsin[o.isin] = { ticker: o.isin, quantity: 0, totalCost: 0 };
      byIsin[o.isin].quantity += o.units;
      byIsin[o.isin].totalCost += o.amount || 0;
    });
  return Object.values(byIsin).map((h) => ({
    ticker: h.ticker,
    quantity: Math.round(h.quantity * 10000) / 10000,
    avg_cost: h.quantity ? Math.round((h.totalCost / h.quantity) * 10000) / 10000 : null,
  }));
}

export function parsePlusvaluesRows(rows) {
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = {
    date: header.findIndex((h) => h.includes('fecha')),
    invested: header.findIndex((h) => h.includes('inversi')),
    marketValue: header.findIndex((h) => h.includes('valor de mercado')),
    result: header.findIndex((h) => h.includes('resultado')),
  };
  return rows.slice(1).map((r) => ({
    date: r[idx.date],
    invested: parseEsNumber(r[idx.invested]),
    marketValue: parseEsNumber(r[idx.marketValue]),
    result: parseEsNumber(r[idx.result]),
  }));
}

/**
 * Interes compost amb aportacions mensuals fixes. Si es dona `bump`, la
 * quota mensual canvia a partir del mes indicat (dues fases enllaçades).
 */
export function projectGrowth({ startValue, monthlyContribution, annualReturnPct, yearsList, bump }) {
  const r = annualReturnPct / 100 / 12;
  const fv = (start, monthly, months) => {
    if (months <= 0) return start;
    if (r === 0) return start + monthly * months;
    return start * Math.pow(1 + r, months) + monthly * ((Math.pow(1 + r, months) - 1) / r);
  };
  return yearsList.map((y) => {
    const months = y * 12;
    let value;
    let contributed = startValue + monthlyContribution * Math.min(months, bump ? bump.afterMonths : months);
    if (bump && bump.afterMonths < months) {
      const phase1 = fv(startValue, monthlyContribution, bump.afterMonths);
      value = fv(phase1, bump.newMonthly, months - bump.afterMonths);
      contributed += bump.newMonthly * (months - bump.afterMonths);
    } else {
      value = fv(startValue, monthlyContribution, months);
    }
    return { years: y, value, contributed };
  });
}

export async function upsertHoldingsFromOrders(aggregated, existingHoldings) {
  const results = [];
  for (const h of aggregated) {
    const existing = existingHoldings.find((e) => e.ticker === h.ticker);
    if (existing) {
      results.push(await updateHolding(existing.id, { quantity: h.quantity, avg_cost: h.avg_cost }));
    } else {
      results.push(await createHolding(h));
    }
  }
  return results;
}
