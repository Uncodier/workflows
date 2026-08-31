"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delayedExecutionWorkflow = delayedExecutionWorkflow;
const workflow_1 = require("@temporalio/workflow");
const common_1 = require("@temporalio/common");
/**
 * Delayed Execution Workflow
 * Waits for a specified delay and then executes the target workflow
 * Used for timer-based scheduling instead of cron schedules
 */
async function delayedExecutionWorkflow(options) {
    const { delayMs, targetWorkflow, targetArgs, siteName, scheduledTime, executionType } = options;
    console.log(`⏰ Starting delayed execution workflow`);
    console.log(`   - Target workflow: ${targetWorkflow}`);
    console.log(`   - Site: ${siteName || 'Unknown'}`);
    console.log(`   - Scheduled time: ${scheduledTime || 'Unknown'}`);
    console.log(`   - Execution type: ${executionType || 'timer-based'}`);
    console.log(`   - Delay: ${delayMs}ms (${(delayMs / 1000 / 60).toFixed(1)} minutes)`);
    try {
        // If delay is positive, sleep first
        if (delayMs > 0) {
            console.log(`😴 Sleeping for ${delayMs}ms...`);
            await (0, workflow_1.sleep)(delayMs);
            console.log(`⏰ Delay complete! Now executing ${targetWorkflow}`);
        }
        else {
            console.log(`⚡ No delay needed, executing ${targetWorkflow} immediately`);
        }
        // Execute the target workflow
        console.log(`🚀 Starting ${targetWorkflow} for ${siteName || 'site'}`);
        // Generate deterministic child workflow ID based on arguments if possible
        const siteId = targetArgs?.[0]?.site_id || targetArgs?.[0]?.siteId;
        const execDay = targetArgs?.[0]?.additionalData?.executionDay;
        // We capture the starting timestamp outside the sleep to keep it deterministic across replays/re-runs
        // if we fall back to it.
        const startTimestamp = (0, workflow_1.workflowInfo)().runId || 'unknown';
        let childWorkflowId;
        if (siteId && execDay) {
            childWorkflowId = `${targetWorkflow}-executed-${siteId}-${execDay}`;
        }
        else {
            // Fallback for non-daily/non-site executions
            childWorkflowId = `${targetWorkflow}-executed-${siteId || 'unknown'}-${startTimestamp}`;
        }
        console.log(`   - Child workflow ID: ${childWorkflowId}`);
        const targetResult = await (0, workflow_1.executeChild)(targetWorkflow, {
            workflowId: childWorkflowId,
            workflowIdReusePolicy: common_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
            args: targetArgs,
        });
        console.log(`✅ Successfully executed ${targetWorkflow} for ${siteName || 'site'}`);
        return {
            success: true,
            delayedFor: `${(delayMs / 1000 / 60).toFixed(1)} minutes`,
            targetWorkflow,
            targetResult
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // If the error indicates we attempted to start a duplicate workflow, treat as success (already ran today).
        if (errorMessage.includes('WorkflowExecutionAlreadyStartedError') || errorMessage.includes('Workflow execution already started')) {
            console.log(`✅ Child workflow ${targetWorkflow} already started/completed today. This prevents duplicates.`);
            return {
                success: true,
                delayedFor: `${(delayMs / 1000 / 60).toFixed(1)} minutes`,
                targetWorkflow,
                targetResult: { skipped: true, reason: 'Already started' }
            };
        }
        console.error(`❌ Failed to execute delayed workflow ${targetWorkflow}: ${errorMessage}`);
        throw new Error(`Delayed execution workflow failed: ${errorMessage}`);
    }
}
