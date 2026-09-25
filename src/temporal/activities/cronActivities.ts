/**
 * Cron Activities
 * Modular activities for managing cron status records across workflows
 */

import { getSupabaseService } from '../services';
import * as fs from 'fs';
import * as path from 'path';

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
 * Read the cron index file to get the list of workflows that should save cron_status
 * This ensures the code stays in sync with the documentation
 */
function getCronScheduledWorkflows(): string[] {
  try {
    // Get the project root (go up from src/temporal/activities/)
    const projectRoot = path.resolve(__dirname, '../../../');
    const cronIndexPath = path.join(projectRoot, 'docs', 'cron_index.md');
    
    if (!fs.existsSync(cronIndexPath)) {
      console.warn('⚠️ cron_index.md not found, using fallback list');
      return [
        'scheduleActivitiesWorkflow',
        'syncEmailsScheduleWorkflow', 
        'activityPrioritizationEngineWorkflow',
        'dailyOperationsWorkflow',
        'syncEmailsWorkflow'
      ];
    }
    
    const content = fs.readFileSync(cronIndexPath, 'utf-8');
    
    // Extract the list from the markdown using regex
    const listMatch = content.match(/```typescript\s*const CRON_SCHEDULED_WORKFLOWS = \[([\s\S]*?)\];/);
    
    if (!listMatch) {
      console.warn('⚠️ Could not parse CRON_SCHEDULED_WORKFLOWS from cron_index.md, using fallback');
      return [
        'scheduleActivitiesWorkflow',
        'syncEmailsScheduleWorkflow',
        'activityPrioritizationEngineWorkflow', 
        'dailyOperationsWorkflow',
        'syncEmailsWorkflow'
      ];
    }
    
    // Parse the workflow names from the array
    const workflowsText = listMatch[1];
    const workflows = workflowsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith("'") || line.startsWith('"'))
      .map(line => {
        const match = line.match(/['"]([^'"]+)['"]/);
        return match ? match[1] : null;
      })
      .filter(Boolean) as string[];
    
    console.log(`📋 Loaded ${workflows.length} cron-scheduled workflows from cron_index.md`);
    return workflows;
    
  } catch (error) {
    console.error('❌ Error reading cron_index.md:', error);
    console.warn('⚠️ Using fallback list of cron-scheduled workflows');
    return [
      'scheduleActivitiesWorkflow',
      'syncEmailsScheduleWorkflow',
      'activityPrioritizationEngineWorkflow',
      'dailyOperationsWorkflow', 
      'syncEmailsWorkflow'
    ];
  }
}

/**
 * Workflows that are actually executed by cron schedules
 * This list is dynamically loaded from docs/cron_index.md
 * Cached to avoid multiple file reads
 */
let CRON_SCHEDULED_WORKFLOWS: string[] | null = null;

function getCronScheduledWorkflowsList(): string[] {
  if (CRON_SCHEDULED_WORKFLOWS === null) {
    CRON_SCHEDULED_WORKFLOWS = getCronScheduledWorkflows();
    console.log(`📋 Loaded ${CRON_SCHEDULED_WORKFLOWS.length} cron-scheduled workflows: ${CRON_SCHEDULED_WORKFLOWS.join(', ')}`);
  }
  return CRON_SCHEDULED_WORKFLOWS;
}

/**
 * Check if a workflow should save cron status based on whether it's actually scheduled by cron
 * @param activityName - The name of the workflow/activity
 * @param scheduleId - The schedule ID (if 'manual-execution', it's not a cron job)
 * @returns boolean indicating if cron status should be saved
 */
function shouldSaveCronStatus(activityName: string, scheduleId: string): boolean {
  // If it's a manual execution, never save cron status
  if (scheduleId === 'manual-execution') {
    return false;
  }
  
  // Only save cron status for workflows that are actually scheduled by cron
  return getCronScheduledWorkflowsList().includes(activityName);
}

/**
 * Save or update a single cron status record
 * This is a modular activity that can be used by multiple workflows
 * Only saves to database if the workflow is actually executed by cron schedules
 */
export async function saveCronStatusActivity(update: CronStatusUpdate): Promise<void> {
  console.log(`📝 Checking if should save cron status for ${update.activityName} (Site: ${update.siteId})`);
  
  // Check if this workflow should save cron status
  if (!shouldSaveCronStatus(update.activityName, update.scheduleId)) {
    console.log(`⏭️  Skipping cron status save for ${update.activityName} - not a cron-scheduled workflow (scheduleId: ${update.scheduleId})`);
    console.log(`📋 Cron-scheduled workflows: ${getCronScheduledWorkflowsList().join(', ')}`);
    return;
  }
  
  console.log(`✅ ${update.activityName} is cron-scheduled - proceeding with cron status save`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      throw new Error('Database not available');
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
    throw error;
  }
}

/**
 * Save or update multiple cron status records in batch
 * This is useful for workflows that need to update multiple sites at once
 * Only saves records for workflows that are actually executed by cron schedules
 */
export async function batchSaveCronStatusActivity(updates: CronStatusUpdate[]): Promise<void> {
  console.log(`📝 Batch processing ${updates.length} cron status records...`);
  
  // Filter updates to only include cron-scheduled workflows
  const validUpdates = updates.filter(update => {
    const shouldSave = shouldSaveCronStatus(update.activityName, update.scheduleId);
    if (!shouldSave) {
      console.log(`⏭️  Skipping batch cron status save for ${update.activityName} - not a cron-scheduled workflow`);
    }
    return shouldSave;
  });
  
  if (validUpdates.length === 0) {
    console.log(`⏭️  No valid cron-scheduled workflows found in batch - skipping all saves`);
    console.log(`📋 Cron-scheduled workflows: ${getCronScheduledWorkflowsList().join(', ')}`);
    return;
  }
  
  console.log(`✅ ${validUpdates.length}/${updates.length} records are for cron-scheduled workflows - proceeding with batch save`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      throw new Error('Database not available');
    }

    // Prepare cron status records
    const cronStatusRecords = validUpdates.map(update => ({
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
    
    console.log(`✅ Successfully saved ${validUpdates.length} cron status records`);

  } catch (error) {
    console.error('❌ Error in batch save cron status:', error);
    throw error;
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
      throw new Error('Database not available');
    }

    const cronData = await supabaseService.fetchCronStatus(activityName, siteIds);
    console.log(`✅ Found ${cronData?.length || 0} cron status records`);
    
    return cronData || [];

  } catch (error) {
    console.error(`❌ Error fetching cron status for ${activityName}:`, error);
    throw error;
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
    return {
      shouldRun: false,
      reason: 'Unable to verify the last run - deferring execution'
    };
  }
}

export {
  checkWorkflowsHealthActivity,
  cleanStuckRunningStatusActivity,
  validateAndCleanStuckCronStatusActivity,
} from './cronMaintenanceActivities';