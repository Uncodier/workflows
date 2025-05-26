import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../../config/config';

if (!supabaseConfig.url || !supabaseConfig.key) {
  throw new Error('Supabase URL and key must be provided in environment variables');
}

const supabase = createClient(supabaseConfig.url, supabaseConfig.key);

export default supabase; 