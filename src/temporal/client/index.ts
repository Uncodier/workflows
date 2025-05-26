import { Connection, Client } from '@temporalio/client';
import { temporalConfig } from '../../config/config';

/**
 * Creates and returns a Temporal client connection
 * @returns Temporal client instance
 */
export async function getTemporalClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: temporalConfig.serverUrl,
  });

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
export async function executeWorkflow<T>(
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