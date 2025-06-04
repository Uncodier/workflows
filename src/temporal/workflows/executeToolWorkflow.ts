import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

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
  environment?: {
    NODE_ENV?: string;
    API_BASE_URL?: string;
    PORT?: string;
    SERVICE_API_KEY?: string;
    SUPPORT_API_TOKEN?: string;
    WEATHER_API_KEY?: string;
  };
}

export interface ExecuteToolResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  url?: string;
}

export async function executeToolWorkflow(input: ExecuteToolInput): Promise<ExecuteToolResult> {
  try {
    console.log(`[Workflow] Executing tool: ${input.toolName}`);
    
    // 1. Validar parámetros
    await validateParameters(input.toolName, input.args, input.apiConfig);
    
    // 2. Ejecutar la llamada API
    const result = await executeApiCall(input);
    
    // 3. Procesar respuesta si hay mapeo
    if (input.apiConfig.responseMapping && result.success) {
      result.data = await processResponse(result.data, input.apiConfig.responseMapping);
    }
    
    console.log(`[Workflow] Tool ${input.toolName} executed successfully`);
    return result;
    
  } catch (error: any) {
    console.error(`[Workflow] Error executing tool ${input.toolName}:`, error);
    return {
      success: false,
      error: error.message || 'Unknown workflow error',
    };
  }
} 