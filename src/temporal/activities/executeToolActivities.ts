import { ApplicationFailure } from '@temporalio/common';
import { ExecuteToolInput, ExecuteToolResult } from '../workflows/executeToolWorkflow';
import { apiService, redactUrlForLogs } from '../services/apiService';

const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 425, 429]);
const SECRET_ENVIRONMENT_VARIABLES = {
  SUPPORT_API_TOKEN: () => process.env.SUPPORT_API_TOKEN,
  SERVICE_API_KEY: () => process.env.SERVICE_API_KEY || process.env.API_KEY,
  WEATHER_API_KEY: () => process.env.WEATHER_API_KEY,
} as const;

function toolApiFailure(
  toolName: string,
  error: string | undefined,
  statusCode: number | undefined
): ApplicationFailure {
  const nonRetryable =
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(statusCode);

  return ApplicationFailure.create({
    message: `Tool ${toolName} failed: ${error || 'Unknown error'} (Status: ${statusCode})`,
    type: nonRetryable ? 'TOOL_REQUEST_REJECTED' : 'TOOL_API_FAILURE',
    nonRetryable,
    details: [{ toolName, statusCode }],
  });
}

export function resolveToolHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      const resolved = value.replace(
        /\{\{(SUPPORT_API_TOKEN|SERVICE_API_KEY|WEATHER_API_KEY)\}\}/g,
        (_placeholder, secretName: keyof typeof SECRET_ENVIRONMENT_VARIABLES) => {
          const secret = SECRET_ENVIRONMENT_VARIABLES[secretName]();
          if (!secret) {
            throw ApplicationFailure.nonRetryable(
              `Required tool credential ${secretName} is not configured on the worker`,
              'TOOL_CREDENTIAL_MISSING'
            );
          }
          return secret;
        }
      );
      return [name, resolved];
    })
  );
}

export async function validateParameters(
  toolName: string, 
  args: Record<string, any>, 
  apiConfig: any
): Promise<void> {
  // Validación de parámetros si es necesaria
  console.log(`[Activity] Validating parameters for tool: ${toolName}`);
  
  // Agregar validaciones específicas aquí
  if (!toolName) {
    throw ApplicationFailure.nonRetryable('Tool name is required', 'TOOL_INVALID_INPUT');
  }
  
  if (!apiConfig || !apiConfig.endpoint) {
    throw ApplicationFailure.nonRetryable(
      'API configuration is required',
      'TOOL_INVALID_INPUT'
    );
  }
}

