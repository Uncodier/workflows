import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { robotWorkflow } from './robotWorkflow';

// Define the activity interface and options
const { 
  callRobotInstanceActActivity,
  callRobotInstanceResumeActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

export interface PromptRobotWorkflowInput {
  instance_id: string;
  message: string;
  step_status: string;
  site_id: string;
  context?: string;
  activity?: string;
  user_id?: string;
  skill_slugs?: string[];
  skill_mode?: 'auto' | 'required';
}

export interface PromptRobotWorkflowResult {
  success: boolean;
  instance_id: string;
  site_id: string;
  message: string;
  plan_completed?: boolean;
  instance_status?: string;
  robot_workflow_triggered?: boolean;
  robot_workflow_result?: any;
  data?: any;
  plan_analysis?: {
    should_trigger_robot_workflow: boolean;
    plan_decision_action?: string;
    plan_decision_reason?: string;
    new_plan_generated?: boolean;
    plan_actually_completed?: boolean;
  };
  error?: string;
  executedAt: string;
}

/**
 * Workflow to prompt robot with a message and conditionally trigger robotWorkflow
 * 
 * This workflow:
 * 1. Calls /api/robots/instance/act with the provided message
 * 2. Analyzes plan completion status and decision logic
 * 3. If plan is completed or new plan generated, triggers robotWorkflow as child workflow
 * 4. If plan is pending and instance is running, terminates successfully
 * 
 * The robotWorkflow child uses ParentClosePolicy.ABANDON to continue running
 * independently even after this prompt workflow completes.
 * 
 * Input requires: instance_id, message, step_status, site_id
 * Optional: context, activity, user_id
 */
export async function promptRobotWorkflow(input: PromptRobotWorkflowInput): Promise<PromptRobotWorkflowResult> {
  const { instance_id, message, step_status, site_id, context, activity, user_id, skill_slugs, skill_mode } = input;
  
  console.log(`🎯 Starting prompt robot workflow for instance: ${instance_id}, site: ${site_id}`);
  console.log(`📝 Message: ${message}`);
  console.log(`📊 Step status: ${step_status}`);

  try {
    // Step 0: Resume instance if instance_id is provided to ensure it's up
    console.log(`🔄 Resuming robot instance: ${instance_id}...`);
    
    const resumeResult = await callRobotInstanceResumeActivity({ instance_id });
    
    if (!resumeResult.success) {
      console.error(`❌ Robot instance resume call failed for instance ${instance_id}:`, resumeResult.error);
      throw new Error(`Resume call failed: ${resumeResult.error}`);
    }
    
    console.log(`✅ Robot instance resume call completed successfully for instance: ${instance_id}`);

    // Step 1: Call the robot instance act API
    console.log(`🚀 Calling robot instance act API...`);
    
    const actResult = await callRobotInstanceActActivity({
      instance_id,
      message,
      step_status,
      site_id,
      context,
      skill_slugs,
      skill_mode
    });

    if (!actResult.success) {
      throw new Error(`Robot instance act call failed: ${actResult.error}`);
    }

    console.log(`✅ Robot instance act API call successful`);
    console.log(`📊 Plan completed: ${actResult.plan_completed}`);
    console.log(`🔍 Instance status: ${actResult.instance_status || 'unknown'}`);

    // Step 2: Check plan completion status and decision logic
    const plan_completed = actResult.plan_completed ?? false;
    const instance_status = actResult.instance_status;
    const planData = actResult.data || {};
    
    // Check for complex plan decision logic
    const planDecision = planData.plan_decision;
    const newPlanGenerated = planData.new_plan_generated;
    const planActuallyCompleted = planData.plan_actually_completed;
    
    let robot_workflow_triggered = false;
    let robot_workflow_result = null;

    // Determine if robotWorkflow should be triggered based on multiple conditions
    const shouldTriggerRobotWorkflow = 
      plan_completed || // Direct plan completion
      (planDecision?.action === 'new_plan' && newPlanGenerated) || // New plan generated
      (planActuallyCompleted && newPlanGenerated); // Previous plan completed and new one generated

    console.log(`🔍 Plan analysis:`);
    console.log(`  - plan_completed: ${plan_completed}`);
    console.log(`  - plan_decision.action: ${planDecision?.action || 'none'}`);
    console.log(`  - new_plan_generated: ${newPlanGenerated}`);
    console.log(`  - plan_actually_completed: ${planActuallyCompleted}`);
    console.log(`  - shouldTriggerRobotWorkflow: ${shouldTriggerRobotWorkflow}`);

    if (shouldTriggerRobotWorkflow) {
      // Plan is completed or new plan generated, trigger robotWorkflow as child workflow
      console.log(`✅ Triggering robotWorkflow - Reason: ${planDecision?.reason || 'Plan completed or new plan generated'}`);
      
      if (!activity) {
        console.warn(`⚠️ No activity provided for robotWorkflow, using default 'robot-prompt'`);
      }

      try {
        const robotWorkflowInput = {
          site_id,
          activity: activity || 'robot-prompt',
          instance_id,
          user_id,
          skill_slugs,
          skill_mode
        };

        robot_workflow_result = await startChild(robotWorkflow, {
          args: [robotWorkflowInput],
          workflowId: `robot-workflow-${instance_id}-${Date.now()}`,
          taskQueue: 'default',
          parentClosePolicy: ParentClosePolicy.ABANDON
        });

        robot_workflow_triggered = true;
        console.log(`✅ Robot workflow triggered successfully as child workflow`);
        console.log(`🔄 Child workflow will continue running independently (ParentClosePolicy.ABANDON)`);
        
      } catch (robotError) {
        console.error(`❌ Failed to trigger robot workflow: ${robotError}`);
        // Don't fail the entire workflow, just log the error
        robot_workflow_result = {
          error: `Failed to trigger robot workflow: ${robotError instanceof Error ? robotError.message : String(robotError)}`
        };
      }
    } else {
      // Plan is not completed and no new plan generated, check instance status
      if (instance_status === 'running' || instance_status === 'active') {
        console.log(`✅ Plan is pending and instance is running (${instance_status}), terminating successfully`);
        console.log(`🔄 Current workflow will let the running instance take initiative of the new plan`);
      } else {
        console.log(`⚠️ Plan is pending but instance status is: ${instance_status || 'unknown'}`);
        console.log(`💡 This may require manual intervention or the instance may start automatically`);
      }
    }

    // Return successful result with detailed plan analysis
    return {
      success: true,
      instance_id,
      site_id,
      message,
      plan_completed,
      instance_status,
      robot_workflow_triggered,
      robot_workflow_result,
      data: actResult.data,
      // Additional plan analysis information
      plan_analysis: {
        should_trigger_robot_workflow: shouldTriggerRobotWorkflow,
        plan_decision_action: planDecision?.action,
        plan_decision_reason: planDecision?.reason,
        new_plan_generated: newPlanGenerated,
        plan_actually_completed: planActuallyCompleted
      },
      executedAt: new Date().toISOString()
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Prompt robot workflow failed for instance ${instance_id}:`, errorMessage);
    
    return {
      success: false,
      instance_id,
      site_id,
      message,
      error: errorMessage,
      executedAt: new Date().toISOString()
    };
  }
}
