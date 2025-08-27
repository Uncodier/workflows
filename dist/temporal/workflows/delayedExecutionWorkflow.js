"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delayedExecutionWorkflow = delayedExecutionWorkflow;
const workflow_1 = require("@temporalio/workflow");
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
        // Generate a more unique ID for the child workflow to prevent conflicts
        const uniqueHash = Math.random().toString(36).substring(2, 15);
        const childWorkflowId = `${targetWorkflow}-executed-${Date.now()}-${uniqueHash}`;
        console.log(`   - Child workflow ID: ${childWorkflowId}`);
        const targetResult = await (0, workflow_1.executeChild)(targetWorkflow, {
            workflowId: childWorkflowId,
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
        console.error(`❌ Failed to execute delayed workflow ${targetWorkflow}: ${errorMessage}`);
        throw new Error(`Delayed execution workflow failed: ${errorMessage}`);
    }
}
