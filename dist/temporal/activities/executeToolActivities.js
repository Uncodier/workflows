"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateParameters = validateParameters;
exports.executeApiCall = executeApiCall;
exports.processResponse = processResponse;
const apiService_1 = require("../services/apiService");
async function validateParameters(toolName, args, apiConfig) {
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
async function executeApiCall(input) {
    const { toolName, args, apiConfig, environment = {} } = input;
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
                console.log(`[Activity] Auto-corrected date format: ${key} = ${value} -> ${processedArgs[key]}`);
            }
        });
        // Reemplazar variables en la URL usando args procesados
        Object.keys(processedArgs).forEach(key => {
            url = url.replace(`{${key}}`, encodeURIComponent(String(processedArgs[key])));
        });
        console.log(`[Activity] Final URL: ${url}`);
        console.log(`[Activity] Method: ${method}`);
        console.log(`[Activity] Processed args:`, processedArgs);
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
        let result;
        // Si es una URL externa (completa), usar fetch directamente
        if (url.startsWith('http://') || url.startsWith('https://')) {
            console.log(`[Activity] External URL detected, using direct fetch`);
            result = await executeExternalApiCall(url, method, processedArgs, customHeaders);
        }
        else {
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
            const errorMessage = `Tool ${toolName} failed: ${result.error || 'Unknown error'} (Status: ${result.statusCode})`;
            console.error(`[Activity] ${errorMessage}`);
            throw new Error(errorMessage);
        }
        console.log(`[Activity] Tool ${toolName} executed successfully`);
        return result;
    }
    catch (error) {
        console.error(`[Activity] Error in API call for ${toolName}:`, error);
        // ✅ IMPORTANTE: Re-lanzar el error para que falle el activity
        throw error;
    }
}
// Función para manejar APIs externas (URLs completas)
async function executeExternalApiCall(url, method, processedArgs, headers) {
    let finalUrl = url;
    let body;
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
    }
    else {
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
    }
    catch {
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
async function executeLocalApiCall(endpoint, method, processedArgs, customHeaders) {
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
            return await apiService_1.apiService.get(endpoint, headers);
        case 'POST':
            return await apiService_1.apiService.post(endpoint, processedArgs, headers);
        case 'PUT':
            return await apiService_1.apiService.put(endpoint, processedArgs, headers);
        case 'DELETE':
            return await apiService_1.apiService.delete(endpoint, headers);
        case 'PATCH':
            return await apiService_1.apiService.patch(endpoint, processedArgs, headers);
        default:
            throw new Error(`Unsupported method: ${method}`);
    }
}
async function processResponse(data, responseMapping) {
    console.log(`[Activity] Processing response with mapping`);
    const mappedResponse = {};
    Object.entries(responseMapping).forEach(([targetKey, sourcePath]) => {
        const pathParts = sourcePath.split('.');
        let value = data;
        for (const part of pathParts) {
            if (part.includes('[') && part.includes(']')) {
                const arrayName = part.substring(0, part.indexOf('['));
                const index = parseInt(part.substring(part.indexOf('[') + 1, part.indexOf(']')));
                if (value[arrayName] && Array.isArray(value[arrayName]) && value[arrayName].length > index) {
                    value = value[arrayName][index];
                }
                else {
                    value = undefined;
                    break;
                }
            }
            else if (value && typeof value === 'object' && part in value) {
                value = value[part];
            }
            else {
                value = undefined;
                break;
            }
        }
        mappedResponse[targetKey] = value;
    });
    return mappedResponse;
}
