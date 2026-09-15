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

/**
 * El CSV d'ordres de MyInvestor porta la data en format DD/MM/YYYY.
 */
function normalizeOrderDate(raw) {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function ordersToOrderRows(orders) {
  return orders
    .filter((o) => o.status === 'Finalizada' && o.units && o.amount)
    .map((o) => ({ isin: o.isin, order_date: normalizeOrderDate(o.date), amount: o.amount, units: o.units }))
    .filter((o) => o.order_date);
}

export async function fetchOrders() {
  const { data, error } = await supabase.from('holding_orders').select('*').order('order_date');
  if (error) throw error;
  return data;
}

export async function bulkUpsertOrders(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('holding_orders')
    .upsert(rows, { onConflict: 'isin,order_date,amount,units', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data;
}

export async function fetchSnapshots() {
  const { data, error } = await supabase.from('portfolio_snapshots').select('*').order('snapshot_date');
  if (error) throw error;
  return data;
}

export async function upsertSnapshotToday(totalValue, totalContributed) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from('portfolio_snapshots')
    .upsert({ snapshot_date: today, total_value: totalValue, total_contributed: totalContributed }, { onConflict: 'snapshot_date' })
    .select().single();
  if (error) throw error;
  return data;
}

let msciCache = null;
export async function loadMsciWorldSeries() {
  if (msciCache) return msciCache;
  const res = await fetch('data/msci-world-eur.json');
  if (!res.ok) throw new Error('no es pot carregar data/msci-world-eur.json');
  msciCache = await res.json();
  return msciCache;
}

/**
 * Compara la cartera real amb un MSCI World hipotetic: per cada ordre
 * finalitzada, calcula quantes "participacions" de MSCI World (en EUR)
 * hauries comprat aquell dia amb el mateix import, i segueix el seu valor
 * fins avui amb la serie historica de data/msci-world-eur.json (basada en
 * l'ETF iShares Core MSCI World, URTH, convertit a EUR).
 */
export function computePortfolioHistory({ orders, msciSeries, snapshots, currentValue }) {
  const validOrders = orders
    .filter((o) => o.order_date && o.amount)
    .slice()
    .sort((a, b) => a.order_date.localeCompare(b.order_date));
  if (!validOrders.length || !msciSeries.length) return null;

  function msciPriceAt(date) {
    let best = msciSeries[0];
    for (const p of msciSeries) {
      if (p.date <= date) best = p; else break;
    }
    return best.eur;
  }

  const withUnits = validOrders.map((o) => ({ ...o, msciUnits: o.amount / msciPriceAt(o.order_date) }));
  const firstDate = validOrders[0].order_date;
  const today = new Date().toISOString().slice(0, 10);
  const timeline = msciSeries.filter((p) => p.date >= firstDate);

  let oi = 0;
  let runningContributed = 0;
  let runningUnits = 0;
  const points = timeline.map((p) => {
    while (oi < withUnits.length && withUnits[oi].order_date <= p.date) {
      runningContributed += withUnits[oi].amount;
      runningUnits += withUnits[oi].msciUnits;
      oi++;
    }
    return { date: p.date, contributed: runningContributed, msciValue: runningUnits * p.eur };
  });
  while (oi < withUnits.length) {
    runningContributed += withUnits[oi].amount;
    runningUnits += withUnits[oi].msciUnits;
    oi++;
  }
  const lastPrice = msciSeries[msciSeries.length - 1].eur;
  const finalPoint = { date: today, contributed: runningContributed, msciValue: runningUnits * lastPrice };
  if (!points.length || points[points.length - 1].date < today) points.push(finalPoint);
  else points[points.length - 1] = finalPoint;

  const totalContributed = runningContributed;
  const totalMsciValue = runningUnits * lastPrice;

  return {
    points,
    snapshots: (snapshots || []).map((s) => ({ date: s.snapshot_date, actualValue: Number(s.total_value) })),
    today: {
      date: today,
      contributed: totalContributed,
      msciValue: totalMsciValue,
      actualValue: currentValue,
      diffAbs: currentValue - totalMsciValue,
      diffPct: totalMsciValue > 0 ? ((currentValue - totalMsciValue) / totalMsciValue) * 100 : null,
    },
  };
}
