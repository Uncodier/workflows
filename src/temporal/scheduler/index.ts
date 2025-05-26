import { getTemporalClient } from '../client';
import { WorkflowType } from '../workflows';
import { temporalConfig } from '../../config/config';

/**
 * Schedule a workflow to run on a cron schedule
 */
export async function createCronSchedule(
  scheduleName: string,
  workflowType: WorkflowType,
  args: unknown[],
  cronExpression: string,
  options?: Record<string, any>
) {
  const client = await getTemporalClient();

  try {
    const scheduleClient = client.schedule as any;
    await scheduleClient.create({
      scheduleId: scheduleName,
      spec: {
        intervals: [{ every: cronExpression }],
      },
      action: {
        type: 'startWorkflow',
        workflowType,
        taskQueue: options?.taskQueue ?? temporalConfig.taskQueue,
        args,
      },
    });

    console.log(`Schedule created: ${scheduleName} for workflow ${workflowType} with cron: ${cronExpression}`);
    return scheduleName;
  } catch (error) {
    console.error(`Failed to create schedule ${scheduleName}:`, error);
    throw error;
  }
}

/**
 * List all schedules
 */
export async function listSchedules() {
  const client = await getTemporalClient();
  const scheduleClient = client.schedule as any;
  const schedulesIterable = await scheduleClient.list();
  
  // Convert AsyncIterable to array
  const schedules = [];
  for await (const schedule of schedulesIterable) {
    schedules.push(schedule);
  }
  
  return schedules;
}

/**
 * Delete a schedule
 */
export async function deleteSchedule(scheduleId: string) {
  const client = await getTemporalClient();
  const scheduleClient = client.schedule as any;
  await scheduleClient.delete(scheduleId);
  console.log(`Schedule deleted: ${scheduleId}`);
}

/**
 * Pause a schedule
 */
export async function pauseSchedule(scheduleId: string, note = 'Paused by API') {
  const client = await getTemporalClient();
  const scheduleClient = client.schedule as any;
  
  const description = await scheduleClient.describe(scheduleId);
  
  await scheduleClient.update(scheduleId, {
    ...description,
    state: {
      ...description.state,
      paused: true,
      note,
    },
  });
  
  console.log(`Schedule paused: ${scheduleId}`);
}

/**
 * Unpause a schedule
 */
export async function unpauseSchedule(scheduleId: string, note = 'Unpaused by API') {
  const client = await getTemporalClient();
  const scheduleClient = client.schedule as any;
  
  const description = await scheduleClient.describe(scheduleId);
  
  await scheduleClient.update(scheduleId, {
    ...description,
    state: {
      ...description.state,
      paused: false,
      note,
    },
  });
  
  console.log(`Schedule unpaused: ${scheduleId}`);
} 