"use strict";
/**
 * Email Sync Scheduling Service
 * Service for handling email sync workflow scheduling logic
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailSyncSchedulingService = void 0;
const emailConfigService_1 = require("./emailConfigService");
class EmailSyncSchedulingService {
    static DEFAULT_MIN_HOURS_BETWEEN_SYNCS = 3;
    static DEFAULT_MAX_RETRY_COUNT = 3;
    static RETRY_DELAY_MINUTES = 15; // Retry failed syncs after 15 minutes
    /**
     * Determine if a site should be scheduled for email sync
     */
    static determineSiteScheduling(site, lastEmailSync, options = {}) {
        const minHours = options.minHoursBetweenSyncs || this.DEFAULT_MIN_HOURS_BETWEEN_SYNCS;
        const maxRetries = options.maxRetryCount || this.DEFAULT_MAX_RETRY_COUNT;
        // Validate email configuration
        const emailValidation = emailConfigService_1.EmailConfigService.validateEmailConfig(site.email);
        const hasValidEmailConfig = emailValidation.isValid;
        let shouldSchedule = false;
        let reason = '';
        // Force schedule all if requested (and email config is valid)
        if (options.forceScheduleAll && hasValidEmailConfig) {
            shouldSchedule = true;
            reason = 'Force schedule all enabled - scheduling regardless of status';
            return { shouldSchedule, reason, hasValidEmailConfig };
        }
        if (!hasValidEmailConfig) {
            shouldSchedule = false;
            reason = `Email config invalid: ${emailValidation.reason}`;
        }
        else if (!lastEmailSync) {
            shouldSchedule = true;
            reason = 'No previous email sync found - needs initial scheduling';
        }
        else {
            // Check status and timing
            const now = Date.now();
            switch (lastEmailSync.status) {
                case 'FAILED':
                    if (lastEmailSync.retry_count >= maxRetries) {
                        shouldSchedule = true;
                        reason = `Previous sync failed with ${lastEmailSync.retry_count} retries (max: ${maxRetries}) - needs rescheduling`;
                    }
                    else {
                        // For failed syncs, use a shorter retry delay (15 minutes) instead of full minHours
                        const lastRunTime = lastEmailSync.last_run ? new Date(lastEmailSync.last_run).getTime() : 0;
                        const minutesSinceLastRun = (now - lastRunTime) / (1000 * 60);
                        const hoursSinceLastRun = minutesSinceLastRun / 60;
                        if (minutesSinceLastRun >= this.RETRY_DELAY_MINUTES) {
                            shouldSchedule = true;
                            reason = `Failed sync ${hoursSinceLastRun.toFixed(1)}h ago (retry ${lastEmailSync.retry_count}/${maxRetries}) - ready for retry`;
                        }
                        else {
                            const minutesUntilRetry = this.RETRY_DELAY_MINUTES - minutesSinceLastRun;
                            reason = `Failed sync ${hoursSinceLastRun.toFixed(1)}h ago (retry ${lastEmailSync.retry_count}/${maxRetries}) - waiting ${minutesUntilRetry.toFixed(0)}min before retry`;
                        }
                    }
                    break;
                case 'COMPLETED':
                    const lastRunTime = new Date(lastEmailSync.last_run).getTime();
                    const hoursSinceLastRun = (now - lastRunTime) / (1000 * 60 * 60);
                    if (hoursSinceLastRun >= minHours) {
                        shouldSchedule = true;
                        reason = `Last sync was ${hoursSinceLastRun.toFixed(1)} hours ago (min: ${minHours}h) - needs new sync`;
                    }
                    else {
                        // Allow scheduling even if recent - scheduler will handle timing
                        shouldSchedule = true;
                        reason = `Last sync was ${hoursSinceLastRun.toFixed(1)} hours ago (min: ${minHours}h) - scheduler will handle timing`;
                    }
                    break;
                case 'RUNNING':
                    // Check if the running status is stale (workflow scheduler handles timing)
                    // If it's been running for more than 2 hours, it's likely stuck
                    const runningTime = lastEmailSync.last_run ? new Date(lastEmailSync.last_run).getTime() :
                        lastEmailSync.created_at ? new Date(lastEmailSync.created_at).getTime() : now;
                    const hoursRunning = (now - runningTime) / (1000 * 60 * 60);
                    if (hoursRunning >= 2) {
                        shouldSchedule = true;
                        reason = `Email sync marked as running for ${hoursRunning.toFixed(1)}h - likely stuck, rescheduling`;
                    }
                    else {
                        // Let the scheduler handle timing - don't block based on RUNNING status alone
                        shouldSchedule = true;
                        reason = 'Email sync marked as running but scheduler will handle timing - allowing schedule';
                    }
                    break;
                case 'SCHEDULED':
                    // Check if scheduled workflow should have run by now or is stuck
                    if (lastEmailSync.next_run) {
                        const nextRunTime = new Date(lastEmailSync.next_run).getTime();
                        const hoursUntilRun = (nextRunTime - now) / (1000 * 60 * 60);
                        if (hoursUntilRun <= 0) {
                            // Scheduled run time has passed, might be stuck
                            shouldSchedule = true;
                            reason = `Scheduled run was ${Math.abs(hoursUntilRun).toFixed(1)}h ago but didn't execute - rescheduling`;
                        }
                        else if (hoursUntilRun > minHours * 2) {
                            // Next run is too far away, reschedule for sooner
                            shouldSchedule = true;
                            reason = `Next scheduled run is ${hoursUntilRun.toFixed(1)}h away (too distant) - rescheduling for sooner`;
                        }
                        else {
                            // Check if it was scheduled long ago but never executed
                            if (!lastEmailSync.last_run && lastEmailSync.created_at) {
                                const scheduledTime = new Date(lastEmailSync.created_at).getTime();
                                const hoursSinceScheduled = (now - scheduledTime) / (1000 * 60 * 60);
                                if (hoursSinceScheduled >= minHours) {
                                    shouldSchedule = true;
                                    reason = `Scheduled ${hoursSinceScheduled.toFixed(1)}h ago but never executed - rescheduling`;
                                }
                                else {
                                    reason = `Email sync scheduled to run in ${hoursUntilRun.toFixed(1)}h - waiting`;
                                }
                            }
                            else {
                                reason = `Email sync scheduled to run in ${hoursUntilRun.toFixed(1)}h - waiting`;
                            }
                        }
                    }
                    else {
                        // Scheduled but no next_run time, definitely stuck
                        shouldSchedule = true;
                        reason = 'Email sync scheduled but no run time set - rescheduling';
                    }
                    // Additional check: if scheduled but never ran and enough time has passed since creation
                    if (!shouldSchedule && !lastEmailSync.last_run && lastEmailSync.created_at) {
                        const scheduledTime = new Date(lastEmailSync.created_at).getTime();
                        const hoursSinceScheduled = (now - scheduledTime) / (1000 * 60 * 60);
                        if (hoursSinceScheduled >= minHours) {
                            shouldSchedule = true;
                            reason = `Scheduled ${hoursSinceScheduled.toFixed(1)}h ago but never executed - likely stuck, rescheduling`;
                        }
                    }
                    break;
                default:
                    shouldSchedule = true;
                    reason = `Status: ${lastEmailSync.status} - needs attention`;
            }
        }
        return { shouldSchedule, reason, hasValidEmailConfig };
    }
    /**
     * Process sites and determine which ones need scheduling
     */
    static processSitesForScheduling(sites, cronStatuses, options = {}) {
        const sitesWithStatus = sites.map(site => {
            const lastEmailSync = cronStatuses.find(cron => cron.site_id === site.id);
            // Validate email configuration and determine scheduling
            const { shouldSchedule, reason, hasValidEmailConfig } = this.determineSiteScheduling(site, lastEmailSync, options);
            return {
                ...site,
                lastEmailSync,
                shouldSchedule,
                reason,
                hasValidEmailConfig
            };
        });
        // Apply max sites limit if specified
        if (options.maxSitesToSchedule && options.maxSitesToSchedule > 0) {
            const sitesToSchedule = sitesWithStatus.filter(site => site.shouldSchedule);
            if (sitesToSchedule.length > options.maxSitesToSchedule) {
                // Sort by priority (failed syncs first, then by last run time)
                sitesToSchedule.sort((a, b) => {
                    // Failed syncs have highest priority
                    if (a.lastEmailSync?.status === 'FAILED' && b.lastEmailSync?.status !== 'FAILED')
                        return -1;
                    if (b.lastEmailSync?.status === 'FAILED' && a.lastEmailSync?.status !== 'FAILED')
                        return 1;
                    // Then by last run time (oldest first)
                    const aLastRun = a.lastEmailSync?.last_run ? new Date(a.lastEmailSync.last_run).getTime() : 0;
                    const bLastRun = b.lastEmailSync?.last_run ? new Date(b.lastEmailSync.last_run).getTime() : 0;
                    return aLastRun - bLastRun;
                });
                // Mark excess sites as skipped
                for (let i = options.maxSitesToSchedule; i < sitesToSchedule.length; i++) {
                    const site = sitesToSchedule[i];
                    const originalSite = sitesWithStatus.find(s => s.id === site.id);
                    if (originalSite) {
                        originalSite.shouldSchedule = false;
                        originalSite.reason = `Skipped due to max sites limit (${options.maxSitesToSchedule})`;
                    }
                }
            }
        }
        return sitesWithStatus;
    }
    /**
     * Generate workflow and schedule IDs for a site
     */
    static generateWorkflowIds(siteId) {
        const timestamp = Date.now();
        return {
            workflowId: `sync-emails-${siteId}-${timestamp}`,
            scheduleId: `email-sync-${siteId}`
        };
    }
    /**
     * Calculate next run time for a scheduled workflow
     */
    static calculateNextRunTime(intervalHours = 3) {
        return new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();
    }
    /**
     * Get scheduling statistics
     */
    static getSchedulingStatistics(sitesWithStatus) {
        const totalSites = sitesWithStatus.length;
        const sitesWithValidConfig = sitesWithStatus.filter(site => site.hasValidEmailConfig).length;
        const sitesNeedingSync = sitesWithStatus.filter(site => site.shouldSchedule).length;
        // Count sites by status
        const sitesByStatus = {};
        sitesWithStatus.forEach(site => {
            const status = site.lastEmailSync?.status || 'NO_SYNC';
            sitesByStatus[status] = (sitesByStatus[status] || 0) + 1;
        });
        // Count sites by email provider
        const sitesByProvider = {};
        sitesWithStatus
            .filter(site => site.hasValidEmailConfig && site.email)
            .forEach(site => {
            const provider = emailConfigService_1.EmailConfigService.getEmailProvider(site.email);
            sitesByProvider[provider] = (sitesByProvider[provider] || 0) + 1;
        });
        return {
            totalSites,
            sitesWithValidConfig,
            sitesNeedingSync,
            sitesByStatus,
            sitesByProvider
        };
    }
    /**
     * Log detailed scheduling analysis
     */
    static logSchedulingAnalysis(sitesWithStatus, options = {}) {
        const stats = this.getSchedulingStatistics(sitesWithStatus);
        console.log(`📊 Email Sync Scheduling Analysis:`);
        console.log(`   - Total Sites: ${stats.totalSites}`);
        console.log(`   - Sites with Valid Email Config: ${stats.sitesWithValidConfig}`);
        console.log(`   - Sites Needing Sync: ${stats.sitesNeedingSync}`);
        if (options.maxSitesToSchedule) {
            console.log(`   - Max Sites Limit: ${options.maxSitesToSchedule}`);
        }
        if (options.dryRun) {
            console.log(`   - Mode: DRY RUN (no actual scheduling)`);
        }
        console.log(`\n📈 Sites by Status:`);
        Object.entries(stats.sitesByStatus).forEach(([status, count]) => {
            console.log(`   - ${status}: ${count}`);
        });
        if (Object.keys(stats.sitesByProvider).length > 0) {
            console.log(`\n📧 Sites by Email Provider:`);
            Object.entries(stats.sitesByProvider).forEach(([provider, count]) => {
                console.log(`   - ${provider}: ${count}`);
            });
        }
        console.log(`\n📋 Site Details:`);
        sitesWithStatus.forEach(site => {
            const configStatus = site.hasValidEmailConfig ? '📧' : '❌';
            const scheduleStatus = site.shouldSchedule ? '🔄' : '✅';
            console.log(`   ${configStatus}${scheduleStatus} ${site.name} (${site.id}): ${site.reason}`);
            if (site.hasValidEmailConfig && site.email) {
                const maskedConfig = emailConfigService_1.EmailConfigService.maskSensitiveInfo(site.email);
                const provider = emailConfigService_1.EmailConfigService.getEmailProvider(site.email);
                console.log(`      📧 Email: ${maskedConfig.email} | Server: ${maskedConfig.incomingServer} | Provider: ${provider}`);
            }
            if (site.lastEmailSync) {
                const lastRun = site.lastEmailSync.last_run
                    ? new Date(site.lastEmailSync.last_run).toLocaleString()
                    : 'Never';
                console.log(`      🕒 Last Run: ${lastRun} | Status: ${site.lastEmailSync.status} | Retries: ${site.lastEmailSync.retry_count}`);
            }
        });
    }
    /**
     * Validate scheduling options
     */
    static validateSchedulingOptions(options) {
        const errors = [];
        if (options.maxSitesToSchedule !== undefined && options.maxSitesToSchedule < 0) {
            errors.push('maxSitesToSchedule must be a positive number');
        }
        if (options.minHoursBetweenSyncs !== undefined && options.minHoursBetweenSyncs < 0) {
            errors.push('minHoursBetweenSyncs must be a positive number');
        }
        if (options.maxRetryCount !== undefined && options.maxRetryCount < 0) {
            errors.push('maxRetryCount must be a positive number');
        }
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
exports.EmailSyncSchedulingService = EmailSyncSchedulingService;
