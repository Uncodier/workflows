/**
 * Workflow Scheduling Activities
 * Activities for programmatically scheduling Temporal workflows
 */
import { SiteWithCronStatus, SchedulingOptions } from '../services';
export interface ScheduleWorkflowResult {
    workflowId: string;
    scheduleId: string;
    success: boolean;
    error?: string;
}
/**
 * Schedule a single email sync workflow for a specific site
 * Uses Temporal client to create actual workflow schedules
 */
export declare function scheduleEmailSyncWorkflowActivity(site: SiteWithCronStatus, options?: SchedulingOptions): Promise<ScheduleWorkflowResult>;
/**
 * Schedule email sync workflows for multiple sites
 * Processes sites in parallel with optimal distribution
 */
export declare function scheduleMultipleEmailSyncWorkflowsActivity(sites: SiteWithCronStatus[], options?: SchedulingOptions): Promise<{
    scheduled: number;
    skipped: number;
    failed: number;
    results: ScheduleWorkflowResult[];
    errors: string[];
}>;
/**
 * Create a recurring email sync schedule for a site
 * This creates a Temporal schedule that runs periodically (e.g., every hour)
 */
export declare function createRecurringEmailSyncScheduleActivity(site: SiteWithCronStatus, cronExpression?: string, // Every hour
options?: SchedulingOptions): Promise<ScheduleWorkflowResult>;
