/**
 * Creates and returns a Temporal client connection
 * @returns Temporal client instance
 */
export declare function getTemporalClient(): Promise<any>;
/**
 * Helper function to execute a workflow with the Temporal client
 * @param workflowType Workflow function name
 * @param args Arguments to pass to the workflow
 * @param workflowId Optional custom workflow ID
 * @param taskQueue Optional custom task queue
 * @returns Workflow handle
 */
export declare function executeWorkflow(workflowType: string, args: unknown[], workflowId?: string, taskQueue?: string): Promise<any>;
