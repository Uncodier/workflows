/**
 * Cron Activities
 * Modular activities for managing cron status records across workflows
 */

import { getSupabaseService } from '../services';

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
export async function saveCronStatusActivity(update: CronStatusUpdate): Promise<void> {
  console.log(`📝 Saving cron status for ${update.activityName} (Site: ${update.siteId})`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️  Database not available, logging to console...');
      logCronStatusUpdate(update);
      return;
    }

    // Prepare cron status record
    const cronStatusRecord = {
      site_id: update.siteId,
      workflow_id: update.workflowId,
      schedule_id: update.scheduleId,
      activity_name: update.activityName,
      status: update.status,
      last_run: update.lastRun || (update.status === 'COMPLETED' || update.status === 'FAILED' ? new Date().toISOString() : null),
      next_run: update.nextRun || null,
      error_message: update.errorMessage || null,
      retry_count: update.retryCount || (update.errorMessage ? 1 : 0)
    };

    // Upsert single cron status record
    await supabaseService.batchUpsertCronStatus([cronStatusRecord]);
    
    console.log(`✅ Successfully saved cron status for ${update.activityName}`);

  } catch (error) {
    console.error(`❌ Error saving cron status for ${update.activityName}:`, error);
    
    // Fallback to console logging if database operations fail
    console.log('⚠️  Database update failed, logging to console...');
    logCronStatusUpdate(update);
  }
}

/**
 * Save or update multiple cron status records in batch
 * This is useful for workflows that need to update multiple sites at once
 */
export async function batchSaveCronStatusActivity(updates: CronStatusUpdate[]): Promise<void> {
  console.log(`📝 Batch saving ${updates.length} cron status records...`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️  Database not available, logging to console...');
      updates.forEach(update => logCronStatusUpdate(update));
      return;
    }

    // Prepare cron status records
    const cronStatusRecords = updates.map(update => ({
      site_id: update.siteId,
      workflow_id: update.workflowId,
      schedule_id: update.scheduleId,
      activity_name: update.activityName,
      status: update.status,
      last_run: update.lastRun || (update.status === 'COMPLETED' || update.status === 'FAILED' ? new Date().toISOString() : null),
      next_run: update.nextRun || null,
      error_message: update.errorMessage || null,
      retry_count: update.retryCount || (update.errorMessage ? 1 : 0)
    }));

    // Batch upsert cron status records
    await supabaseService.batchUpsertCronStatus(cronStatusRecords);
    
    console.log(`✅ Successfully saved ${updates.length} cron status records`);

  } catch (error) {
    console.error('❌ Error in batch save cron status:', error);
    
    // Fallback to console logging if database operations fail
    console.log('⚠️  Database update failed, logging to console...');
    updates.forEach(update => logCronStatusUpdate(update));
  }
}

/**
 * Get cron status for a specific workflow and sites
 * This can be used to check the last run status before scheduling
 */
export async function getCronStatusActivity(
  activityName: string, 
  siteIds: string[]
): Promise<any[]> {
  console.log(`🔍 Fetching cron status for ${activityName} and ${siteIds.length} sites...`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️  Database not available, returning empty results');
      return [];
    }

    const cronData = await supabaseService.fetchCronStatus(activityName, siteIds);
    console.log(`✅ Found ${cronData?.length || 0} cron status records`);
    
    return cronData || [];

  } catch (error) {
    console.error(`❌ Error fetching cron status for ${activityName}:`, error);
    return [];
  }
}

/**
 * Check if a workflow needs to run based on last run time
 * Returns true if the workflow should run (hasn't run in the specified hours)
 */
export async function shouldRunWorkflowActivity(
  activityName: string,
  siteId: string,
  minHoursBetweenRuns: number = 1
): Promise<{ shouldRun: boolean; reason: string; lastRun?: string }> {
  console.log(`🔍 Checking if ${activityName} should run for site ${siteId} (min interval: ${minHoursBetweenRuns}h)`);
  
  try {
    const cronData = await getCronStatusActivity(activityName, [siteId]);
    const siteStatus = cronData.find(record => record.site_id === siteId);
    
    if (!siteStatus) {
      return {
        shouldRun: true,
        reason: 'No previous run found - needs initial scheduling'
      };
    }

    if (!siteStatus.last_run) {
      return {
        shouldRun: true,
        reason: 'Scheduled but never executed - needs to run',
        lastRun: siteStatus.last_run
      };
    }

    const lastRunTime = new Date(siteStatus.last_run);
    const now = new Date();
    const hoursSinceLastRun = (now.getTime() - lastRunTime.getTime()) / (1000 * 60 * 60);
    
    const shouldRun = hoursSinceLastRun >= minHoursBetweenRuns;
    
    return {
      shouldRun,
      reason: shouldRun 
        ? `Last run was ${hoursSinceLastRun.toFixed(1)}h ago - needs to run`
        : `Last run was ${hoursSinceLastRun.toFixed(1)}h ago - too recent`,
      lastRun: siteStatus.last_run
    };

  } catch (error) {
    console.error(`❌ Error checking workflow run status:`, error);
    // Default to should run in case of error
    return {
      shouldRun: true,
      reason: 'Error checking status - defaulting to run'
    };
  }
}

