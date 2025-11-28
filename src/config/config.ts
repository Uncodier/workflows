import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

// Get package version at runtime to avoid build issues
const getPackageVersion = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packageJson = require('../../package.json');
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
};

interface TemporalConfig {
  serverUrl: string;
  namespace: string;
  taskQueue: string;
  apiKey?: string;
  tls?: boolean;
}

interface SupabaseConfig {
  url: string;
  key: string;
  serviceRoleKey?: string;
}

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

interface WorkerVersioningConfig {
  useWorkerVersioning: boolean;
  buildId: string;
  deploymentName: string;
  defaultVersioningBehavior: 'UNSPECIFIED' | 'PINNED' | 'AUTO_UPGRADE';
}

// Determine if we're using localhost (development) or remote server (production)
const serverUrl = process.env.TEMPORAL_SERVER_URL || 'localhost:7233';
const isLocalhost = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');

const temporalConfig: TemporalConfig = {
  serverUrl,
  namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
  // Only use TLS and API key for remote servers, not localhost
  apiKey: isLocalhost ? undefined : process.env.TEMPORAL_API_KEY,
  tls: isLocalhost ? false : (process.env.TEMPORAL_TLS === 'true' || !!process.env.TEMPORAL_API_KEY),
};

const supabaseConfig: SupabaseConfig = {
  url: process.env.SUPABASE_URL || '',
  key: process.env.SUPABASE_KEY || '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
};

const apiConfig: ApiConfig = {
  baseUrl: process.env.API_BASE_URL || '',
  apiKey: process.env.API_KEY || '',
};

const logLevel = process.env.LOG_LEVEL || 'info';

// Worker Versioning Configuration
const useWorkerVersioning = process.env.TEMPORAL_WORKER_USE_VERSIONING === 'true';
const buildId = process.env.TEMPORAL_WORKER_BUILD_ID || getPackageVersion();
const deploymentName = process.env.TEMPORAL_WORKER_DEPLOYMENT_NAME || 'workflows_worker';
// Normalize versioning behavior: empty string, undefined, or 'UNSPECIFIED' all mean "not set"
const rawBehavior = process.env.TEMPORAL_WORKER_VERSIONING_BEHAVIOR?.trim().toUpperCase() || 'UNSPECIFIED';
const versioningBehavior = (rawBehavior === 'UNSPECIFIED' || rawBehavior === '') 
  ? 'UNSPECIFIED' 
  : (rawBehavior as 'PINNED' | 'AUTO_UPGRADE');

const workerVersioningConfig: WorkerVersioningConfig = {
  useWorkerVersioning,
  buildId,
  deploymentName,
  defaultVersioningBehavior: versioningBehavior,
};

export {
  temporalConfig,
  supabaseConfig,
  apiConfig,
  workerVersioningConfig,
  logLevel,
  type TemporalConfig,
  type SupabaseConfig,
  type ApiConfig,
  type WorkerVersioningConfig
}; 