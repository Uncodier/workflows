import { temporalConfig } from '../../config/config';
import { WorkflowType, workflowNames } from '../workflows';

// Define specific argument types for each workflow
type WorkflowArgs = {
  scheduleActivitiesWorkflow: [];
  syncEmailsWorkflow: [];
  syncEmailsScheduleWorkflow: [];
};

export interface ScheduleSpec {
  id: string;
  workflowType: WorkflowType;
  cronSchedule: string;
  args?: WorkflowArgs[keyof WorkflowArgs];
  description?: string;
  startTime?: Date;
  endTime?: Date;
  jitterMs?: number;
  pauseOnFailure?: boolean;
  catchupWindow?: string;
  paused?: boolean;
}

// Central schedule that manages all other workflows
export const defaultSchedules: ScheduleSpec[] = [
  {
    id: 'central-schedule-activities',
    workflowType: 'scheduleActivitiesWorkflow',
    cronSchedule: '0 0 * * *', // Every day at midnight
    args: [],
    description: 'Central schedule that manages all workflow orchestration',
    startTime: new Date(), // Start immediately
    jitterMs: 30000, // 30 seconds jitter
    pauseOnFailure: false,
    catchupWindow: '1h', // 1 hour catchup window
    paused: false
  },
  {
    id: 'sync-emails-schedule-manager',
    workflowType: 'syncEmailsScheduleWorkflow',
    cronSchedule: '0 */1 * * *', // Every 1 hours
    args: [],
    description: 'Schedule email sync workflows for all sites every hour',
    startTime: new Date(), // Start immediately
    jitterMs: 60000, // 1 minute jitter to spread load
    pauseOnFailure: false,
    catchupWindow: '2h', // 2 hour catchup window
    paused: false
  }
];

// Connection timeout wrapper
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

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

// Helper function to create connection with proper configuration
async function createTemporalConnection() {
  console.log('🔗 Creating Temporal connection...');
  
  const { Connection } = require('@temporalio/client');
  
  const connectionOptions: any = {
    address: temporalConfig.serverUrl,
    // Add connection timeout options
    connectTimeout: '10s',
    rpcTimeout: '30s',
  };

  // Add TLS and API key for remote connections (Temporal Cloud)
  if (temporalConfig.tls) {
    connectionOptions.tls = {
      // Add TLS timeout options
      handshakeTimeout: '10s',
    };
  }

  if (temporalConfig.apiKey) {
    connectionOptions.metadata = {
      'temporal-namespace': temporalConfig.namespace,
    };
    connectionOptions.apiKey = temporalConfig.apiKey;
  }

  console.log('🔗 Connection options:', {
    address: connectionOptions.address,
    hasTls: !!connectionOptions.tls,
    hasApiKey: !!connectionOptions.apiKey,
    connectTimeout: connectionOptions.connectTimeout,
    rpcTimeout: connectionOptions.rpcTimeout
  });

  // Wrap connection with timeout
  return await withTimeout(
    Connection.connect(connectionOptions),
    15000, // 15 second timeout
    'Temporal connection'
  );
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

    // First, check if the schedule already exists
    try {
      console.log(`🔍 Checking if schedule ${spec.id} already exists...`);
      const handle = client.getHandle(spec.id);
      const description = await handle.describe();
      
      // Safely check the schedule state with proper validation
      let scheduleStatus = 'unknown';
      if (description && description.schedule && description.schedule.state) {
        scheduleStatus = description.schedule.state.paused ? 'paused' : 'running';
      } else {
        console.log(`⚠️ Schedule ${spec.id} description has incomplete state information`);
        scheduleStatus = 'exists (state unknown)';
      }
      
      console.log(`✅ Schedule ${spec.id} already exists and is ${scheduleStatus}`);
      console.log(`🔒 Closing connection for ${spec.id}...`);
      await (connection as any).close();
      
      return { message: `Schedule ${spec.id} already exists (no action needed)` };
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
        console.log(`⚠️ Unexpected error checking schedule ${spec.id}: ${errorMessage}`);
        console.log(`📝 Proceeding with creation attempt anyway...`);
      }
    }

    const scheduleOptions = {
      scheduleId: spec.id,
      action: {
        type: 'startWorkflow',
        workflowType: workflowNames[spec.workflowType],
        taskQueue: temporalConfig.taskQueue,
        args: spec.args || [],
        workflowId: `${spec.id}-${Date.now()}`, // Unique workflow ID for each run
      },
      spec: {
        cron: spec.cronSchedule,
        startTime: spec.startTime || new Date(),
        endTime: spec.endTime || undefined,
        jitter: spec.jitterMs ? `${spec.jitterMs}ms` : '30s', // Default 30 second jitter
      },
      policies: {
        catchupWindow: spec.catchupWindow || '1h',
        overlap: ScheduleOverlapPolicy.SKIP,
        pauseOnFailure: spec.pauseOnFailure !== undefined ? spec.pauseOnFailure : false,
      },
      state: {
        note: `Schedule created: ${new Date().toISOString()}`,
        paused: spec.paused || false,
      },
      timeZone: 'UTC',
    } as any;

    console.log(`🚀 Creating schedule ${spec.id} in Temporal...`);
    console.log(`   - Cron: ${spec.cronSchedule}`);
    console.log(`   - Workflow: ${workflowNames[spec.workflowType]}`);
    console.log(`   - Task Queue: ${temporalConfig.taskQueue}`);
    console.log(`   - Time Zone: UTC`);
    console.log(`   - Start Time: ${(spec.startTime || new Date()).toISOString()}`);
    if (spec.endTime) {
      console.log(`   - End Time: ${spec.endTime.toISOString()}`);
    }
    console.log(`   - Jitter: ${spec.jitterMs ? `${spec.jitterMs}ms` : '30s'}`);
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
    cronSchedule: s.cronSchedule
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
      console.log(`   - Cron: ${schedule.cronSchedule}`);
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