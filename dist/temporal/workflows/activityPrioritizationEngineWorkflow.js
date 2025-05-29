"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityPrioritizationEngineWorkflow = activityPrioritizationEngineWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Configure activity options
const { getContext, designPlan, sendPlan, sendPriorityMail, scheduleActivities } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '2 minutes',
});
/**
 * Activity Prioritization Engine Workflow
 * Runs once a day and manages different prioritization activities
 */
async function activityPrioritizationEngineWorkflow() {
    console.log('🎯 Starting activity prioritization engine workflow...');
    const startTime = new Date();
    try {
        // Step 1: Get context
        console.log('🔍 Step 1: Getting context...');
        const contextResult = await getContext();
        console.log('✅ Context retrieved successfully');
        // Step 2: Design plan
        console.log('📋 Step 2: Designing plan...');
        const planResult = await designPlan(contextResult.context);
        console.log('✅ Plan designed successfully');
        // Step 3: Send plan
        console.log('📤 Step 3: Sending plan...');
        const sendPlanResult = await sendPlan(planResult.plan);
        console.log(`✅ Plan sent to ${sendPlanResult.recipients.length} recipients`);
        // Step 4: Send priority mail
        console.log('📬 Step 4: Sending priority mails...');
        const priorityMailResult = await sendPriorityMail(planResult.activities);
        console.log(`✅ Priority mails sent: ${priorityMailResult.count}`);
        // Step 5: Schedule activities (API calls)
        console.log('📅 Step 5: Scheduling activities...');
        const scheduleResult = await scheduleActivities(planResult.activities);
        console.log(`✅ Activities scheduled via ${scheduleResult.apiCalls} API calls`);
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('🎉 Activity prioritization engine workflow completed successfully');
        return {
            contextRetrieved: true,
            planDesigned: true,
            planSent: true,
            priorityMailsSent: priorityMailResult.count,
            activitiesScheduled: scheduleResult.apiCalls,
            executionTime
        };
    }
    catch (error) {
        console.error('❌ Activity prioritization engine workflow failed:', error);
        throw error;
    }
}
