import { apiConfig } from '../../config/config';
class ApiService {
    constructor() {
        this.baseUrl = apiConfig.baseUrl;
        this.apiKey = apiConfig.apiKey;
        if (!this.baseUrl) {
            throw new Error('API_BASE_URL environment variable is not configured');
        }
        if (!this.apiKey) {
            throw new Error('API_KEY environment variable is not configured');
        }
    }
    /**
     * Get default headers with x-api-key authentication
     */
    getDefaultHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
        };
    }
    /**
     * Build full URL from endpoint
     */
    buildUrl(endpoint) {
        const cleanBaseUrl = this.baseUrl.replace(/\/$/, '');
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${cleanBaseUrl}${cleanEndpoint}`;
    }
    /**
     * Make API request with proper error handling and logging
     */
    async request(endpoint, options = {}) {
        const { method = 'GET', body, headers = {}, timeout = 30000 } = options;
        const url = this.buildUrl(endpoint);
        const requestHeaders = {
            ...this.getDefaultHeaders(),
            ...headers
        };
        console.log(`🌐 API Request: ${method} ${url}`);
        if (body) {
            console.log(`📤 Request body:`, JSON.stringify(body, null, 2));
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                method,
                headers: requestHeaders,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorText = await response.text();
                const error = {
                    code: `HTTP_${response.status}`,
                    message: `API call failed: ${response.status} ${response.statusText}. ${errorText}`,
                    status: response.status
                };
                console.error(`❌ API Error:`, error);
                return {
                    success: false,
                    error
                };
            }
            const data = await response.json();
            console.log(`✅ API Response:`, JSON.stringify(data, null, 2));
            return {
                success: true,
                data
            };
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === 'AbortError') {
                const timeoutError = {
                    code: 'TIMEOUT',
                    message: `Request timeout after ${timeout}ms`
                };
                console.error(`⏰ API Timeout:`, timeoutError);
                return {
                    success: false,
                    error: timeoutError
                };
            }
            const apiError = {
                code: 'NETWORK_ERROR',
                message: error instanceof Error ? error.message : String(error)
            };
            console.error(`🔥 API Network Error:`, apiError);
            return {
                success: false,
                error: apiError
            };
        }
    }
    /**
     * GET request
     */
    async get(endpoint, headers) {
        return this.request(endpoint, { method: 'GET', headers });
    }
    /**
     * POST request
     */
    async post(endpoint, body, headers) {
        return this.request(endpoint, { method: 'POST', body, headers });
    }
    /**
     * PUT request
     */
    async put(endpoint, body, headers) {
        return this.request(endpoint, { method: 'PUT', body, headers });
    }
    /**
     * DELETE request
     */
    async delete(endpoint, headers) {
        return this.request(endpoint, { method: 'DELETE', headers });
    }
    /**
     * PATCH request
     */
    async patch(endpoint, body, headers) {
        return this.request(endpoint, { method: 'PATCH', body, headers });
    }
}
// Export singleton instance
export const apiService = new ApiService();
