/**
 * Centralized API Service
 * Handles all external API calls with proper authentication using x-api-key header
 */
interface ApiRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: any;
    headers?: Record<string, string>;
    timeout?: number;
}
interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        status?: number;
    };
}
declare class ApiService {
    private readonly baseUrl;
    private readonly apiKey;
    constructor();
    /**
     * Get default headers with x-api-key authentication
     */
    private getDefaultHeaders;
    /**
     * Build full URL from endpoint
     */
    private buildUrl;
    /**
     * Make API request with proper error handling and logging
     */
    request<T = any>(endpoint: string, options?: ApiRequestOptions): Promise<ApiResponse<T>>;
    /**
     * GET request
     */
    get<T = any>(endpoint: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;
    /**
     * POST request
     */
    post<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>>;
    /**
     * PUT request
     */
    put<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>>;
    /**
     * DELETE request
     */
    delete<T = any>(endpoint: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;
    /**
     * PATCH request
     */
    patch<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>>;
}
export declare const apiService: ApiService;
export type { ApiResponse, ApiRequestOptions };
