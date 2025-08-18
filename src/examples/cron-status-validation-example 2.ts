#!/usr/bin/env ts-node
/**
 * Example: How to use validateAndCleanStuckCronStatusActivity
 * 
 * This activity can be used by any workflow to ensure they don't get blocked
 * by stuck RUNNING records from previous failed executions.
 */

import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../temporal/activities';

// Example of how to set up the activity in any workflow
const { 
  validateAndCleanStuckCronStatusActivity,
  saveCronStatusActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
});

/**
 * Example 1: Daily Standup Workflow with Cron Validation
 */
export async function exampleDailyStandupWithValidation(
  options: { site_id: string; user_id: string }
): Promise<{ executed: boolean; reason: string }> {
  const { site_id } = options;
  const workflowId = `daily-standup-${site_id}`;

  try {
    // 🔍 STEP 1: Validate cron status before execution
    console.log('🔍 Validating cron status before daily standup...');
    
    const cronValidation = await validateAndCleanStuckCronStatusActivity(
      'dailyStandUpWorkflow',
      site_id,
      24 // 24 hours threshold
    );
    
    console.log(`📋 Validation result: ${cronValidation.reason}`);
    
    if (cronValidation.wasStuck) {
      console.log(`🧹 Cleaned stuck record that was ${cronValidation.hoursStuck?.toFixed(1)}h old`);
    }
    
    if (!cronValidation.canProceed) {
      return {
        executed: false,
        reason: `Workflow blocked: ${cronValidation.reason}`
      };
    }

    // 🚀 STEP 2: Mark as RUNNING and proceed with execution
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `daily-standup-${site_id}`,
      activityName: 'dailyStandUpWorkflow',
      status: 'RUNNING',
      lastRun: new Date().toISOString()
    });

    // ... Execute your workflow logic here ...
    console.log('✅ Daily standup workflow completed successfully');

    // 🎯 STEP 3: Mark as COMPLETED
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `daily-standup-${site_id}`,
      activityName: 'dailyStandUpWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    return {
      executed: true,
      reason: 'Daily standup completed successfully'
    };

  } catch (error) {
    // 💥 STEP 4: Mark as FAILED on error
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `daily-standup-${site_id}`,
      activityName: 'dailyStandUpWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage
    });

    throw error;
  }
}

/**
 * Example 2: Email Sync Workflow with Custom Threshold
 */
export async function exampleEmailSyncWithValidation(
  options: { site_id: string; provider: string }
): Promise<{ executed: boolean; reason: string }> {
  const { site_id } = options;

  // 🔍 Use shorter threshold for email sync (12 hours)
  const cronValidation = await validateAndCleanStuckCronStatusActivity(
    'syncEmailsWorkflow',
    site_id,
    12 // 12 hours threshold for email sync
  );

  if (!cronValidation.canProceed) {
    return {
      executed: false,
      reason: `Email sync blocked: ${cronValidation.reason}`
    };
  }

  // ... Continue with email sync logic ...
  return {
    executed: true,
    reason: 'Email sync completed'
  };
}

/**
 * Example 3: Global System Workflow with Validation
 */
export async function exampleSystemMaintenanceWithValidation(): Promise<{
  executed: boolean;
  reason: string;
}> {
  // 🔍 For global workflows, use 'global' as siteId
  const cronValidation = await validateAndCleanStuckCronStatusActivity(
    'systemMaintenanceWorkflow',
    'global', // Global workflow
    48 // 48 hours threshold for system maintenance
  );

  if (!cronValidation.canProceed) {
    return {
      executed: false,
      reason: `System maintenance blocked: ${cronValidation.reason}`
    };
  }

  // ... Continue with system maintenance logic ...
  return {
    executed: true,
    reason: 'System maintenance completed'
  };
}

/**
 * Example 4: Usage with Custom Validation Logic
 */
export async function exampleWithCustomValidation(
  options: { site_id: string; force?: boolean }
): Promise<{ executed: boolean; reason: string }> {
  const { site_id, force = false } = options;

  if (!force) {
    // 🔍 Standard validation
    const cronValidation = await validateAndCleanStuckCronStatusActivity(
      'customWorkflow',
      site_id,
      6 // 6 hours threshold
    );

    if (!cronValidation.canProceed) {
      console.log('⏸️ Workflow execution blocked by cron validation');
      return {
        executed: false,
        reason: cronValidation.reason
      };
    }

    if (cronValidation.wasStuck) {
      console.log('🧹 Previous execution was cleaned up - proceeding safely');
    }
  } else {
    console.log('🚨 Force mode enabled - skipping cron validation');
  }

  // ... Continue with workflow logic ...
  return {
    executed: true,
    reason: 'Custom workflow completed'
  };
}

/**
 * Usage Patterns Summary:
 * 
 * 1. **Standard Pattern** (Most Common):
 *    - Call validateAndCleanStuckCronStatusActivity at the start
 *    - Check canProceed flag
 *    - Mark as RUNNING, execute logic, mark as COMPLETED/FAILED
 * 
 * 2. **Threshold Guidelines**:
 *    - Fast workflows (email sync): 6-12 hours
 *    - Daily workflows: 24 hours  
 *    - System workflows: 48+ hours
 * 
 * 3. **Site ID Guidelines**:
 *    - Site-specific workflows: actual site_id
 *    - Global/system workflows: 'global'
 * 
 * 4. **Error Handling**:
 *    - Always mark as FAILED in catch blocks
 *    - Activity proceeds optimistically if database unavailable
 * 
 * 5. **Force Mode**:
 *    - Some workflows may need option to skip validation
 *    - Use sparingly and with caution
 */

const examples = {
  exampleDailyStandupWithValidation,
  exampleEmailSyncWithValidation,
  exampleSystemMaintenanceWithValidation,
  exampleWithCustomValidation
};

export default examples;