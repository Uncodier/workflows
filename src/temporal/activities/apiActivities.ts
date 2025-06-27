import { apiService } from '../services/apiService';

/**
 * Activity to fetch data from the API
 */
export async function fetchDataActivity(resourceId: string): Promise<any> {
  const response = await apiService.get(`/resources/${resourceId}`);
  
  if (!response.success) {
    throw new Error(`Failed to fetch resource ${resourceId}: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to create a resource via the API
 */
export async function createApiResourceActivity(data: any): Promise<any> {
  const response = await apiService.post('/resources', data);
  
  if (!response.success) {
    throw new Error(`Failed to create resource: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to update a resource via the API
 */
export async function updateApiResourceActivity(resourceId: string, data: any): Promise<any> {
  const response = await apiService.put(`/resources/${resourceId}`, data);
  
  if (!response.success) {
    throw new Error(`Failed to update resource ${resourceId}: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to delete a resource via the API
 */
export async function deleteApiResourceActivity(resourceId: string): Promise<any> {
  const response = await apiService.delete(`/resources/${resourceId}`);
  
  if (!response.success) {
    throw new Error(`Failed to delete resource ${resourceId}: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to send daily stand up notification
 */
export async function sendDailyStandUpNotificationActivity(params: {
  site_id: string;
  subject: string;
  message: string;
  systemAnalysis?: any; // Optional system analysis data
}): Promise<any> {
  const { site_id, subject, message, systemAnalysis } = params;
  
  const response = await apiService.post('/api/notifications/dailyStandUp', {
    site_id,
    subject,
    message,
    systemAnalysis
  });
  
  if (!response.success) {
    throw new Error(`Failed to send daily stand up notification: ${response.error?.message}`);
  }
  
  return response.data;
} 