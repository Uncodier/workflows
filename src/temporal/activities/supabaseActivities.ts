// Temporary implementation without Supabase
// TODO: Implement actual Supabase integration when credentials are available

/**
 * Activity to log workflow execution (temporary console implementation)
 */
export async function logWorkflowExecutionActivity(data: {
  workflowId: string;
  workflowType: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
}): Promise<any> {
  console.log('Workflow Execution Log:', JSON.stringify(data, null, 2));
  return { id: Date.now(), ...data };
}

/**
 * Activity to track API call metrics (temporary console implementation)
 */
export async function trackApiCallActivity(data: {
  endpoint: string;
  method: string;
  statusCode: number;
  duration: number;
  workflowId?: string;
  error?: string;
}): Promise<any> {
  console.log('API Call Metrics:', JSON.stringify(data, null, 2));
  return { id: Date.now(), ...data };
}

/**
 * Activity to fetch configuration (temporary implementation)
 */
export async function fetchConfigurationActivity(configName: string): Promise<any> {
  const mockConfig = {
    name: configName,
    value: {
      enabled: true,
      retryAttempts: 3,
      timeout: '1m',
    }
  };
  console.log('Fetching Configuration:', mockConfig);
  return mockConfig.value;
}

/**
 * Activity to store workflow results (temporary console implementation)
 */
export async function storeWorkflowResultActivity(data: {
  workflowId: string;
  result: any;
  metadata?: Record<string, any>;
}): Promise<any> {
  console.log('Storing Workflow Result:', JSON.stringify(data, null, 2));
  return { id: Date.now(), ...data };
}

/**
 * Activity to create a resource (temporary implementation)
 */
export async function createResourceActivity(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log('Creating Resource:', JSON.stringify(data, null, 2));
  return { id: Date.now(), ...data };
}

/**
 * Activity to update a resource (temporary implementation)
 */
export async function updateResourceActivity(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log('Updating Resource:', id, JSON.stringify(data, null, 2));
  return { id, ...data, updatedAt: new Date().toISOString() };
}

/**
 * Activity to delete a resource (temporary implementation)
 */
export async function deleteResourceActivity(id: string): Promise<void> {
  console.log('Deleting Resource:', id);
} 