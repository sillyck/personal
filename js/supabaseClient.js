import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabaseReady = SUPABASE_URL !== 'PENDENT_URL_SUPABASE' && SUPABASE_ANON_KEY !== 'PENDENT_ANON_KEY_SUPABASE';

export const supabase = supabaseReady ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
