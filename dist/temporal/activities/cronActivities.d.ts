/**
 * Cron Activities
 * Modular activities for managing cron status records across workflows
 */
export interface CronStatusUpdate {
    siteId: string;
    workflowId: string;
    scheduleId: string;
    activityName: string;
    status: string;
    lastRun?: string | null;
    nextRun?: string | null;
    errorMessage?: string | null;
    retryCount?: number;
}
/**
 * Save or update a single cron status record
 * This is a modular activity that can be used by multiple workflows
 */
export declare function saveCronStatusActivity(update: CronStatusUpdate): Promise<void>;
/**
 * Save or update multiple cron status records in batch
 * This is useful for workflows that need to update multiple sites at once
 */
export declare function batchSaveCronStatusActivity(updates: CronStatusUpdate[]): Promise<void>;
/**
 * Get cron status for a specific workflow and sites
 * This can be used to check the last run status before scheduling
 */
export declare function getCronStatusActivity(activityName: string, siteIds: string[]): Promise<any[]>;
/**
 * Check if a workflow needs to run based on last run time
 * Returns true if the workflow should run (hasn't run in the specified hours)
 */
export declare function shouldRunWorkflowActivity(activityName: string, siteId: string, minHoursBetweenRuns?: number): Promise<{
    shouldRun: boolean;
    reason: string;
    lastRun?: string;
}>;
