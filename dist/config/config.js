"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logLevel = exports.apiConfig = exports.supabaseConfig = exports.temporalConfig = void 0;
const dotenv_1 = require("dotenv");
// Load environment variables from .env.local
(0, dotenv_1.config)({ path: '.env.local' });
const temporalConfig = {
    serverUrl: process.env.TEMPORAL_SERVER_URL || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
    apiKey: process.env.TEMPORAL_API_KEY,
    tls: process.env.TEMPORAL_TLS === 'true' || !!process.env.TEMPORAL_API_KEY,
};
exports.temporalConfig = temporalConfig;
const supabaseConfig = {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
};
exports.supabaseConfig = supabaseConfig;
const apiConfig = {
    baseUrl: process.env.API_BASE_URL || '',
    apiKey: process.env.API_KEY || '',
};
exports.apiConfig = apiConfig;
const logLevel = process.env.LOG_LEVEL || 'info';
exports.logLevel = logLevel;