/**
 * Clean stuck RUNNING cron status records automatically
 * This helps prevent the workflow manager from getting confused
 * about what workflows are actually running
 */
export async function cleanStuckRunningStatusActivity(
  hoursThreshold: number = 6
): Promise<{ cleaned: number; errors: string[] }> {
  console.log(`🧹 Auto-cleaning stuck RUNNING cron status records older than ${hoursThreshold} hours...`);
  
  const errors: string[] = [];
  let cleaned = 0;
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️  Database not available for cleanup');
      return { cleaned: 0, errors: ['Database not available'] };
    }

    // Find stuck RUNNING records
    const stuckRecords = await supabaseService.fetchStuckCronStatus(hoursThreshold);
    
    if (!stuckRecords || stuckRecords.length === 0) {
      console.log('✅ No stuck RUNNING records found');
      return { cleaned: 0, errors: [] };
    }

    console.log(`🔧 Found ${stuckRecords.length} stuck records to clean up`);

    // Reset each stuck record to FAILED
    for (const record of stuckRecords) {
      try {
        const updatedAt = new Date(record.updated_at);
        const hoursStuck = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
        
        const errorMessage = `Auto-reset from stuck RUNNING state after ${hoursStuck.toFixed(1)}h by preventive cleanup`;
        await supabaseService.resetCronStatusToFailed(record.id, errorMessage);
        
        console.log(`✅ Auto-cleaned stuck ${record.activity_name} for site ${record.site_id?.substring(0, 8)}...`);
        cleaned++;
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to clean record ${record.id}: ${errorMessage}`);
        errors.push(`Failed to clean ${record.activity_name}: ${errorMessage}`);
      }
    }

    console.log(`🎉 Auto-cleanup completed: ${cleaned} records cleaned, ${errors.length} errors`);
    
    return { cleaned, errors };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error in cleanStuckRunningStatusActivity: ${errorMessage}`);
    errors.push(`Cleanup activity error: ${errorMessage}`);
    
    return { cleaned, errors };
  }
}

/**
 * Comprehensive workflow health check activity
 * Reviews status of all existing workflows and determines if issues need attention
 */
