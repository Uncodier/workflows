import { ExecuteToolInput, ExecuteToolResult } from '../workflows/executeToolWorkflow';
import { apiService } from '../services/apiService';

export async function validateParameters(
  toolName: string, 
  args: Record<string, any>, 
  apiConfig: any
): Promise<void> {
  // Validación de parámetros si es necesaria
  console.log(`[Activity] Validating parameters for tool: ${toolName}`);
  
  // Agregar validaciones específicas aquí
  if (!toolName) {
    throw new Error('Tool name is required');
  }
  
  if (!apiConfig || !apiConfig.endpoint) {
    throw new Error('API configuration is required');
  }
}

export async function executeApiCall(input: ExecuteToolInput): Promise<ExecuteToolResult> {
  const { toolName, args, apiConfig, environment = {} } = input;
  let url = apiConfig.endpoint.url;
  
  try {
    console.log(`[Activity] Executing API call for tool: ${toolName}`);
    
    const method = apiConfig.endpoint.method;
    
    // Reemplazar variables en la URL
    Object.keys(args).forEach(key => {
      url = url.replace(`{${key}}`, encodeURIComponent(String(args[key])));
    });
    
    console.log(`[Activity] Final URL: ${url}`);
    console.log(`[Activity] Method: ${method}`);
    
    // Preparar headers personalizados
    const customHeaders = { ...apiConfig.endpoint.headers };
    
    // Procesar autenticación en headers
    if (apiConfig.endpoint.requiresAuth) {
      switch (apiConfig.endpoint.authType) {
        case 'Bearer':
          Object.keys(customHeaders).forEach(key => {
            if (customHeaders[key] && typeof customHeaders[key] === 'string' && customHeaders[key].includes('{{')) {
              if (customHeaders[key].includes('{{SUPPORT_API_TOKEN}}')) {
                customHeaders[key] = customHeaders[key].replace('{{SUPPORT_API_TOKEN}}', environment.SUPPORT_API_TOKEN || '');
              }
              if (customHeaders[key].includes('{{SERVICE_API_KEY}}')) {
                customHeaders[key] = customHeaders[key].replace('{{SERVICE_API_KEY}}', environment.SERVICE_API_KEY || '');
              }
            }
          });
          break;
        case 'ApiKey':
          Object.keys(customHeaders).forEach(key => {
            if (customHeaders[key] && typeof customHeaders[key] === 'string' && customHeaders[key].includes('{{')) {
              if (customHeaders[key].includes('{{WEATHER_API_KEY}}')) {
                customHeaders[key] = customHeaders[key].replace('{{WEATHER_API_KEY}}', environment.WEATHER_API_KEY || '');
              }
              if (customHeaders[key].includes('{{SERVICE_API_KEY}}')) {
                customHeaders[key] = customHeaders[key].replace('{{SERVICE_API_KEY}}', environment.SERVICE_API_KEY || '');
              }
            }
          });
          break;
      }
    }
    
    // Si es una URL externa (completa), usar fetch directamente
    if (url.startsWith('http://') || url.startsWith('https://')) {
      console.log(`[Activity] External URL detected, using direct fetch`);
      return await executeExternalApiCall(url, method, args, customHeaders);
    }
    
    // Si es una URL local (que empieza con /), usar apiService
    console.log(`[Activity] Local URL detected, using apiService`);
    const response = await executeLocalApiCall(url, method, args, customHeaders);
    
    return {
      success: response.success,
      data: response.data,
      error: response.error?.message,
      statusCode: response.error?.status,
      url: url
    };
    
  } catch (error: any) {
    console.error(`[Activity] Error in API call for ${toolName}:`, error);
    
    return {
      success: false,
      error: error.message || 'Unknown error',
      url: url
    };
  }
}

// Función para manejar APIs externas (URLs completas)
async function executeExternalApiCall(
  url: string,
  method: string,
  args: any,
  headers: Record<string, string>
): Promise<ExecuteToolResult> {
  let finalUrl = url;
  let body: string | undefined;
  
  // Configurar body y URL según el método HTTP
  if (method === 'GET') {
    const queryParams = new URLSearchParams();
    Object.keys(args).forEach(key => {
      if (!url.includes(`{${key}}`)) {
        queryParams.append(key, String(args[key]));
      }
    });
    const queryString = queryParams.toString();
    finalUrl = queryString ? `${url}?${queryString}` : url;
  } else {
    body = JSON.stringify(args);
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
  args: any,
  customHeaders: Record<string, string>
): Promise<{ success: boolean; data?: any; error?: { message: string; status?: number } }> {
  
  // Remover Content-Type del customHeaders si existe, apiService lo maneja automáticamente
  const { 'Content-Type': _, ...headers } = customHeaders;
  
  switch (method.toUpperCase()) {
    case 'GET':
      // Para GET, agregar args como query parameters si no están en la URL
      if (Object.keys(args).length > 0) {
        const queryParams = new URLSearchParams();
        Object.keys(args).forEach(key => {
          if (!endpoint.includes(`{${key}}`)) {
            queryParams.append(key, String(args[key]));
          }
        });
        const queryString = queryParams.toString();
        if (queryString) {
          endpoint = `${endpoint}?${queryString}`;
        }
      }
      return await apiService.get(endpoint, headers);
      
    case 'POST':
      return await apiService.post(endpoint, args, headers);
      
    case 'PUT':
      return await apiService.put(endpoint, args, headers);
      
    case 'DELETE':
      return await apiService.delete(endpoint, headers);
      
    case 'PATCH':
      return await apiService.patch(endpoint, args, headers);
      
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