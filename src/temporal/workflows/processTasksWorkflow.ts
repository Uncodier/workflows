import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const {
  fetchUpcomingTasksActivity,
  getTaskMembersActivity,
  translateAndFormatTaskNotificationActivity,
  sendTaskNotificationActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5m',
  retry: {
    initialInterval: '1m',
    maximumAttempts: 3
  }
});

export async function processTasksWorkflow(): Promise<{ processed: number; errors: number }> {
  console.log('🔄 Starting processTasksWorkflow (Cron)...');

  let totalProcessed = 0;
  let totalErrors = 0;

  for (const timeWindowHours of [24, 1]) {
    try {
      const tasks = await fetchUpcomingTasksActivity({ timeWindowHours });
      
      for (const task of tasks) {
        try {
          const members = await getTaskMembersActivity(task);
          
          for (const member of members) {
            const { subject, message } = await translateAndFormatTaskNotificationActivity({
              task,
              member,
              timeWindowHours
            });
            
            await sendTaskNotificationActivity({
              email: member.email,
              subject,
              message,
              site_id: task.site_id,
              lang: member.lang
            });
          }
          totalProcessed++;
        } catch (err) {
          console.error(`❌ Error processing task ${task.id}:`, err);
          totalErrors++;
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching tasks for ${timeWindowHours}h window:`, err);
      totalErrors++;
    }
  }

  console.log(`✅ ProcessTasksWorkflow completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`);

  return { processed: totalProcessed, errors: totalErrors };
}
