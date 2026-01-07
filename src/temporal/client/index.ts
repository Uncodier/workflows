import { temporalConfig } from '../../config/config';
import { getTaskQueueForWorkflow } from '../config/taskQueues';
import { extractSearchAttributesFromInput, mergeSearchAttributes } from '../utils/searchAttributes';

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
 * Options for executeWorkflow function
 */
export interface ExecuteWorkflowOptions {
  /**
   * Custom search attributes to attach to the workflow
   * These enable filtering workflows in Temporal UI and programmatically
   */
  searchAttributes?: Record<string, string[]>;
  
  /**
   * Whether to automatically extract search attributes from the first argument
   * @default true
   */
  autoExtractSearchAttributes?: boolean;
}

/**
 * Helper function to execute a workflow with the Temporal client
 * Automatically extracts search attributes from workflow inputs for filtering in Temporal UI
 * 
 * @param workflowType Workflow function name
 * @param args Arguments to pass to the workflow
 * @param workflowId Optional custom workflow ID
 * @param taskQueue Optional custom task queue
 * @param options Optional configuration including searchAttributes
 * @returns Workflow handle
 * 
 * @example
 * // Automatic search attributes extraction
 * await executeWorkflow('buildSegmentsWorkflow', [{ site_id: 'site-123', userId: 'user-456' }]);
 * // searchAttributes { site_id: ['site-123'], user_id: ['user-456'] } added automatically
 * 
 * @example
 * // Manual search attributes
 * await executeWorkflow('myWorkflow', [args], 'my-id', 'default', {
 *   searchAttributes: { site_id: ['site-123'], workflow_category: ['critical'] }
 * });
 */
export async function executeWorkflow(
  workflowType: string,
  args: unknown[],
  workflowId?: string,
  taskQueue?: string,
  options?: ExecuteWorkflowOptions
) {
  const client = await getTemporalClient();
  
  // Auto-extract search attributes from first argument if it's an object
  let searchAttributes: Record<string, string[]> = {};
  
  if (options?.autoExtractSearchAttributes !== false && args[0] && typeof args[0] === 'object') {
    const extracted = extractSearchAttributesFromInput(args[0] as Record<string, any>);
    searchAttributes = extracted;
  }
  
  // Merge with manually provided search attributes (manual takes precedence)
  if (options?.searchAttributes) {
    searchAttributes = mergeSearchAttributes(searchAttributes, options.searchAttributes);
  }
  
  return client.workflow.start(workflowType, {
    args,
    workflowId: workflowId || `${workflowType}-${Date.now()}`,
    taskQueue: taskQueue || getTaskQueueForWorkflow(workflowType),
    // Only add searchAttributes if we have any
    ...(Object.keys(searchAttributes).length > 0 && { searchAttributes })
  });
} 