import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { robotWorkflow } from './robotWorkflow';



// Define the activity interface and options
const { 
  callRobotInstanceActivity,
  callRobotPlanActivity,
  callRobotInstanceResumeActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

export interface StartRobotInput {
  site_id: string;
  activity: string;
  user_id?: string;
  instance_id?: string;
  message?: string;
  context?: any;
}

export interface StartRobotResult {
  success: boolean;
  instance_id?: string;
  instance_plan_id?: string;
  instanceData?: any;
  planData?: any;
  robotExecutionWorkflowId?: string;
  error?: string;
  site_id: string;
  activity: string;
  user_id?: string;
  executedAt: string;
}

/**
 * Workflow to start robot planning for a specific site and activity
 * 
 * This workflow makes sequential API calls and then automatically starts robot execution:
 * 
 * When instance_id is provided:
 * 1. POST /api/robots/instance/resume - Resumes existing robot instance
 * 2. POST /api/agents/growth/robot/plan - Creates robot plan using the instance_id, returns instance_plan_id
 * 3. Automatically starts robotWorkflow as a child workflow for plan execution (with ABANDON policy)
 * 
 * When instance_id is NOT provided:
 * 1. POST /api/robots/instance - Creates/prepares robot instance, returns instance_id
 * 2. POST /api/agents/growth/robot/plan - Creates robot plan using the instance_id, returns instance_plan_id
 * 3. Automatically starts robotWorkflow as a child workflow for plan execution (with ABANDON policy)
 * 
 * After successful plan creation and execution start, this workflow ends.
 * The child robotWorkflow continues running independently until plan completion.
 * 
 * Input: site_id, activity, and optionally user_id, instance_id, message, and context
 * Child workflow receives: site_id, activity, instance_id, instance_plan_id, and optionally user_id
 */
export async function startRobotWorkflow(input: StartRobotInput): Promise<StartRobotResult> {
  const { site_id, activity, user_id, instance_id: providedInstanceId, message, context } = input;
  
  console.log(`🚀 Starting robot workflow for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}${message ? `, message: ${message}` : ''}${context ? `, context: ${JSON.stringify(context)}` : ''}`);

  try {
    // Resolve instance_id: use provided one or create a new instance
    let instance_id: string;
    let instanceAPIData: any | undefined;

    if (providedInstanceId) {
      instance_id = providedInstanceId;
      console.log(`🆔 Using provided instance_id: ${instance_id}`);
      
      // Call resume API when instance_id is provided
      console.log(`🔄 Calling robot instance resume API for instance: ${instance_id}...`);
      const resumeResult = await callRobotInstanceResumeActivity({ instance_id });
      
      if (!resumeResult.success) {
        console.error(`❌ Robot instance resume call failed for instance ${instance_id}:`, resumeResult.error);
        throw new Error(`Resume call failed: ${resumeResult.error}`);
      }
      
      console.log(`✅ Robot instance resume call completed successfully for instance: ${instance_id}`);
      instanceAPIData = resumeResult.data;
    } else {
      // Prepare activity parameters
      const activityParams: any = {
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

      instance_id = instanceResult.instance_id;
      instanceAPIData = instanceResult.data;
      console.log(`✅ Robot instance call completed successfully. Instance ID: ${instance_id}`);
    }

    // Step 2: Call robot plan API with instance_id (only if message is provided)
    let instance_plan_id: string | undefined;
    let planResult: any = undefined;

    if (message) {
      console.log(`🔄 Step 2: Calling robot plan API with instance_id: ${instance_id}...`);
      
      const planParams: any = {
        site_id,
        activity,
        instance_id
      };
      
      if (user_id) {
        planParams.user_id = user_id;
      }
      
      planParams.message = message;
      
      if (context) {
        planParams.context = context;
      }
      
      planResult = await callRobotPlanActivity(planParams);

      if (!planResult.success) {
        console.error(`❌ Robot plan call failed for site ${site_id}:`, planResult.error);
        throw new Error(`Plan call failed: ${planResult.error}`);
      }

      // Extract instance_plan_id from plan call
      instance_plan_id = planResult.instance_plan_id;
      
      console.log(`✅ Robot plan call completed successfully for site: ${site_id}`);
      if (instance_plan_id) {
        console.log(`🆔 Instance plan ID obtained: ${instance_plan_id}`);
      }
    } else {
      console.log(`⏭️ Skipping plan creation - no message provided. Only instance started.`);
    }

    console.log(`✅ Start robot workflow completed successfully for site: ${site_id}.${message ? ' Plan created and ready for execution.' : ' Instance started without plan.'}`);

    // Only start the robot execution workflow if we have a plan (message was provided)
    if (message && instance_plan_id) {
      console.log(`🚀 Starting robot execution workflow for site: ${site_id}...`);
      
      try {
        const robotExecutionHandle = await startChild(robotWorkflow, {
          args: [{
            site_id,
            activity,
            instance_id,
            instance_plan_id,
            user_id
          }],
          workflowId: `robot-execution-${site_id}-${instance_id}-${Date.now()}`,
          taskQueue: 'default', // Use the same task queue as the parent workflow
          parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON // ✅ Child continues independently
        });

        console.log(`✅ Robot execution workflow started successfully with ID: ${robotExecutionHandle.workflowId}`);
        console.log(`🔄 Child workflow will continue running independently after parent completes`);
        
        return {
          success: true,
          instance_id,
          instance_plan_id,
          instanceData: instanceAPIData,
          planData: planResult?.data,
          robotExecutionWorkflowId: robotExecutionHandle.workflowId,
          site_id,
          activity,
          user_id,
          executedAt: new Date().toISOString()
        };
        
      } catch (robotError) {
        const robotErrorMessage = robotError instanceof Error ? robotError.message : String(robotError);
        console.error(`❌ Failed to start robot execution workflow for site ${site_id}:`, robotErrorMessage);
        
        // Still return success for the plan creation, but note the execution failure
        return {
          success: true,
          instance_id,
          instance_plan_id,
          instanceData: instanceAPIData,
          planData: planResult?.data,
          error: `Plan created successfully but failed to start execution workflow: ${robotErrorMessage}`,
          site_id,
          activity,
          user_id,
          executedAt: new Date().toISOString()
        };
      }
    } else {
      // No message provided, just return the instance data without starting execution workflow
      console.log(`✅ Instance started successfully without plan execution workflow`);
      
      return {
        success: true,
        instance_id,
        instance_plan_id: undefined,
        instanceData: instanceAPIData,
        planData: undefined,
        robotExecutionWorkflowId: undefined,
        site_id,
        activity,
        user_id,
        executedAt: new Date().toISOString()
      };
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Robot workflow exception for site ${site_id}:`, errorMessage);

    throw new Error(`Start robot workflow failed: ${errorMessage}`);
  }
}