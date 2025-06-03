/**
 * Email Sync Activities
 * Activities for managing email synchronization scheduling across multiple sites
 */
import { SiteWithCronStatus, SchedulingOptions } from '../services';
/**
 * Fetch all sites and their last email synchronization cron status
 * Determines which sites need email sync scheduling based on email config and cron status
 */
export declare function fetchSitesActivity(options?: SchedulingOptions): Promise<SiteWithCronStatus[]>;
/**
 * Schedule email sync workflows for the provided sites
 */
export declare function scheduleEmailSyncWorkflowsActivity(sites: SiteWithCronStatus[], options?: SchedulingOptions): Promise<{
    scheduled: number;
    skipped: number;
    errors: string[];
}>;
/**
 * Update cron status for email sync workflows
 */
export declare function updateCronStatusActivity(updates: {
    siteId: string;
    workflowId: string;
    scheduleId: string;
    status: string;
    nextRun?: string;
    errorMessage?: string;
}[]): Promise<void>;
