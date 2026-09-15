import { supabase } from './supabaseClient.js';

export async function fetchPlaces() {
  const { data, error } = await supabase.from('visited_places').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function createPlace(fields, photoFile) {
  let photo_path = null;
  if (photoFile) {
    const path = `${fields.country_code}/${Date.now()}-${photoFile.name}`;
    const { error: uploadError } = await supabase.storage.from('travel-photos').upload(path, photoFile);
    if (uploadError) throw uploadError;
    photo_path = path;
  }
  const { data, error } = await supabase.from('visited_places').insert({ ...fields, photo_path }).select().single();
  if (error) throw error;
  return data;
}

export async function deletePlace(place) {
  if (place.photo_path) {
    await supabase.storage.from('travel-photos').remove([place.photo_path]);
  }
  const { error } = await supabase.from('visited_places').delete().eq('id', place.id);
  if (error) throw error;
}

export function photoUrl(path) {
  if (!path) return null;
  return supabase.storage.from('travel-photos').getPublicUrl(path).data.publicUrl;
}
