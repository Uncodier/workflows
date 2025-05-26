import { apiConfig } from '../../config/config';

/**
 * Generic function to make API calls
 * @param endpoint API endpoint path
 * @param method HTTP method
 * @param data Request data
 * @returns API response
 */
async function callApi(endpoint: string, method: string = 'GET', data?: any) {
  const url = `${apiConfig.baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiConfig.apiKey}`,
  };

  const options: RequestInit = {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  };

  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call error:', error);
    throw error;
  }
}

/**
 * Activity to fetch data from the API
 */
export async function fetchDataActivity(resourceId: string): Promise<any> {
  return callApi(`/resources/${resourceId}`);
}

/**
 * Activity to create a resource via the API
 */
export async function createResourceActivity(data: any): Promise<any> {
  return callApi('/resources', 'POST', data);
}

/**
 * Activity to update a resource via the API
 */
export async function updateResourceActivity(resourceId: string, data: any): Promise<any> {
  return callApi(`/resources/${resourceId}`, 'PUT', data);
}

/**
 * Activity to delete a resource via the API
 */
export async function deleteResourceActivity(resourceId: string): Promise<any> {
  return callApi(`/resources/${resourceId}`, 'DELETE');
} 