/**
 * Activity to log workflow execution (temporary console implementation)
 */
export declare function logWorkflowExecutionActivity(data: {
    workflowId: string;
    workflowType: string;
    status: string;
    input?: any;
    output?: any;
    error?: string;
}): Promise<any>;
/**
 * Activity to track API call metrics (temporary console implementation)
 */
export declare function trackApiCallActivity(data: {
    endpoint: string;
    method: string;
    statusCode: number;
    duration: number;
    workflowId?: string;
    error?: string;
}): Promise<any>;
/**
 * Activity to fetch configuration (temporary implementation)
 */
export declare function fetchConfigurationActivity(configName: string): Promise<any>;
/**
 * Activity to store workflow results (temporary console implementation)
 */
export declare function storeWorkflowResultActivity(data: {
    workflowId: string;
    result: any;
    metadata?: Record<string, any>;
}): Promise<any>;
/**
 * Activity to create a resource (temporary implementation)
 */
export declare function createResourceActivity(data: Record<string, unknown>): Promise<Record<string, unknown>>;
/**
 * Activity to update a resource (temporary implementation)
 */
export declare function updateResourceActivity(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
/**
 * Activity to delete a resource (temporary implementation)
 */
export declare function deleteResourceActivity(id: string): Promise<void>;
