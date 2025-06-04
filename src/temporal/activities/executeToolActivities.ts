import { ExecuteToolInput, ExecuteToolResult } from '../workflows/executeToolWorkflow';

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
  let currentUrl = '';
  
  try {
    console.log(`[Activity] Executing API call for tool: ${toolName}`);
    
    // Preparar la URL reemplazando variables en la ruta
    let url = apiConfig.endpoint.url;
    currentUrl = url;
    
    // Manejar URLs locales
    if (url.startsWith('/')) {
      if (environment.API_BASE_URL) {
        const baseUrl = environment.API_BASE_URL.endsWith('/')
          ? environment.API_BASE_URL.slice(0, -1)
          : environment.API_BASE_URL;
        url = `${baseUrl}${url}`;
      } else {
        // Fallback si no hay API_BASE_URL configurada
        const port = environment.PORT || 3000;
        url = `http://127.0.0.1:${port}${url}`;
      }
      currentUrl = url;
    }
    
    // Reemplazar variables en la URL
    Object.keys(args).forEach(key => {
      url = url.replace(`{${key}}`, encodeURIComponent(String(args[key])));
    });
    currentUrl = url;
    
    // Preparar headers
    const headers = { ...apiConfig.endpoint.headers };
    
    // Manejar autenticación para URLs locales
    const isLocalUrl = url.startsWith('/') || url.includes('localhost') || url.includes('127.0.0.1');
    if (isLocalUrl && environment.SERVICE_API_KEY) {
      if (!headers['Authorization'] && !headers['x-api-key']) {
        headers['x-api-key'] = environment.SERVICE_API_KEY;
      }
    }
    
    // Procesar autenticación
    if (apiConfig.endpoint.requiresAuth) {
      switch (apiConfig.endpoint.authType) {
        case 'Bearer':
          if (headers['Authorization'] && headers['Authorization'].includes('{{')) {
            if (headers['Authorization'].includes('{{SUPPORT_API_TOKEN}}')) {
              headers['Authorization'] = headers['Authorization'].replace('{{SUPPORT_API_TOKEN}}', environment.SUPPORT_API_TOKEN || '');
            }
            if (headers['Authorization'].includes('{{SERVICE_API_KEY}}')) {
              headers['Authorization'] = headers['Authorization'].replace('{{SERVICE_API_KEY}}', environment.SERVICE_API_KEY || '');
            }
          }
          break;
        case 'ApiKey':
          Object.keys(headers).forEach(key => {
            if (headers[key] && typeof headers[key] === 'string' && headers[key].includes('{{')) {
              if (headers[key].includes('{{WEATHER_API_KEY}}')) {
                headers[key] = headers[key].replace('{{WEATHER_API_KEY}}', environment.WEATHER_API_KEY || '');
              }
              if (headers[key].includes('{{SERVICE_API_KEY}}')) {
                headers[key] = headers[key].replace('{{SERVICE_API_KEY}}', environment.SERVICE_API_KEY || '');
              }
            }
          });
          break;
      }
    }
    
    // Ejecutar petición HTTP con lógica de retry para conexiones locales
    const response = await executeHttpRequestWithRetry(url, apiConfig.endpoint.method, args, headers, environment);
    
    return {
      success: true,
      data: response.data,
      statusCode: response.status,
      url: currentUrl
    };
    
  } catch (error: any) {
    console.error(`[Activity] Error in API call for ${toolName}:`, error);
    
    let errorMessage = error.message || 'Unknown error';
    const statusCode = error.response?.status || error.status;
    
    // Manejar errores específicos basados en código de estado
    if (error.response && apiConfig.errors && apiConfig.errors[error.response.status]) {
      const errorConfig = apiConfig.errors[error.response.status];
      const responseData = error.response.data;
      
      // Extraer mensaje de error según mapeo
      if (errorConfig.message) {
        const messageParts = errorConfig.message.split('.');
        let messageValue = responseData;
        
        for (const part of messageParts) {
          if (messageValue && typeof messageValue === 'object' && part in messageValue) {
            messageValue = messageValue[part];
          } else {
            messageValue = undefined;
            break;
          }
        }
        
        if (messageValue && typeof messageValue === 'string') {
          errorMessage = messageValue;
        }
      }
    }
    
    return {
      success: false,
      error: errorMessage,
      statusCode,
      url: currentUrl
    };
  }
}

async function executeHttpRequestWithRetry(
  url: string, 
  method: string, 
  args: any, 
  headers: Record<string, string>,
  _environment: Record<string, any>
): Promise<any> {
  const makeRequest = async (requestUrl: string) => {
    let finalUrl = requestUrl;
    let body: string | undefined;
    
    // Configurar body y URL según el método HTTP
    if (method === 'GET') {
      const queryParams = new URLSearchParams();
      Object.keys(args).forEach(key => {
        if (!requestUrl.includes(`{${key}}`)) {
          queryParams.append(key, String(args[key]));
        }
      });
      const queryString = queryParams.toString();
      finalUrl = queryString ? `${requestUrl}?${queryString}` : requestUrl;
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
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      (error as any).response = {
        status: response.status,
        data
      };
      throw error;
    }
    
    return {
      data,
      status: response.status
    };
  };
  
  try {
    return await makeRequest(url);
  } catch (error: any) {
    // Lógica de retry para conexiones locales
    if ((error.code === 'ECONNREFUSED' || error.errno === -61 || error.message?.includes('fetch failed')) && 
       (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1'))) {
      
      const alternativePorts = [3000, 3001, 8080];
      const alternativeHosts = ['127.0.0.1', 'localhost'];
      
      const urlObj = new URL(url);
      const originalPort = urlObj.port || '3000';
      const originalHostname = urlObj.hostname;
      
      // Intentar combinaciones de host/puerto
      for (const host of alternativeHosts) {
        for (const port of alternativePorts) {
          if (host === originalHostname && port.toString() === originalPort) continue;
          
          try {
            urlObj.hostname = host;
            urlObj.port = port.toString();
            const altUrl = urlObj.toString();
            
            console.log(`[Activity] Trying alternative: ${altUrl}`);
            return await makeRequest(altUrl);
          } catch {
            console.log(`[Activity] Failed with ${host}:${port}`);
          }
        }
      }
    }
    
    throw error;
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