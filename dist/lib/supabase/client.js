"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseServiceRole = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../../config/config");
if (!config_1.supabaseConfig.url || !config_1.supabaseConfig.key) {
    throw new Error('Supabase URL and key must be provided in environment variables');
}
// Default client with anon key (for frontend operations)
const supabase = (0, supabase_js_1.createClient)(config_1.supabaseConfig.url, config_1.supabaseConfig.key);
// Service role client (for backend operations that need to bypass RLS)
const supabaseServiceRole = config_1.supabaseConfig.serviceRoleKey
    ? (0, supabase_js_1.createClient)(config_1.supabaseConfig.url, config_1.supabaseConfig.serviceRoleKey)
    : supabase; // Fallback to anon key if service role key is not available
exports.supabaseServiceRole = supabaseServiceRole;
exports.default = supabase;
