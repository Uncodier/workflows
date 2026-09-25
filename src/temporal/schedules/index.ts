import { temporalConfig } from '../../config/config';
import { WorkflowType, workflowNames } from '../workflows';
import { createTemporalConnection, withTimeout } from './connection';

// Define specific argument types for each workflow
type WorkflowArgs = {
  scheduleActivitiesWorkflow: [];
  syncEmailsWorkflow: [];
  syncEmailsScheduleWorkflow: [];
  sendApprovedMessagesWorkflow: [];
  dailyCreditRenewalWorkflow: [];
  processReservationsWorkflow: [];
  processSubscriptionsWorkflow: [];
  processTasksWorkflow: [];
  pollSocialCommentsWorkflow: [];
  pollSocialAnalyticsWorkflow: [];
};

export interface ScheduleSpec {
  id: string;
  workflowType: WorkflowType;
  intervalMinutes?: number; // Optional when using cron
  args?: WorkflowArgs[keyof WorkflowArgs];
  description?: string;
  startAt?: Date;
  endAt?: Date;
  jitterMs?: number;
  pauseOnFailure?: boolean;
  catchupWindow?: string;
  paused?: boolean;
  cron?: string; // Alternative to intervalMinutes
  timezone?: string;
  /** Overlap policy: SKIP = do not start if previous run still active; ALLOW = start every tick (each run works its own batch) */
  overlap?: 'SKIP' | 'ALLOW';
}

// Central schedule that manages all other workflows
export const defaultSchedules: ScheduleSpec[] = [
  {
    id: 'central-schedule-activities',
    workflowType: 'scheduleActivitiesWorkflow',
    intervalMinutes: 24 * 60, // Every 24 hours - business hours logic handled inside workflow
    args: [],
    description: 'Central schedule that runs every 24 hours and uses business_hours to determine optimal scheduling',
    startAt: new Date(),
    jitterMs: 30000, // 30 seconds jitter
    pauseOnFailure: false,
    catchupWindow: '3h', // 3 hour catchup window - extendido para mejor recuperación
    paused: false
  },
  {
    id: 'sync-emails-schedule-manager',
    workflowType: 'syncEmailsScheduleWorkflow',
    intervalMinutes: 60, // Every 60 minutes (1 hour)
    args: [],
    description: 'Schedule email sync workflows for all sites every hour',
    startAt: new Date(), // Start immediately
    jitterMs: 60000, // 1 minute jitter to spread load
    pauseOnFailure: false,
    catchupWindow: '2h', // 2 hour catchup window
    paused: false
  },
  {
    id: 'send-approved-messages-schedule',
    workflowType: 'sendApprovedMessagesWorkflow',
    intervalMinutes: 60, // Every 60 minutes (1 hour)
    args: [],
    description: 'Check for and send approved messages every hour without overlapping runs',
    startAt: new Date(), // Start immediately
    jitterMs: 60000, // 1 minute jitter
    pauseOnFailure: false,
    catchupWindow: '1h',
    paused: false,
    overlap: 'SKIP' as const,
  },
  {
    id: 'daily-credit-renewal',
    workflowType: 'dailyCreditRenewalWorkflow',
    intervalMinutes: 24 * 60, // Every 24 hours
    args: [],
    description: 'Daily workflow to renew site credits based on billing cycle',
    startAt: new Date(),
    jitterMs: 60000,
    pauseOnFailure: false,
    catchupWindow: '12h',
    paused: false
  },
  {
    id: 'process-reservations-schedule',
    workflowType: 'processReservationsWorkflow',
    intervalMinutes: 15, // Every 15 minutes
    args: [],
    description: 'Periodically check and process upcoming reservation notifications',
    startAt: new Date(),
    jitterMs: 15000,
    pauseOnFailure: false,
    catchupWindow: '1h',
    paused: false
  },
  {
    id: 'process-subscriptions-schedule',
    workflowType: 'processSubscriptionsWorkflow',
    intervalMinutes: 24 * 60, // Every 24 hours
    args: [],
    description: 'Daily workflow to process subscription renewals',
    startAt: new Date(),
    jitterMs: 60000,
    pauseOnFailure: false,
    catchupWindow: '12h',
    paused: false
  },
  {
    id: 'process-tasks-schedule',
    workflowType: 'processTasksWorkflow',
    intervalMinutes: 15, // Every 15 minutes
    args: [],
    description: 'Polls for upcoming tasks to send reminders',
    startAt: new Date(),
    jitterMs: 15000,
    pauseOnFailure: false,
    catchupWindow: '1h',
    paused: false
  },
  {
    id: 'poll-social-comments-schedule',
    workflowType: 'pollSocialCommentsWorkflow',
    intervalMinutes: 5,
    args: [],
    description: 'Poll social comment networks for new replies and ingest them into conversations',
    startAt: new Date(),
    jitterMs: 30000,
    pauseOnFailure: false,
    catchupWindow: '15m',
    paused: false,
    overlap: 'SKIP',
  },
  {
    id: 'poll-social-analytics-schedule',
    workflowType: 'pollSocialAnalyticsWorkflow',
    intervalMinutes: 60, // Every hour
    args: [],
    description: 'Polls for social performance analytics every hour',
    startAt: new Date(),
    jitterMs: 60000,
    pauseOnFailure: false,
    catchupWindow: '2h',
    paused: false,
    overlap: 'SKIP',
  }
];