export async function executeApiCall(input: ExecuteToolInput): Promise<ExecuteToolResult> {
  const { toolName, args, apiConfig } = input;
  let url = apiConfig.endpoint.url;
  
  try {
    console.log(`[Activity] Executing API call for tool: ${toolName}`);
    
    const method = apiConfig.endpoint.method;
    
    // ✅ IMPORTANTE: Auto-corregir fechas sin timezone para formato ISO 8601
    const processedArgs = { ...args };
    Object.keys(processedArgs).forEach(key => {
      const value = processedArgs[key];
      // Si el key contiene 'date' y el valor parece una fecha sin timezone
      if (key.toLowerCase().includes('date') && 
          typeof value === 'string' && 
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
        processedArgs[key] = `${value}Z`; // Agregar timezone UTC
        console.log(`[Activity] Auto-corrected date format for argument: ${key}`);
      }
    });
    
    // Reemplazar variables en la URL usando args procesados
    Object.keys(processedArgs).forEach(key => {
      url = url.replace(`{${key}}`, encodeURIComponent(String(processedArgs[key])));
    });
    
    console.log(`[Activity] Final URL: ${redactUrlForLogs(url)}`);
    console.log(`[Activity] Method: ${method}`);
    console.log(
      `[Activity] Processed ${Object.keys(processedArgs).length} argument(s)`
    );
    
    // Preparar headers personalizados
    let customHeaders = { ...apiConfig.endpoint.headers };
    
    // Procesar autenticación en headers
    if (apiConfig.endpoint.requiresAuth) {
      customHeaders = resolveToolHeaders(customHeaders);
    }
    
    let result: ExecuteToolResult;
    
    // Si es una URL externa (completa), usar fetch directamente
    if (url.startsWith('http://') || url.startsWith('https://')) {
      console.log(`[Activity] External URL detected, using direct fetch`);
      result = await executeExternalApiCall(url, method, processedArgs, customHeaders);
    } else {
      // Si es una URL local (que empieza con /), usar apiService
      console.log(`[Activity] Local URL detected, using apiService`);
      const response = await executeLocalApiCall(url, method, processedArgs, customHeaders);
      
      result = {
        success: response.success,
        data: response.data,
        error: response.error?.message,
        statusCode: response.error?.status,
        url: url
      };
    }
    
    // ✅ IMPORTANTE: Si hay error o success es false, FALLAR el activity
    if (!result.success || result.error) {
      const failure = toolApiFailure(toolName, result.error, result.statusCode);
      console.error(
        `[Activity] Tool ${toolName} failed with status ${result.statusCode ?? 'unknown'}`
      );
      throw failure;
    }
    
    console.log(`[Activity] Tool ${toolName} executed successfully`);
    return result;
    
  } catch (error: any) {
    console.error(
      `[Activity] API call failed for ${toolName}: ${
        error instanceof ApplicationFailure ? error.type : 'UNEXPECTED_ERROR'
      }`
    );
    if (error instanceof ApplicationFailure) throw error;

    throw ApplicationFailure.create({
      message: `Tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      type: 'TOOL_UNEXPECTED_FAILURE',
      nonRetryable: false,
    });
  }
}

// Función para manejar APIs externas (URLs completas)
async function executeExternalApiCall(
  url: string,
  method: string,
  processedArgs: any,
  headers: Record<string, string>
): Promise<ExecuteToolResult> {
  let finalUrl = url;
  let body: string | undefined;
  
  // Configurar body y URL según el método HTTP
  if (method === 'GET') {
    const queryParams = new URLSearchParams();
    Object.keys(processedArgs).forEach(key => {
      if (!url.includes(`{${key}}`)) {
        queryParams.append(key, String(processedArgs[key]));
      }
    });
    const queryString = queryParams.toString();
    finalUrl = queryString ? `${url}?${queryString}` : url;
  } else {
    body = JSON.stringify(processedArgs);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }
  
  const response = await fetch(finalUrl, {
    method,
    headers,
    body
  });
  
  let data;
  try {
    data = await response.json();
  } catch {
    data = await response.text();
  }
  
  if (!response.ok) {
    return {
      success: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
      statusCode: response.status,
      url: finalUrl,
      data
    };
  }
  
  // ✅ IMPORTANTE: También verificar si la respuesta contiene un error en los datos
  if (data && typeof data === 'object' && data.error) {
    return {
      success: false,
      error: data.error,
      statusCode: response.status,
      url: finalUrl,
      data
    };
  }
  
  return {
    success: true,
    data,
    statusCode: response.status,
    url: finalUrl
  };
}

// Función para manejar APIs locales usando apiService
async function executeLocalApiCall(
  endpoint: string,
  method: string,
  processedArgs: any,
  customHeaders: Record<string, string>
): Promise<{ success: boolean; data?: any; error?: { message: string; status?: number } }> {
  
  // Remover Content-Type del customHeaders si existe, apiService lo maneja automáticamente
  const headers = { ...customHeaders };
  delete headers['Content-Type'];
  
  switch (method.toUpperCase()) {
    case 'GET':
      // Para GET, agregar processedArgs como query parameters si no están en la URL
      if (Object.keys(processedArgs).length > 0) {
        const queryParams = new URLSearchParams();
        Object.keys(processedArgs).forEach(key => {
          if (!endpoint.includes(`{${key}}`)) {
            queryParams.append(key, String(processedArgs[key]));
          }
        });
        const queryString = queryParams.toString();
        if (queryString) {
          endpoint = `${endpoint}?${queryString}`;
        }
      }
      return await apiService.get(endpoint, headers);
      
    case 'POST':
      return await apiService.post(endpoint, processedArgs, headers);
      
    case 'PUT':
      return await apiService.put(endpoint, processedArgs, headers);
      
    case 'DELETE':
      return await apiService.delete(endpoint, headers);
      
    case 'PATCH':
      return await apiService.patch(endpoint, processedArgs, headers);
      
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

export async function processResponse(
  data: any, 
  responseMapping: Record<string, string>
): Promise<any> {
  console.log(`[Activity] Processing response with mapping`);
  
  const mappedResponse: Record<string, any> = {};
  
  Object.entries(responseMapping).forEach(([targetKey, sourcePath]) => {
    const pathParts = sourcePath.split('.');
    let value = data;
    
    for (const part of pathParts) {
      if (part.includes('[') && part.includes(']')) {
        const arrayName = part.substring(0, part.indexOf('['));
        const index = parseInt(part.substring(part.indexOf('[') + 1, part.indexOf(']')));
        if (value[arrayName] && Array.isArray(value[arrayName]) && value[arrayName].length > index) {
          value = value[arrayName][index];
        } else {
          value = undefined;
          break;
        }
      } else if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        value = undefined;
        break;
      }
    }
    
    mappedResponse[targetKey] = value;
  });
  
  return mappedResponse;
} 