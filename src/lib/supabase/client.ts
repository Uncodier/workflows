import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../../config/config';

if (!supabaseConfig.url || !supabaseConfig.key) {
  throw new Error('Supabase URL and key must be provided in environment variables');
}

// Default client with anon key (for frontend operations)
const supabase = createClient(supabaseConfig.url, supabaseConfig.key);

// Service role client (for backend operations that need to bypass RLS)
const supabaseServiceRole = supabaseConfig.serviceRoleKey 
  ? createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey)
  : supabase; // Fallback to anon key if service role key is not available

export default supabase;
export { supabaseServiceRole }; 