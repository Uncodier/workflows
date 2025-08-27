"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRobotWorkflow = startRobotWorkflow;
const workflow_1 = require("@temporalio/workflow");
const robotWorkflow_1 = require("./robotWorkflow");
// Define the activity interface and options
const { callRobotInstanceActivity, callRobotPlanActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        maximumInterval: '30s',
    },
});
/**
 * Workflow to start robot planning for a specific site and activity
 *
 * This workflow makes two sequential API calls and then automatically starts robot execution:
 * 1. POST /api/robots/instance - Creates/prepares robot instance, returns instance_id
 * 2. POST /api/agents/growth/robot/plan - Creates robot plan using the instance_id, returns instance_plan_id
 * 3. Automatically starts robotWorkflow as a child workflow for plan execution (with ABANDON policy)
 *
 * After successful plan creation and execution start, this workflow ends.
 * The child robotWorkflow continues running independently until plan completion.
 *
 * First call receives: site_id, activity, and optionally user_id
 * Second call receives: site_id, activity, instance_id (from step 1), and optionally user_id
 * Child workflow receives: site_id, activity, instance_id, instance_plan_id, and optionally user_id
 */
async function startRobotWorkflow(input) {
    const { site_id, activity, user_id } = input;
    console.log(`🚀 Starting robot workflow for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}`);
    try {
        // Prepare activity parameters
        const activityParams = {
            site_id,
            activity
        };
        if (user_id) {
            activityParams.user_id = user_id;
        }
        // Step 1: Call robot instance API
        console.log(`🔄 Step 1: Calling robot instance API...`);
        const instanceResult = await callRobotInstanceActivity(activityParams);
        if (!instanceResult.success) {
            console.error(`❌ Robot instance call failed for site ${site_id}:`, instanceResult.error);
            throw new Error(`Instance call failed: ${instanceResult.error}`);
        }
        // Validate instance_id was returned
        if (!instanceResult.instance_id) {
            console.error(`❌ No instance_id returned from robot instance API for site ${site_id}`);
            throw new Error('Instance API did not return instance_id');
        }
        const instance_id = instanceResult.instance_id;
        console.log(`✅ Robot instance call completed successfully. Instance ID: ${instance_id}`);
        // Step 2: Call robot plan API with instance_id
        console.log(`🔄 Step 2: Calling robot plan API with instance_id: ${instance_id}...`);
        const planParams = {
            site_id,
            activity,
            instance_id
        };
        if (user_id) {
            planParams.user_id = user_id;
        }
        const planResult = await callRobotPlanActivity(planParams);
        if (!planResult.success) {
            console.error(`❌ Robot plan call failed for site ${site_id}:`, planResult.error);
            throw new Error(`Plan call failed: ${planResult.error}`);
        }
        // Extract instance_plan_id from plan call
        const instance_plan_id = planResult.instance_plan_id;
        console.log(`✅ Robot plan call completed successfully for site: ${site_id}`);
        if (instance_plan_id) {
            console.log(`🆔 Instance plan ID obtained: ${instance_plan_id}`);
        }
        console.log(`✅ Start robot workflow completed successfully for site: ${site_id}. Plan created and ready for execution.`);
        // Automatically start the robot execution workflow
        console.log(`🚀 Starting robot execution workflow for site: ${site_id}...`);
        try {
            const robotExecutionHandle = await (0, workflow_1.startChild)(robotWorkflow_1.robotWorkflow, {
                args: [{
                        site_id,
                        activity,
                        instance_id,
                        instance_plan_id,
                        user_id
                    }],
                workflowId: `robot-execution-${site_id}-${instance_id}-${Date.now()}`,
                taskQueue: 'default', // Use the same task queue as the parent workflow
                parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON // ✅ Child continues independently
            });
            console.log(`✅ Robot execution workflow started successfully with ID: ${robotExecutionHandle.workflowId}`);
            console.log(`🔄 Child workflow will continue running independently after parent completes`);
            return {
                success: true,
                instance_id,
                instance_plan_id,
                instanceData: instanceResult.data,
                planData: planResult.data,
                robotExecutionWorkflowId: robotExecutionHandle.workflowId,
                site_id,
                activity,
                user_id,
                executedAt: new Date().toISOString()
            };
        }
        catch (robotError) {
            const robotErrorMessage = robotError instanceof Error ? robotError.message : String(robotError);
            console.error(`❌ Failed to start robot execution workflow for site ${site_id}:`, robotErrorMessage);
            // Still return success for the plan creation, but note the execution failure
            return {
                success: true,
                instance_id,
                instance_plan_id,
                instanceData: instanceResult.data,
                planData: planResult.data,
                error: `Plan created successfully but failed to start execution workflow: ${robotErrorMessage}`,
                site_id,
                activity,
                user_id,
                executedAt: new Date().toISOString()
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Robot workflow exception for site ${site_id}:`, errorMessage);
        throw new Error(`Start robot workflow failed: ${errorMessage}`);
    }
}
