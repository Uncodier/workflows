"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiService = void 0;
const config_1 = require("../../config/config");
class ApiService {
    baseUrl;
    apiKey;
    constructor() {
        this.baseUrl = config_1.apiConfig.baseUrl;
        this.apiKey = config_1.apiConfig.apiKey;
        // 🔍 DIAGNOSTIC: Log configuration on initialization
        console.log('🔧 ApiService Configuration:');
        console.log(`   Base URL: ${this.baseUrl || 'NOT_SET'}`);
        console.log(`   API Key: ${this.apiKey ? 'SET' : 'NOT_SET'}`);
        console.log(`   Environment: NODE_ENV=${process.env.NODE_ENV}`);
        console.log(`   Raw API_BASE_URL: ${process.env.API_BASE_URL || 'NOT_SET'}`);
        console.log(`   Raw API_KEY: ${process.env.API_KEY ? 'SET' : 'NOT_SET'}`);
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
        const { method = 'GET', body, headers = {}, timeout = 60000 } = options;
        const url = this.buildUrl(endpoint);
        const requestHeaders = {
            ...this.getDefaultHeaders(),
            ...headers
        };
        console.log(`🌐 API Request: ${method} ${url}`);
        console.log(`🔧 Request Headers:`, JSON.stringify(requestHeaders, null, 2));
        console.log(`⏰ Timeout: ${timeout}ms`);
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
            // If the API response already has success/data structure, return it directly
            if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
                return data;
            }
            // Otherwise, wrap it in our standard format
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
            // 🔍 ENHANCED DIAGNOSTIC: More details about network error
            console.error(`🔥 API Network Error:`, apiError);
            console.error(`🔍 Network Error Details:`);
            console.error(`   URL attempted: ${url}`);
            console.error(`   Method: ${method}`);
            console.error(`   Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
            console.error(`   Error stack:`, error instanceof Error ? error.stack : 'No stack available');
            // Check common connectivity issues
            if (error instanceof Error) {
                if (error.message.includes('ENOTFOUND')) {
                    console.error(`🚨 DNS Resolution Error: Cannot resolve hostname from ${url}`);
                }
                else if (error.message.includes('ECONNREFUSED')) {
                    console.error(`🚨 Connection Refused: Server is not accepting connections at ${url}`);
                }
                else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
                    console.error(`🚨 Connection Timeout: Server did not respond in time at ${url}`);
                }
                else if (error.message.includes('certificate') || error.message.includes('SSL')) {
                    console.error(`🚨 SSL/TLS Error: Certificate or SSL handshake issue with ${url}`);
                }
            }
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
exports.apiService = new ApiService();