export async function checkWorkflowsHealthActivity(options: {
  businessHoursAnalysis?: any;
  checkTypes?: string[];
}): Promise<{
  healthyWorkflows: number;
  failedWorkflows: number;
  stuckWorkflows: number;
  pendingTasks: number;
  issues: any[];
  recommendations: string[];
  needsAttention: boolean;
}> {
  console.log('🏥 Starting comprehensive workflow health check...');
  
  const { checkTypes = ['daily-standup', 'email-sync', 'lead-generation', 'daily-prospection'] } = options;
  
  let healthyWorkflows = 0;
  let failedWorkflows = 0;
  let stuckWorkflows = 0;
  let pendingTasks = 0;
  const issues: any[] = [];
  const recommendations: string[] = [];

  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️ Database not available for health check');
      issues.push({
        type: 'database-unavailable',
        severity: 'critical',
        description: 'Database connection not available for health monitoring'
      });
      recommendations.push('Check database connectivity and service status');
      return {
        healthyWorkflows: 0,
        failedWorkflows: 1,
        stuckWorkflows: 0,
        pendingTasks: 0,
        issues,
        recommendations,
        needsAttention: true
      };
    }

    // Get all sites for context
    const allSites = await supabaseService.fetchSites();
    console.log(`📊 Monitoring ${allSites.length} sites across ${checkTypes.length} workflow types`);

    // Check each workflow type
    for (const workflowType of checkTypes) {
      console.log(`🔍 Checking ${workflowType} workflows...`);
      
      const cronData = await getCronStatusActivity(workflowType, allSites.map(s => s.id));
      
      for (const site of allSites) {
        const siteStatus = cronData.find(record => record.site_id === site.id);
        
        if (!siteStatus) {
          // No record found - could be a new site or workflow never scheduled
          console.log(`⚠️ No ${workflowType} record found for site ${site.name}`);
          pendingTasks++;
          continue;
        }

        // Check for stuck workflows (running for more than 2 hours)
        if (siteStatus.status === 'RUNNING' && siteStatus.last_run) {
          const lastRunTime = new Date(siteStatus.last_run);
          const hoursRunning = (Date.now() - lastRunTime.getTime()) / (1000 * 60 * 60);
          
          if (hoursRunning > 2) {
            console.log(`🚨 Stuck workflow detected: ${workflowType} for ${site.name} running for ${hoursRunning.toFixed(1)}h`);
            stuckWorkflows++;
            issues.push({
              type: 'stuck-workflow',
              severity: 'warning',
              description: `${workflowType} for ${site.name} has been running for ${hoursRunning.toFixed(1)} hours`,
              siteId: site.id,
              siteName: site.name,
              workflowType,
              hoursRunning: hoursRunning.toFixed(1)
            });
          } else {
            healthyWorkflows++;
          }
        }
        // Check for failed workflows
        else if (siteStatus.status === 'FAILED') {
          console.log(`❌ Failed workflow: ${workflowType} for ${site.name} - ${siteStatus.error_message || 'No error message'}`);
          failedWorkflows++;
          issues.push({
            type: 'failed-workflow',
            severity: 'critical',
            description: `${workflowType} failed for ${site.name}: ${siteStatus.error_message || 'Unknown error'}`,
            siteId: site.id,
            siteName: site.name,
            workflowType,
            errorMessage: siteStatus.error_message
          });
        }
        // Check for overdue workflows (should have run in last 24 hours)
        else if (siteStatus.last_run) {
          const lastRunTime = new Date(siteStatus.last_run);
          const hoursSinceRun = (Date.now() - lastRunTime.getTime()) / (1000 * 60 * 60);
          
          if (hoursSinceRun > 24) {
            console.log(`⏰ Overdue workflow: ${workflowType} for ${site.name} last ran ${hoursSinceRun.toFixed(1)}h ago`);
            issues.push({
              type: 'overdue-workflow',
              severity: 'warning',
              description: `${workflowType} for ${site.name} hasn't run in ${hoursSinceRun.toFixed(1)} hours`,
              siteId: site.id,
              siteName: site.name,
              workflowType,
              hoursSinceRun: hoursSinceRun.toFixed(1)
            });
          } else {
            healthyWorkflows++;
          }
        }
        // Healthy recent completion
        else if (siteStatus.status === 'COMPLETED') {
          healthyWorkflows++;
        }
      }
    }

    // Generate recommendations based on issues
    if (failedWorkflows > 0) {
      recommendations.push(`Investigate ${failedWorkflows} failed workflow(s) and check error logs`);
    }
    if (stuckWorkflows > 0) {
      recommendations.push(`Review ${stuckWorkflows} stuck workflow(s) - consider restarting or increasing timeouts`);
    }
    if (pendingTasks > 0) {
      recommendations.push(`${pendingTasks} workflow(s) have no status records - verify scheduling is working`);
    }
    if (issues.length === 0) {
      recommendations.push('All workflows are operating normally');
    }

    const needsAttention = failedWorkflows > 0 || stuckWorkflows > 3 || issues.length > 5;

    console.log('📊 Health check completed:');
    console.log(`   ✅ Healthy: ${healthyWorkflows}`);
    console.log(`   ❌ Failed: ${failedWorkflows}`);
    console.log(`   🔄 Stuck: ${stuckWorkflows}`);
    console.log(`   ⏳ Pending: ${pendingTasks}`);
    console.log(`   🚨 Issues: ${issues.length}`);
    console.log(`   💡 Needs attention: ${needsAttention ? 'YES' : 'NO'}`);

    return {
      healthyWorkflows,
      failedWorkflows,
      stuckWorkflows,
      pendingTasks,
      issues,
      recommendations,
      needsAttention
    };

  } catch (error) {
    console.error('❌ Error during workflow health check:', error);
    issues.push({
      type: 'health-check-error',
      severity: 'critical',
      description: `Health check failed: ${error instanceof Error ? error.message : String(error)}`
    });
    recommendations.push('Investigate health check system and database connectivity');
    
    return {
      healthyWorkflows: 0,
      failedWorkflows: 1,
      stuckWorkflows: 0,
      pendingTasks: 0,
      issues,
      recommendations,
      needsAttention: true
    };
  }
}

/**
 * Log cron status update to console (fallback method)
 */
