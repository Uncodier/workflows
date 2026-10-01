import { apiConfig } from '../../config/config';
import { redactSensitiveHeaders } from './headerSecurity';
import { admissionRetryAfterMs, canRetryIcpAdmission } from './apiAdmissionRetry';

export { redactSensitiveHeaders } from './headerSecurity';

export function redactUrlForLogs(value: string): string {
  const queryIndex = value.indexOf('?');
  const fragmentIndex = value.indexOf('#');
  const suffixIndexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const pathEnd = suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : value.length;
  const safePath = value.slice(0, pathEnd).replace(
    /^(https?:\/\/)[^/@\s]+@/i,
    '$1[REDACTED]@'
  );

  return queryIndex >= 0 ? `${safePath}?[REDACTED]` : safePath;
}

/**
 * Centralized API Service
 * Handles all external API calls with proper authentication using x-api-key header
 */

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    status?: number;
    retryAfterMs?: number;
    requestNotStarted?: boolean;
  };
}

export class ApiService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl = apiConfig.baseUrl, apiKey = apiConfig.apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    
    // 🔍 DIAGNOSTIC: Log configuration on initialization
    console.log('🔧 ApiService Configuration:');
    console.log(`   Base URL: ${this.baseUrl ? redactUrlForLogs(this.baseUrl) : 'NOT_SET'}`);
    console.log(`   API Key: ${this.apiKey ? 'SET' : 'NOT_SET'}`);
    console.log(`   Environment: NODE_ENV=${process.env.NODE_ENV}`);
    console.log(
      `   Raw API_BASE_URL: ${
        process.env.API_BASE_URL
          ? redactUrlForLogs(process.env.API_BASE_URL)
          : 'NOT_SET'
      }`
    );
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
  private getDefaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };
  }

  /**
   * Build full URL from endpoint
   */
  private buildUrl(endpoint: string): string {
    const cleanBaseUrl = this.baseUrl.replace(/\/$/, '');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${cleanBaseUrl}${cleanEndpoint}`;
  }

  /**
   * Make API request with proper error handling and logging
   */
  async request<T = any>(
    endpoint: string, 
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    if (!canRetryIcpAdmission(endpoint, options.method ?? 'GET')) {
      return this.requestOnce<T>(endpoint, options);
    }

    // Retries live inside the activity: no new Temporal workflow commands or
    // replay changes, and no re-enrichment of previously completed candidates.
    const deadline = Date.now() + (options.timeout ?? 300000);
    for (let attempt = 0; ; attempt++) {
      const result = await this.requestOnce<T>(endpoint, {
        ...options, timeout: Math.max(1, deadline - Date.now()),
      });
      if (result.success || result.error?.status !== 429 || !result.error.requestNotStarted
        || !Number.isFinite(result.error.retryAfterMs) || attempt >= 3) return result;
      const delayMs = result.error.retryAfterMs! + 250 + Math.floor(Math.random() * 751);
      // Leave time for the next request; a long server cooldown is not shortened.
      if (Date.now() + delayMs + 1000 >= deadline) return result;
      console.warn(`⏳ ICP API admission limited: ${redactUrlForLogs(endpoint)}; retry ${attempt + 1}/3 in ${delayMs}ms`);
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', aborted);
          reject(options.signal?.reason || new Error('Request cancelled'));
        };
        const timer = setTimeout(() => { options.signal?.removeEventListener('abort', aborted); resolve(); }, delayMs);
        options.signal?.addEventListener('abort', aborted, { once: true });
        if (options.signal?.aborted) aborted();
      });
      if (Date.now() + 1000 >= deadline) return result;
    }
  }

  private async requestOnce<T>(endpoint: string, options: ApiRequestOptions): Promise<ApiResponse<T>> {
    const { method = 'GET', body, headers = {}, timeout = 300000 } = options;
    
    const url = this.buildUrl(endpoint);
    const requestHeaders = {
      ...this.getDefaultHeaders(),
      ...headers
    };
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const safeUrl = redactUrlForLogs(url);
    const safeEndpoint = redactUrlForLogs(endpoint);

    console.log(`🌐 API Request: ${method} ${safeUrl}`);
    console.log(
      `🔧 Request Headers:`,
      JSON.stringify(redactSensitiveHeaders(requestHeaders), null, 2)
    );
    console.log(`⏰ Timeout: ${timeout}ms`);
    if (serializedBody !== undefined) {
      console.log(`📤 Request body: [REDACTED] (${serializedBody.length} bytes)`);
    }

    const controller = new AbortController();
    const abortRequest = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abortRequest, { once: true });
    if (options.signal?.aborted) abortRequest();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      console.log(`🚀 Initiating fetch request to: ${safeEndpoint}`);
      
      // Log request details for debugging 414 errors
      const bodySize = serializedBody?.length ?? 0;
      const urlLength = url.length;
      console.log(`📊 Request details: URL length: ${urlLength} chars, Body size: ${bodySize} bytes`);
      
      if (urlLength > 2000) {
        console.warn(`⚠️ Long URL detected (${urlLength} chars). Some servers limit URLs to ~2048 chars.`);
      }
      
      if (bodySize > 100000) { // 100KB
        console.warn(`⚠️ Large request body (${bodySize} bytes). This could cause server issues.`);
      }
      
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: controller.signal,
      });

      console.log(`📡 Fetch completed, status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        
        // Special handling for 414 Request-URI Too Large
        if (response.status === 414) {
          const error = {
            code: `HTTP_414`,
            message: `Request-URI Too Large (414): The URL length exceeds the server limit. This usually indicates that too much data is being sent in the URL parameters. Error details: ${errorText}`,
            status: 414
          };
          
          console.error(`🚨 CRITICAL: 414 Request-URI Too Large detected on endpoint: ${safeEndpoint}`);
          console.error(`🔧 URL length: ${url.length} chars, Body size: ${bodySize} bytes`);
          console.error(`🔧 SOLUTION: Consider using POST body instead of URL parameters for large data payloads`);
          console.error(`🔧 Error status: ${error.code}`);
          
          return {
            success: false,
            error
          };
        }
        
        // Special handling for HTML error responses (typically from Cloudflare)
        if (errorText.includes('<html>') || errorText.includes('cloudflare')) {
          const error = {
            code: `HTTP_${response.status}`,
            message: `Server returned HTML error page (likely from Cloudflare): ${response.status} ${response.statusText}. This often indicates a 414 Request-URI Too Large error. Raw response: ${errorText}`,
            status: response.status
          };
          
          console.error(`🚨 CRITICAL: HTML error page detected on endpoint: ${safeEndpoint}`);
          console.error(`🔧 This is likely a 414 Request-URI Too Large error from Cloudflare`);
          console.error(`🔧 URL length: ${url.length} chars, Body size: ${bodySize} bytes`);
          
          return {
            success: false,
            error
          };
        }
        
        const retryAfterMs = admissionRetryAfterMs(response.status, errorText, response.headers?.get('Retry-After') ?? null);
        const error = {
          code: `HTTP_${response.status}`,
          message: `API call failed: ${response.status} ${response.statusText}. ${errorText}`,
          status: response.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs, requestNotStarted: true } : {}),
        };
        
        console.error(`❌ API Error: ${error.code} (${response.status})`);
        
        return {
          success: false,
          error
        };
      }

      const data = await response.json();
      console.log(`✅ API Response received`);
      
      // If the API response already has success/data structure, return it directly
      if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
        return data;
      }
      
      // Otherwise, wrap it in our standard format
      return {
        success: true,
        data
      };

    } catch (error) {
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
      console.error(`🔥 API Network Error: ${apiError.code}`);
      console.error(`🔍 Network Error Details:`);
      console.error(`   URL attempted: ${safeUrl}`);
      console.error(`   Method: ${method}`);
      console.error(`   Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      
      // Check common connectivity issues
      if (error instanceof Error) {
        if (error.message.includes('ENOTFOUND')) {
          console.error(`🚨 DNS Resolution Error: Cannot resolve hostname from ${safeUrl}`);
        } else if (error.message.includes('ECONNREFUSED')) {
          console.error(`🚨 Connection Refused: Server is not accepting connections at ${safeUrl}`);
        } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
          console.error(`🚨 Connection Timeout: Server did not respond in time at ${safeUrl}`);
        } else if (error.message.includes('certificate') || error.message.includes('SSL')) {
          console.error(`🚨 SSL/TLS Error: Certificate or SSL handshake issue with ${safeUrl}`);
        }
      }
      
      return {
        success: false,
        error: apiError
      };
    } finally {
      options.signal?.removeEventListener('abort', abortRequest);
      // Cover response body reads as well as headers, including during retries.
      clearTimeout(timeoutId);
    }
  }

  /**
   * GET request
   */
  async get<T = any>(endpoint: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', headers });
  }

  /**
   * POST request
   */
  async post<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', body, headers });
  }

  /**
   * PUT request
   */
  async put<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PUT', body, headers });
  }

  /**
   * DELETE request
   */
  async delete<T = any>(endpoint: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE', headers });
  }

  /**
   * PATCH request
   */
  async patch<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PATCH', body, headers });
  }
}

// Export singleton instance
export const apiService = new ApiService();
export type { ApiResponse, ApiRequestOptions }; 