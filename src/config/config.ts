import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

interface TemporalConfig {
  serverUrl: string;
  namespace: string;
  taskQueue: string;
}

interface SupabaseConfig {
  url: string;
  key: string;
}

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

const temporalConfig: TemporalConfig = {
  serverUrl: process.env.TEMPORAL_SERVER_URL || 'localhost:7233',
  namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
};

const supabaseConfig: SupabaseConfig = {
  url: process.env.SUPABASE_URL || '',
  key: process.env.SUPABASE_KEY || '',
};

const apiConfig: ApiConfig = {
  baseUrl: process.env.API_BASE_URL || '',
  apiKey: process.env.API_KEY || '',
};

const logLevel = process.env.LOG_LEVEL || 'info';

export {
  temporalConfig,
  supabaseConfig,
  apiConfig,
  logLevel,
  type TemporalConfig,
  type SupabaseConfig,
  type ApiConfig
}; 