function logCronStatusUpdate(update: CronStatusUpdate): void {
  console.log(`📝 [MOCK] Cron status update for ${update.activityName}:`);
  console.log(`   - Site ID: ${update.siteId}`);
  console.log(`   - Workflow ID: ${update.workflowId}`);
  console.log(`   - Schedule ID: ${update.scheduleId}`);
  console.log(`   - Status: ${update.status}`);
  if (update.lastRun) {
    console.log(`   - Last Run: ${update.lastRun}`);
  }
  if (update.nextRun) {
    console.log(`   - Next Run: ${update.nextRun}`);
  }
  if (update.errorMessage) {
    console.log(`   - Error: ${update.errorMessage}`);
  }
  console.log(`   - Retry Count: ${update.retryCount || 0}`);
}

/**
 * Validate and clean stuck cron status for a specific workflow/site before execution
 * This is a general-purpose activity that can be used by any workflow to ensure
 * they don't get blocked by stuck RUNNING records from previous failed executions
 * 
 * @param activityName - Name of the activity to check (e.g., 'dailyStandUpWorkflow')
 * @param siteId - Site ID to check, or 'global' for system-wide workflows
 * @param hoursThreshold - Hours threshold to consider a record stuck (default: 24)
 * @returns Object with validation result and cleanup details
 */
export async function validateAndCleanStuckCronStatusActivity(
  activityName: string,
  siteId: string,
  hoursThreshold: number = 24
): Promise<{
  wasStuck: boolean;
  cleaned: boolean;
  reason: string;
  previousStatus?: string;
  hoursStuck?: number;
  canProceed: boolean;
}> {
  console.log(`🔍 Validating cron status for ${activityName} (Site: ${siteId}, threshold: ${hoursThreshold}h)`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️  Database not available for validation - proceeding optimistically');
      return {
        wasStuck: false,
        cleaned: false,
        reason: 'Database not available - proceeding without validation',
        canProceed: true
      };
    }

    // Get current cron status for this specific activity and site
    const cronData = await getCronStatusActivity(activityName, [siteId]);
    const currentRecord = cronData.find(record => 
      record.site_id === siteId && record.activity_name === activityName
    );

    if (!currentRecord) {
      console.log(`✅ No existing cron record found - safe to proceed`);
      return {
        wasStuck: false,
        cleaned: false,
        reason: 'No existing cron record - first execution',
        canProceed: true
      };
    }

    // Check if the record is in RUNNING state
    if (currentRecord.status !== 'running') {
      console.log(`✅ Current status is '${currentRecord.status}' - safe to proceed`);
      return {
        wasStuck: false,
        cleaned: false,
        reason: `Current status is '${currentRecord.status}' - not stuck`,
        previousStatus: currentRecord.status,
        canProceed: true
      };
    }

    // Calculate how long it's been stuck in RUNNING state
    const updatedAt = new Date(currentRecord.updated_at);
    const now = new Date();
    const hoursStuck = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);

    if (hoursStuck < hoursThreshold) {
      console.log(`⏳ Record is RUNNING but only for ${hoursStuck.toFixed(1)}h - within threshold`);
      return {
        wasStuck: false,
        cleaned: false,
        reason: `RUNNING for ${hoursStuck.toFixed(1)}h - within ${hoursThreshold}h threshold`,
        previousStatus: 'running',
        hoursStuck,
        canProceed: false // Don't proceed if recently started
      };
    }

    // Record is stuck - clean it
    console.log(`🚨 Found stuck RUNNING record - stuck for ${hoursStuck.toFixed(1)}h (threshold: ${hoursThreshold}h)`);
    
    const errorMessage = `Auto-reset from stuck RUNNING state after ${hoursStuck.toFixed(1)}h - exceeded ${hoursThreshold}h threshold`;
    await supabaseService.resetCronStatusToFailed(currentRecord.id, errorMessage);
    
    console.log(`✅ Successfully cleaned stuck record for ${activityName} (Site: ${siteId})`);
    console.log(`   - Was stuck for: ${hoursStuck.toFixed(1)} hours`);
    console.log(`   - Reset to: FAILED`);
    console.log(`   - New execution can proceed`);

    return {
      wasStuck: true,
      cleaned: true,
      reason: `Cleaned stuck RUNNING record (${hoursStuck.toFixed(1)}h > ${hoursThreshold}h threshold)`,
      previousStatus: 'running',
      hoursStuck,
      canProceed: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error in validateAndCleanStuckCronStatusActivity: ${errorMessage}`);
    
    // In case of error, proceed optimistically to avoid blocking legitimate executions
    return {
      wasStuck: false,
      cleaned: false,
      reason: `Error during validation: ${errorMessage} - proceeding optimistically`,
      canProceed: true
    };
  }
} 