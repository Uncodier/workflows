import { supabaseConfig } from '../config/config';
console.log("URL:", supabaseConfig.url);
console.log("Key:", supabaseConfig.key.substring(0, 20) + "...");
