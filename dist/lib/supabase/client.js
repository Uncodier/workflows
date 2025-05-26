"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../../config/config");
if (!config_1.supabaseConfig.url || !config_1.supabaseConfig.key) {
    throw new Error('Supabase URL and key must be provided in environment variables');
}
const supabase = (0, supabase_js_1.createClient)(config_1.supabaseConfig.url, config_1.supabaseConfig.key);
exports.default = supabase;
