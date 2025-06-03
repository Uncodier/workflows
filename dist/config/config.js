import { config } from 'dotenv';
// Load environment variables from .env.local
config({ path: '.env.local' });
const temporalConfig = {
    serverUrl: process.env.TEMPORAL_SERVER_URL || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
    apiKey: process.env.TEMPORAL_API_KEY,
    tls: process.env.TEMPORAL_TLS === 'true' || !!process.env.TEMPORAL_API_KEY,
};
const supabaseConfig = {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
};
const apiConfig = {
    baseUrl: process.env.API_BASE_URL || '',
    apiKey: process.env.API_KEY || '',
};
const logLevel = process.env.LOG_LEVEL || 'info';
export { temporalConfig, supabaseConfig, apiConfig, logLevel };
