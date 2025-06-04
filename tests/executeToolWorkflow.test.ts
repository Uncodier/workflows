import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ExecuteToolInput, ExecuteToolResult } from '../src/temporal/workflows/executeToolWorkflow';
import { validateParameters, executeApiCall, processResponse } from '../src/temporal/activities/executeToolActivities';

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('ExecuteTool Workflow Activities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateParameters', () => {
    it('should validate required parameters successfully', async () => {
      const toolName = 'test-tool';
      const args = { param1: 'value1' };
      const apiConfig = {
        endpoint: {
          url: 'https://example.com/api',
          method: 'GET' as const,
          headers: {}
        }
      };

      await expect(validateParameters(toolName, args, apiConfig)).resolves.not.toThrow();
    });

    it('should throw error for missing tool name', async () => {
      const args = { param1: 'value1' };
      const apiConfig = {
        endpoint: {
          url: 'https://example.com/api',
          method: 'GET' as const,
          headers: {}
        }
      };

      await expect(validateParameters('', args, apiConfig)).rejects.toThrow('Tool name is required');
    });

    it('should throw error for missing API config', async () => {
      const toolName = 'test-tool';
      const args = { param1: 'value1' };

      await expect(validateParameters(toolName, args, null)).rejects.toThrow('API configuration is required');
    });
  });

  describe('executeApiCall', () => {
    it('should execute GET request successfully', async () => {
      const mockResponse = {
        message: 'success',
        value: 42
      };
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const input: ExecuteToolInput = {
        toolName: 'test-get',
        args: { query: 'test' },
        apiConfig: {
          endpoint: {
            url: 'https://api.example.com/data',
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        }
      };

      const result = await executeApiCall(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/data?query=test',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: undefined
        }
      );
    });

    it('should execute POST request successfully', async () => {
      const mockResponse = {
        id: 123,
        created: true
      };
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      } as Response);

      const input: ExecuteToolInput = {
        toolName: 'test-post',
        args: { title: 'Test', content: 'Test content' },
        apiConfig: {
          endpoint: {
            url: 'https://api.example.com/posts',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        }
      };

      const result = await executeApiCall(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(result.statusCode).toBe(201);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/posts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test', content: 'Test content' })
        }
      );
    });

    it('should handle URL parameter replacement', async () => {
      const mockResponse = {
        user: 'john'
      };
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const input: ExecuteToolInput = {
        toolName: 'get-user',
        args: { userId: '123', extra: 'data' },
        apiConfig: {
          endpoint: {
            url: 'https://api.example.com/users/{userId}',
            method: 'GET',
            headers: {}
          }
        }
      };

      const result = await executeApiCall(input);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/123?userId=123&extra=data',
        {
          method: 'GET',
          headers: {},
          body: undefined
        }
      );
    });

    it('should handle authentication with Bearer token', async () => {
      const mockResponse = {
        authenticated: true
      };
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const input: ExecuteToolInput = {
        toolName: 'auth-test',
        args: {},
        apiConfig: {
          endpoint: {
            url: 'https://api.example.com/secure',
            method: 'GET',
            headers: {
              'Authorization': 'Bearer {{SERVICE_API_KEY}}'
            },
            requiresAuth: true,
            authType: 'Bearer'
          }
        },
        environment: {
          SERVICE_API_KEY: 'test-token-123'
        }
      };

      const result = await executeApiCall(input);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/secure',
        {
          method: 'GET',
          headers: { 'Authorization': 'Bearer test-token-123' },
          body: undefined
        }
      );
    });

    it('should handle local URLs in development', async () => {
      const mockResponse = {
        local: true
      };
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const input: ExecuteToolInput = {
        toolName: 'local-api',
        args: { test: 'value' },
        apiConfig: {
          endpoint: {
            url: '/api/local',
            method: 'GET',
            headers: {}
          }
        },
        environment: {
          NODE_ENV: 'development',
          PORT: '3000'
        }
      };

      const result = await executeApiCall(input);

      expect(result.success).toBe(true);
      expect(result.url).toBe('http://127.0.0.1:3000/api/local');
    });

    it('should handle API errors with custom error mapping', async () => {
      const errorResponse = {
        error: {
          message: 'Invalid request data'
        }
      };
      
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => errorResponse,
      } as Response);

      const input: ExecuteToolInput = {
        toolName: 'error-test',
        args: {},
        apiConfig: {
          endpoint: {
            url: 'https://api.example.com/error',
            method: 'GET',
            headers: {}
          },
          errors: {
            400: { message: 'error.message', code: 'BAD_REQUEST' }
          }
        }
      };

      const result = await executeApiCall(input);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid request data');
      expect(result.statusCode).toBe(400);
    });
  });

  describe('processResponse', () => {
    it('should map response data correctly', async () => {
      const responseData = {
        user: {
          id: 123,
          profile: {
            name: 'John Doe',
            email: 'john@example.com'
          }
        },
        settings: [
          { key: 'theme', value: 'dark' },
          { key: 'language', value: 'en' }
        ]
      };

      const mapping = {
        userId: 'user.id',
        userName: 'user.profile.name',
        userEmail: 'user.profile.email',
        firstSetting: 'settings[0].value'
      };

      const result = await processResponse(responseData, mapping);

      expect(result).toEqual({
        userId: 123,
        userName: 'John Doe',
        userEmail: 'john@example.com',
        firstSetting: 'dark'
      });
    });

    it('should handle missing paths gracefully', async () => {
      const responseData = {
        user: {
          id: 123
        }
      };

      const mapping = {
        userId: 'user.id',
        userName: 'user.profile.name',
        missing: 'non.existent.path'
      };

      const result = await processResponse(responseData, mapping);

      expect(result).toEqual({
        userId: 123,
        userName: undefined,
        missing: undefined
      });
    });

    it('should handle array access correctly', async () => {
      const responseData = {
        items: [
          { name: 'first', value: 1 },
          { name: 'second', value: 2 }
        ]
      };

      const mapping = {
        firstItem: 'items[0].name',
        secondValue: 'items[1].value',
        outOfBounds: 'items[5].name'
      };

      const result = await processResponse(responseData, mapping);

      expect(result).toEqual({
        firstItem: 'first',
        secondValue: 2,
        outOfBounds: undefined
      });
    });
  });
}); 