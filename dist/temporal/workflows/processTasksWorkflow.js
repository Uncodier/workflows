"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTasksWorkflow = processTasksWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { fetchUpcomingTasksActivity, getTaskMembersActivity, translateAndFormatTaskNotificationActivity, sendTaskNotificationActivity, createTaskCommentActivity, markTaskReminderSentActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5m',
    retry: {
        initialInterval: '1m',
        maximumAttempts: 3
    }
});
async function processTasksWorkflow() {
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
                        // Add comment to task timeline
                        await createTaskCommentActivity({
                            task_id: task.id,
                            content: `📧 Recordatorio enviado: ${subject}`,
                            user_id: task.assignee || undefined,
                            is_private: true
                        });
                    }
                    // Mark reminder as sent to avoid duplicates
                    await markTaskReminderSentActivity({
                        task_id: task.id,
                        timeWindowHours
                    });
                    totalProcessed++;
                }
                catch (err) {
                    console.error(`❌ Error processing task ${task.id}:`, err);
                    totalErrors++;
                }
            }
        }
        catch (err) {
            console.error(`❌ Error fetching tasks for ${timeWindowHours}h window:`, err);
            totalErrors++;
        }
    }
    console.log(`✅ ProcessTasksWorkflow completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`);
    return { processed: totalProcessed, errors: totalErrors };
}
