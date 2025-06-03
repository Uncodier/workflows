/**
 * Email Sync Scheduling Service
 * Service for handling email sync workflow scheduling logic
 */
import { Site, CronStatus } from './mockDataService';
export interface SiteWithCronStatus extends Site {
    lastEmailSync?: CronStatus;
    shouldSchedule: boolean;
    reason: string;
    hasValidEmailConfig: boolean;
}
export interface SchedulingOptions {
    forceScheduleAll?: boolean;
    maxSitesToSchedule?: number;
    dryRun?: boolean;
    minHoursBetweenSyncs?: number;
    maxRetryCount?: number;
}
export interface SchedulingResult {
    scheduled: number;
    skipped: number;
    errors: string[];
    sitesProcessed: SiteWithCronStatus[];
}
export declare class EmailSyncSchedulingService {
    private static readonly DEFAULT_MIN_HOURS_BETWEEN_SYNCS;
    private static readonly DEFAULT_MAX_RETRY_COUNT;
    private static readonly RETRY_DELAY_MINUTES;
    /**
     * Determine if a site should be scheduled for email sync
     */
    static determineSiteScheduling(site: Site, lastEmailSync?: CronStatus, options?: SchedulingOptions): {
        shouldSchedule: boolean;
        reason: string;
        hasValidEmailConfig: boolean;
    };
    /**
     * Process sites and determine which ones need scheduling
     */
    static processSitesForScheduling(sites: Site[], cronStatuses: CronStatus[], options?: SchedulingOptions): SiteWithCronStatus[];
    /**
     * Generate workflow and schedule IDs for a site
     */
    static generateWorkflowIds(siteId: string): {
        workflowId: string;
        scheduleId: string;
    };
    /**
     * Calculate next run time for a scheduled workflow
     */
    static calculateNextRunTime(intervalHours?: number): string;
    /**
     * Get scheduling statistics
     */
    static getSchedulingStatistics(sitesWithStatus: SiteWithCronStatus[]): {
        totalSites: number;
        sitesWithValidConfig: number;
        sitesNeedingSync: number;
        sitesByStatus: Record<string, number>;
        sitesByProvider: Record<string, number>;
    };
    /**
     * Log detailed scheduling analysis
     */
    static logSchedulingAnalysis(sitesWithStatus: SiteWithCronStatus[], options?: SchedulingOptions): void;
    /**
     * Validate scheduling options
     */
    static validateSchedulingOptions(options: SchedulingOptions): {
        isValid: boolean;
        errors: string[];
    };
}
