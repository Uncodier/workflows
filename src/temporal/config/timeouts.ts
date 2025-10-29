/**
 * Temporal Timeouts Configuration
 * Configuración centralizada de timeouts para activities y workflows
 */

export const ACTIVITY_TIMEOUTS = {
  // Customer Support APIs - suelen tardar más por procesamiento de IA
  CUSTOMER_SUPPORT: '5 minutes',
  
  // Email APIs - moderado
  EMAIL_OPERATIONS: '3 minutes',
  
  // WhatsApp APIs - rápido
  WHATSAPP_OPERATIONS: '2 minutes',
  
  // Database operations - rápido
  DATABASE_OPERATIONS: '1 minute',
  
  // Analysis operations - pueden tardar por procesamiento
  ANALYSIS_OPERATIONS: '4 minutes',
  
  // Default para activities genéricas
  DEFAULT: '2 minutes',
  
  // Operations de setup/configuración - pueden tardar
  SETUP_OPERATIONS: '10 minutes',
} as const;

export const WORKFLOW_TIMEOUTS = {
  // Customer Support workflows
  CUSTOMER_SUPPORT: '10 minutes',
  
  // Email workflows
  EMAIL_WORKFLOWS: '8 minutes',
  
  // WhatsApp workflows  
  WHATSAPP_WORKFLOWS: '5 minutes',
  
  // Long-running workflows
  LONG_RUNNING: '30 minutes',
  
  // Default para workflows
  DEFAULT: '5 minutes',
} as const;

export const RETRY_POLICIES = {
  // Customer Support - retry menos porque pueden ser costosos
  CUSTOMER_SUPPORT: {
    maximumAttempts: 4, // Initial attempt + 3 retries
    backoffCoefficient: 2.0,
    initialIntervalMs: 5000, // 5 segundos
    maximumIntervalMs: 60000, // 1 minuto
  },
  
  // Database operations - retry más agresivo
  DATABASE: {
    maximumAttempts: 5,
    backoffCoefficient: 1.5,
    initialIntervalMs: 1000, // 1 segundo
    maximumIntervalMs: 10000, // 10 segundos
  },
  
  // Network operations
  NETWORK: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialIntervalMs: 2000, // 2 segundos
    maximumIntervalMs: 30000, // 30 segundos
  },
  
  // No retry for non-critical operations
  NO_RETRY: {
    maximumAttempts: 1,
    backoffCoefficient: 1.0,
    initialIntervalMs: 0,
    maximumIntervalMs: 0,
  },
  
  // Default
  DEFAULT: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialIntervalMs: 1000,
    maximumIntervalMs: 30000,
  },
} as const;

/**
 * Utility function to get activity proxy with appropriate timeouts
 */
export function getActivityProxy<T>(
  activities: T,
  timeoutType: keyof typeof ACTIVITY_TIMEOUTS = 'DEFAULT',
  retryType: keyof typeof RETRY_POLICIES = 'DEFAULT'
) {
  return {
    startToCloseTimeout: ACTIVITY_TIMEOUTS[timeoutType],
    retry: RETRY_POLICIES[retryType],
  };
} 