// Retry wrapper
async function withRetry<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 3, 
  delayMs: number = 1000,
  operationName: string = 'operation'
): Promise<T> {
  let lastError: Error = new Error('No attempts made');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries} for ${operationName}`);
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.log(`❌ Attempt ${attempt} failed: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        console.log(`⏳ Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 1.5; // Exponential backoff
      }
    }
  }
  
  throw new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

function buildScheduleOptions(
  spec: ScheduleSpec,
  overlapPolicies: { ALLOW_ALL: unknown; SKIP: unknown },
  workflowId = `${spec.id}-${Date.now()}`
) {
  const scheduleSpec = spec.cron
    ? {
        cronExpressions: [spec.cron],
        timezone: spec.timezone || 'UTC',
        ...(spec.startAt ? { startAt: spec.startAt } : {}),
        ...(spec.endAt ? { endAt: spec.endAt } : {}),
      }
    : {
        intervals: [{
          every: `${spec.intervalMinutes || 30}m`,
          offset: '0s',
        }],
        startAt: spec.startAt || new Date(),
        endAt: spec.endAt || undefined,
        jitter: spec.jitterMs ? `${spec.jitterMs}ms` : '30s',
        timezone: spec.timezone || 'UTC',
      };

  return {
    scheduleId: spec.id,
    action: {
      type: 'startWorkflow',
      workflowType: workflowNames[spec.workflowType],
      taskQueue: temporalConfig.taskQueue,
      args: spec.args || [],
      workflowId,
    },
    spec: scheduleSpec,
    policies: {
      catchupWindow: spec.catchupWindow || '1h',
      overlap: spec.overlap === 'ALLOW'
        ? overlapPolicies.ALLOW_ALL
        : overlapPolicies.SKIP,
      pauseOnFailure: spec.pauseOnFailure ?? false,
    },
    state: {
      note: `Managed schedule: ${spec.id}`,
      paused: spec.paused || false,
    },
  } as any;
}

export async function createSchedule(spec: ScheduleSpec) {
  console.log(`📅 Creating schedule: ${spec.id}`);
  
  return await withRetry(async () => {
    const { ScheduleClient, ScheduleOverlapPolicy } = require('@temporalio/client');
    
    console.log(`🔗 Establishing connection for ${spec.id}...`);
    const connection = await createTemporalConnection();
    
    console.log(`📋 Creating schedule client for ${spec.id}...`);
    const client = new ScheduleClient({
      connection,
      namespace: temporalConfig.namespace,
    });
    const scheduleOptions = buildScheduleOptions(spec, ScheduleOverlapPolicy);

    // First, check if the schedule already exists
    try {
      console.log(`🔍 Checking if schedule ${spec.id} already exists...`);
      const handle = client.getHandle(spec.id);
      const description = await handle.describe();
      
      const currentSchedule = description;
      const updatedOptions = buildScheduleOptions(
        spec,
        ScheduleOverlapPolicy,
        currentSchedule?.action?.workflowId || scheduleOptions.action.workflowId
      );

      await handle.update((current: any) => ({
        action: updatedOptions.action,
        spec: {
          ...updatedOptions.spec,
          startAt: current.spec?.startAt || updatedOptions.spec.startAt,
        },
        policies: updatedOptions.policies,
        state: {
          ...current.state,
          note: updatedOptions.state.note,
          paused: Boolean(current.state?.paused || updatedOptions.state.paused),
        },
        searchAttributes: current.searchAttributes,
        typedSearchAttributes: current.typedSearchAttributes,
      }));
      await (connection as any).close();

      return { message: `Schedule ${spec.id} already exists and was reconciled` };
    } catch (error) {
      // If we get an error, it likely means the schedule doesn't exist
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a "not found" error (schedule doesn't exist)
      if (errorMessage.includes('not found') || 
          errorMessage.includes('NotFound') || 
          errorMessage.includes('NOT_FOUND') ||
          errorMessage.includes('ScheduleNotFound')) {
        console.log(`📝 Schedule ${spec.id} doesn't exist, proceeding with creation...`);
      } else {
        await (connection as any).close();
        throw error;
      }
    }

    console.log(`🚀 Creating schedule ${spec.id} in Temporal...`);
    if (spec.cron) {
      console.log(`   - Cron: ${spec.cron}`);
      console.log(`   - Time Zone: ${spec.timezone || 'UTC'}`);
    } else {
      console.log(`   - Interval: Every ${spec.intervalMinutes || 30} minutes`);
      console.log(`   - Time Zone: ${spec.timezone || 'UTC'}`);
      console.log(`   - Jitter: ${spec.jitterMs ? `${spec.jitterMs}ms` : '30s'}`);
    }
    console.log(`   - Workflow: ${workflowNames[spec.workflowType]}`);
    console.log(`   - Task Queue: ${temporalConfig.taskQueue}`);
    console.log(`   - Start At: ${(spec.startAt || new Date()).toISOString()}`);
    if (spec.endAt) {
      console.log(`   - End At: ${spec.endAt.toISOString()}`);
    }
    console.log(`   - Catchup Window: ${spec.catchupWindow || '1h'}`);
    console.log(`   - Pause on Failure: ${spec.pauseOnFailure !== undefined ? spec.pauseOnFailure : false}`);
    console.log(`   - Initially Paused: ${spec.paused || false}`);
    
    try {
      await withTimeout(
        client.create(scheduleOptions),
        20000, // 20 second timeout for schedule creation
        `Schedule creation for ${spec.id}`
      );

      console.log(`🔒 Closing connection for ${spec.id}...`);
      await (connection as any).close();

      return { message: `Schedule ${spec.id} created successfully` };
    } catch (createError) {
      const createErrorMessage = createError instanceof Error ? createError.message : String(createError);
      
      // If the error is that the schedule already exists, consider it a success
      if (createErrorMessage.includes('already exists') || createErrorMessage.includes('AlreadyExists') || createErrorMessage.includes('ALREADY_EXISTS')) {
        console.log(`✅ Schedule ${spec.id} already exists (detected during creation)`);
        console.log(`🔒 Closing connection for ${spec.id}...`);
        await (connection as any).close();
        
        return { message: `Schedule ${spec.id} already exists (no action needed)` };
      }
      
      // For any other error, close connection and re-throw
      console.log(`🔒 Closing connection for ${spec.id} due to error...`);
      await (connection as any).close();
      throw createError;
    }
  }, 2, 2000, `createSchedule(${spec.id})`); // 2 retries, 2 second delay
}

