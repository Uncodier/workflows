/**
 * Activity to fetch data from the API
 */
export declare function fetchDataActivity(resourceId: string): Promise<any>;
/**
 * Activity to create a resource via the API
 */
export declare function createApiResourceActivity(data: any): Promise<any>;
/**
 * Activity to update a resource via the API
 */
export declare function updateApiResourceActivity(resourceId: string, data: any): Promise<any>;
/**
 * Activity to delete a resource via the API
 */
export declare function deleteApiResourceActivity(resourceId: string): Promise<any>;
