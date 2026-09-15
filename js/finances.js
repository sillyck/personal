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

export async function uploadDocument(label, file) {
  const path = `${Date.now()}-${file.name}`;
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

export async function deleteHolding(id) {
  const { error } = await supabase.from('holdings').delete().eq('id', id);
  if (error) throw error;
}

export function parseCsvPreview(text, maxRows = 15) {
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
      rows.push(row); row = [];
      if (rows.length >= maxRows) break;
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
