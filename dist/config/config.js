"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logLevel = exports.apiConfig = exports.supabaseConfig = exports.temporalConfig = void 0;
const dotenv_1 = require("dotenv");
// Load environment variables from .env.local
(0, dotenv_1.config)({ path: '.env.local' });
// Determine if we're using localhost (development) or remote server (production)
const serverUrl = process.env.TEMPORAL_SERVER_URL || 'localhost:7233';
const isLocalhost = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');
const temporalConfig = {
    serverUrl,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
    // Only use TLS and API key for remote servers, not localhost
    apiKey: isLocalhost ? undefined : process.env.TEMPORAL_API_KEY,
    tls: isLocalhost ? false : (process.env.TEMPORAL_TLS === 'true' || !!process.env.TEMPORAL_API_KEY),
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
