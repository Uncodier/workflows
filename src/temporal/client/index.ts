import { temporalConfig } from '../../config/config';

/**
 * Creates and returns a Temporal client connection
 * @returns Temporal client instance
 */
export async function getTemporalClient() {
  // Use require to avoid TypeScript issues
  const { Connection, Client } = require('@temporalio/client');
  
  // Configure connection options based on environment
  const connectionOptions: any = {
    address: temporalConfig.serverUrl,
  };

  // Add TLS and API key for remote connections (Temporal Cloud)
  if (temporalConfig.tls) {
    connectionOptions.tls = {};
  }

  if (temporalConfig.apiKey) {
    connectionOptions.metadata = {
      'temporal-namespace': temporalConfig.namespace,
    };
    connectionOptions.apiKey = temporalConfig.apiKey;
  }

  const connection = await Connection.connect(connectionOptions);

  return new Client({
    connection,
    namespace: temporalConfig.namespace,
  });
}

/**
 * Helper function to execute a workflow with the Temporal client
 * @param workflowType Workflow function name
 * @param args Arguments to pass to the workflow
 * @param workflowId Optional custom workflow ID
 * @param taskQueue Optional custom task queue
 * @returns Workflow handle
 */
export async function executeWorkflow(
  workflowType: string,
  args: unknown[],
  workflowId?: string,
  taskQueue?: string
) {
  const client = await getTemporalClient();
  
  return client.workflow.start(workflowType, {
    args,
    workflowId: workflowId || `${workflowType}-${Date.now()}`,
    taskQueue: taskQueue || temporalConfig.taskQueue,
  });
} 