import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';
import { assertTemporalSafeHeaders } from '../services/headerSecurity';

const { executeApiCall, validateParameters, processResponse } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    maximumInterval: '30s',
    maximumAttempts: 3,
  },
});

export interface ExecuteToolInput {
  toolName: string;
  args: Record<string, any>;
  apiConfig: {
    endpoint: {
      url: string;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      headers: Record<string, string>;
      requiresAuth?: boolean;
      authType?: 'Bearer' | 'ApiKey';
    };
    responseMapping?: Record<string, string>;
    errors?: Record<number, { message: string; code: string }>;
  };
}

export interface ExecuteToolResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  url?: string;
}

export function sanitizeExecuteToolInput(input: ExecuteToolInput): ExecuteToolInput {
  const { environment: _discardedEnvironment, ...safeInput } = input as ExecuteToolInput & {
    environment?: unknown;
  };
  const headers = safeInput.apiConfig?.endpoint?.headers ?? {};

  assertTemporalSafeHeaders(headers);

  return {
    ...safeInput,
    apiConfig: {
      ...safeInput.apiConfig,
      endpoint: {
        ...safeInput.apiConfig.endpoint,
        headers: { ...headers },
      },
    },
  };
}

export async function executeToolWorkflow(input: ExecuteToolInput): Promise<ExecuteToolResult> {
  const safeInput = sanitizeExecuteToolInput(input);
  console.log(`[Workflow] Executing tool: ${safeInput.toolName}`);
  
  // 1. Validar parámetros
  await validateParameters(safeInput.toolName, safeInput.args, safeInput.apiConfig);
  
  // 2. Ejecutar la llamada API
  // ✅ IMPORTANTE: No capturar errores aquí, dejar que el workflow falle
  const result = await executeApiCall(safeInput);
  
  // 3. Procesar respuesta si hay mapeo (solo si fue exitoso)
  if (safeInput.apiConfig.responseMapping) {
    result.data = await processResponse(result.data, safeInput.apiConfig.responseMapping);
  }
  
  console.log(`[Workflow] Tool ${safeInput.toolName} executed successfully`);
  return result;
} 