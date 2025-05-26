import { ScheduleClient, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import { temporalConfig } from '../../config/config';
import { WorkflowType, workflows } from '../workflows';

// Define specific argument types for each workflow
type WorkflowArgs = {
  dataProcessingWorkflow: [string, { transform?: boolean }];
  scheduledApiPollingWorkflow: [{ endpoint?: string; storeMetrics?: boolean }];
  syncEmailsWorkflow: [{ 
    userId: string;
    provider: 'gmail' | 'outlook' | 'imap';
    since?: Date;
    folderIds?: string[];
    batchSize?: number;
  }];
};

export interface ScheduleSpec {
  id: string;
  workflowType: WorkflowType;
  cronSchedule: string;
  args?: WorkflowArgs[keyof WorkflowArgs];
  description?: string;
}

// Define your schedules here
export const defaultSchedules: ScheduleSpec[] = [
  {
    id: 'daily-data-processing',
    workflowType: 'dataProcessingWorkflow',
    cronSchedule: '0 0 * * *', // Every day at midnight
    args: ['daily-batch', { transform: true }],
    description: 'Daily data processing job'
  },
  {
    id: 'hourly-api-polling',
    workflowType: 'scheduledApiPollingWorkflow',
    cronSchedule: '0 * * * *', // Every hour
    args: [{ endpoint: '/api/status', storeMetrics: true }],
    description: 'Hourly API health check'
  },
  {
    id: 'email-sync-every-5min',
    workflowType: 'syncEmailsWorkflow',
    cronSchedule: '*/5 * * * *', // Every 5 minutes
    args: [{ 
      userId: 'system-sync',
      provider: 'gmail',
      batchSize: 100
    }],
    description: 'Email synchronization every 5 minutes'
  }
];

export async function createSchedule(spec: ScheduleSpec) {
  const connection = await Connection.connect({
    address: temporalConfig.serverUrl,
  });

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  // Using type assertion to avoid linting issues while we sort out the correct types
  const scheduleOptions = {
    scheduleId: spec.id,
    action: {
      type: 'startWorkflow',
      workflowType: workflows[spec.workflowType],
      taskQueue: temporalConfig.taskQueue,
      args: spec.args || [],
    },
    spec: {
      cron: spec.cronSchedule
    },
    policies: {
      catchupWindow: '5m',
      overlap: ScheduleOverlapPolicy.SKIP,
    },
  } as any;

  await client.create(scheduleOptions);

  return { message: `Schedule ${spec.id} created successfully` };
}

export async function listSchedules() {
  const connection = await Connection.connect({
    address: temporalConfig.serverUrl,
  });

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  const schedules = await client.list();
  return schedules;
}

export async function deleteSchedule(scheduleId: string) {
  const connection = await Connection.connect({
    address: temporalConfig.serverUrl,
  });

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  const handle = client.getHandle(scheduleId);
  await handle.delete();
  return { message: `Schedule ${scheduleId} deleted successfully` };
}

export async function toggleSchedule(scheduleId: string, paused: boolean, note?: string) {
  const connection = await Connection.connect({
    address: temporalConfig.serverUrl,
  });

  const client = new ScheduleClient({
    connection,
    namespace: temporalConfig.namespace,
  });

  const handle = client.getHandle(scheduleId);
  
  if (paused) {
    await handle.pause(note);
    return { message: `Schedule ${scheduleId} paused successfully` };
  } else {
    await handle.unpause(note);
    return { message: `Schedule ${scheduleId} unpaused successfully` };
  }
} 