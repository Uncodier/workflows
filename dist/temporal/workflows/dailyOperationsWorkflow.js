"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyOperationsWorkflow = dailyOperationsWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Configure activity options for status checking and reporting
const { getContext, sendPriorityMail, cleanStuckRunningStatusActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '2 minutes',
});
// Configure longer timeout for comprehensive status checks
const { checkWorkflowsHealthActivity: checkWorkflowsHealth, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    heartbeatTimeout: '1 minute',
    retry: {
        initialInterval: '1 minute',
        maximumInterval: '3 minutes',
        maximumAttempts: 2,
    },
});
/**
 * Daily Operations Monitoring Workflow
 * Reviews status of existing workflows and tasks to determine if issues need attention
 *
 * RESPONSIBILITIES:
 * - Monitor health of existing workflows
 * - Check for stuck or failed processes
 * - Review task completion status
 * - Determine if human intervention is needed
 * - Send alerts/notifications only when problems are detected
 */
async function dailyOperationsWorkflow(options = {}) {
    console.log('👁️ Starting daily operations monitoring workflow...');
    console.log('🔍 MONITORING MODE: Will check status of existing workflows/tasks only');
    const startTime = new Date();
    let stuckRecordsCleaned = 0;
    // Extract business hours analysis
    const { businessHoursAnalysis } = options;
    if (businessHoursAnalysis) {
        console.log('📊 Using business hours analysis for monitoring scope:');
        console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
        console.log(`   - Monitoring focused on active sites: ${businessHoursAnalysis.shouldExecuteOperations}`);
    }
    try {
        // Step 1: Preventive maintenance - Clean stuck RUNNING records
        console.log('🧹 Step 1: Preventive maintenance - cleaning stuck RUNNING cron status records...');
        try {
            const cleanupResult = await cleanStuckRunningStatusActivity(6); // Clean records older than 6 hours
            stuckRecordsCleaned = cleanupResult.cleaned;
            if (stuckRecordsCleaned > 0) {
                console.log(`✅ Preventive maintenance completed: ${stuckRecordsCleaned} stuck records cleaned`);
            }
            else {
                console.log('✅ Preventive maintenance completed: No stuck records found');
            }
            if (cleanupResult.errors.length > 0) {
                console.log(`⚠️ Cleanup had ${cleanupResult.errors.length} errors:`);
                cleanupResult.errors.forEach((error, index) => {
                    console.log(`   ${index + 1}. ${error}`);
                });
            }
        }
        catch (cleanupError) {
            console.error('⚠️ Preventive maintenance failed, continuing with monitoring:', cleanupError);
        }
        // Step 2: Get operational context
        console.log('🔍 Step 2: Getting operational context...');
        await getContext();
        console.log('✅ Context retrieved successfully');
        // Step 3: Comprehensive workflow health check
        console.log('🏥 Step 3: Checking health of existing workflows and tasks...');
        const healthCheck = await checkWorkflowsHealth({
            businessHoursAnalysis,
            checkTypes: ['daily-standup', 'email-sync', 'lead-generation', 'daily-prospection']
        });
        console.log(`📊 Health check completed:`);
        console.log(`   - Healthy workflows: ${healthCheck.healthyWorkflows}`);
        console.log(`   - Failed workflows: ${healthCheck.failedWorkflows}`);
        console.log(`   - Stuck workflows: ${healthCheck.stuckWorkflows}`);
        console.log(`   - Pending tasks: ${healthCheck.pendingTasks}`);
        console.log(`   - Issues detected: ${healthCheck.issues.length}`);
        // Step 4: Determine system health level
        let systemHealth = 'healthy';
        let alertsSent = 0;
        if (healthCheck.failedWorkflows > 0 || healthCheck.stuckWorkflows > 3) {
            systemHealth = 'critical';
        }
        else if (healthCheck.issues.length > 2 || healthCheck.stuckWorkflows > 0) {
            systemHealth = 'warning';
        }
        console.log(`🎯 Overall system health: ${systemHealth.toUpperCase()}`);
        // Step 5: Send alerts only if issues need attention
        if (healthCheck.needsAttention) {
            console.log('🚨 Step 5: Issues detected - sending priority alerts...');
            const alertActivities = [
                `System Health: ${systemHealth}`,
                `Failed Workflows: ${healthCheck.failedWorkflows}`,
                `Stuck Workflows: ${healthCheck.stuckWorkflows}`,
                ...healthCheck.issues.map(issue => `Issue: ${issue.description}`)
            ];
            const priorityMailResult = await sendPriorityMail(alertActivities);
            alertsSent = priorityMailResult.count;
            console.log(`📧 Priority alerts sent: ${alertsSent}`);
        }
        else {
            console.log('✅ Step 5: No critical issues detected - no alerts needed');
        }
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('🎉 Daily operations monitoring completed successfully');
        console.log(`   Total execution time: ${executionTime}`);
        console.log(`   Stuck records cleaned: ${stuckRecordsCleaned}`);
        console.log(`   System health: ${systemHealth}`);
        console.log('   Strategy: Monitor existing workflows, alert only when needed');
        return {
            workflowsMonitored: healthCheck.healthyWorkflows + healthCheck.failedWorkflows + healthCheck.stuckWorkflows,
            issuesDetected: healthCheck.issues.length,
            alertsSent,
            stuckRecordsCleaned,
            systemHealth,
            recommendations: healthCheck.recommendations,
            executionTime
        };
    }
    catch (error) {
        console.error('❌ Daily operations monitoring workflow failed:', error);
        throw error;
    }
}