export async function createAllSchedules() {
  console.log('=== SCHEDULE CREATION ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Environment:', {
    NODE_ENV: process.env.NODE_ENV,
    TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
    TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
    TEMPORAL_TLS: process.env.TEMPORAL_TLS,
    WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE || 'default',
    PWD: process.cwd(),
    isVercel: !!process.env.VERCEL
  });
  
  console.log('');
  console.log(`🚀 Creating ${defaultSchedules.length} schedules...`);
  console.log('Schedules to create:', defaultSchedules.map(s => ({
    id: s.id,
    workflowType: s.workflowType,
    intervalMinutes: s.intervalMinutes
  })));
  console.log('');

  const results = {
    success: [] as string[],
    existing: [] as string[],
    failed: [] as { id: string; error: string }[]
  };

  // Process schedules one by one to avoid connection overload
  for (const schedule of defaultSchedules) {
    try {
      console.log(`📅 Processing schedule: ${schedule.id}`);
      console.log(`   - Workflow: ${schedule.workflowType}`);
      if (schedule.cron) {
        console.log(`   - Cron: ${schedule.cron} (${schedule.timezone || 'UTC'})`);
      } else {
        console.log(`   - Interval: Every ${schedule.intervalMinutes} minutes`);
      }
      console.log(`   - Description: ${schedule.description}`);
      
      const result = await createSchedule(schedule);
      console.log(`   ✅ ${result.message}`);
      console.log('');
      
      // Check if the schedule already existed or was created
      if (result.message.includes('already exists')) {
        results.existing.push(schedule.id);
      } else {
        results.success.push(schedule.id);
      }
      
      // Add small delay between schedules to avoid overwhelming the connection
      if (process.env.VERCEL) {
        console.log('   ⏳ Waiting 1s before next schedule...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Failed: ${errorMessage}`);
      console.log(`   🔍 Error details:`, {
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack?.split('\n')[0] : 'No stack trace',
        errorType: typeof error
      });
      console.log('');
      
      results.failed.push({
        id: schedule.id,
        error: errorMessage
      });
    }
  }

  // Summary
  console.log('=== SCHEDULE CREATION SUMMARY ===');
  console.log(`✅ Successfully created: ${results.success.length} schedules`);
  if (results.success.length > 0) {
    results.success.forEach(id => console.log(`   - ${id} (newly created)`));
  }
  
  console.log(`🔄 Already existing: ${results.existing.length} schedules`);
  if (results.existing.length > 0) {
    results.existing.forEach(id => console.log(`   - ${id} (already exists)`));
  }
  
  console.log(`❌ Failed to create: ${results.failed.length} schedules`);
  if (results.failed.length > 0) {
    results.failed.forEach(({ id, error }) => console.log(`   - ${id}: ${error}`));
  }

  console.log('');
  const totalSuccessful = results.success.length + results.existing.length;
  console.log(`📊 Total successful: ${totalSuccessful}/${defaultSchedules.length} schedules`);
  console.log('🔍 Check Temporal UI to see your schedules');
  console.log('=== SCHEDULE CREATION COMPLETED ===');
  
  return {
    success: [...results.success, ...results.existing], // Combine new and existing as successes
    newlyCreated: results.success,
    existing: results.existing,
    failed: results.failed,
    total: defaultSchedules.length
  };
}

export async function listSchedules() {
  const { ScheduleClient } = require('@temporalio/client');
  const connection = await createTemporalConnection();

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  const schedules = await client.list();
  await (connection as any).close();
  return schedules;
}

export async function deleteSchedule(scheduleId: string) {
  const { ScheduleClient } = require('@temporalio/client');
  const connection = await createTemporalConnection();

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  const handle = client.getHandle(scheduleId);
  await handle.delete();
  await (connection as any).close();
  return { message: `Schedule ${scheduleId} deleted successfully` };
}

export async function toggleSchedule(scheduleId: string, paused: boolean, note?: string) {
  const { ScheduleClient } = require('@temporalio/client');
  const connection = await createTemporalConnection();

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  const handle = client.getHandle(scheduleId);
  
  if (paused) {
    await handle.pause(note);
    await (connection as any).close();
    return { message: `Schedule ${scheduleId} paused successfully` };
  } else {
    await handle.unpause(note);
    await (connection as any).close();
    return { message: `Schedule ${scheduleId} unpaused successfully` };
  }
}
