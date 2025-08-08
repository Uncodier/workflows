import { proxyActivities, sleep } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  callRobotPlanActActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

export interface RobotWorkflowInput {
  site_id: string;
  activity: string;
  instance_id: string;
  instance_plan_id?: string;
  user_id?: string;
}

export interface RobotWorkflowResult {
  success: boolean;
  instance_id: string;
  instance_plan_id?: string;
  planResults?: {
    cycle: number;
    step?: {
      id: string;
      order: number;
      title: string;
      status: string;
      result?: string;
    };
    plan_progress?: {
      completed_steps: number;
      total_steps: number;
      percentage: number;
    };
    message?: string;
    execution_time_ms?: number;
    steps_executed?: number;
    token_usage?: {
      input_tokens: number;
      output_tokens: number;
    };
    remote_instance_id?: string;
    is_blocked?: boolean;
    waiting_for_session?: boolean;
    requires_continuation?: boolean;
    timestamp: string;
  }[];
  totalPlanCycles?: number;
  finalProgress?: {
    completed_steps: number;
    total_steps: number;
    percentage: number;
  };
  totalExecutionTime?: number;
  totalTokenUsage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: string;
  site_id: string;
  activity: string;
  user_id?: string;
  executedAt: string;
}

/**
 * Workflow to execute robot plan in a loop until completion
 * 
 * This workflow continuously calls the robot plan act API until plan_completed is true:
 * - POST /api/robots/plan/act - Executes robot plan actions in a loop
 * - Waits 30 seconds between each API call to avoid overwhelming the external service
 * 
 * Input requires: site_id, activity, instance_id, and optionally instance_plan_id and user_id
 * 
 * The workflow will continue calling the plan act API until the response contains plan_completed: true
 */
export async function robotWorkflow(input: RobotWorkflowInput): Promise<RobotWorkflowResult> {
  const { site_id, activity, instance_id, instance_plan_id, user_id } = input;
  
  console.log(`🤖 Starting robot execution workflow for site: ${site_id}, activity: ${activity}, instance: ${instance_id}${instance_plan_id ? `, plan: ${instance_plan_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Prepare activity parameters
    const planParams: any = {
      site_id,
      activity,
      instance_id
    };
    
    if (instance_plan_id) {
      planParams.instance_plan_id = instance_plan_id;
    }
    
    if (user_id) {
      planParams.user_id = user_id;
    }

    const planResults: any[] = [];
    let totalPlanCycles = 0;
    let planCompleted = false;
    const maxCycles = 100; // Safety limit to prevent infinite loops

    console.log(`🔄 Starting robot plan execution loop...`);

    while (!planCompleted && totalPlanCycles < maxCycles) {
      totalPlanCycles++;
      console.log(`🔃 Robot plan execution cycle ${totalPlanCycles} for site ${site_id}...`);

      try {
        const planResult = await callRobotPlanActActivity(planParams);

        if (!planResult.success) {
          console.error(`❌ Robot plan act call failed for site ${site_id} on cycle ${totalPlanCycles}:`, planResult.error);
          
          return {
            success: false,
            error: `Plan act call failed on cycle ${totalPlanCycles}: ${planResult.error}`,
            instance_id,
            instance_plan_id,
            planResults,
            totalPlanCycles,
            site_id,
            activity,
            user_id,
            executedAt: new Date().toISOString()
          };
        }

        // Extract and structure important data from the response
        const stepData = {
          cycle: totalPlanCycles,
          step: planResult.data?.step,
          plan_progress: planResult.data?.plan_progress,
          message: planResult.data?.message,
          execution_time_ms: planResult.data?.execution_time_ms,
          steps_executed: planResult.data?.steps_executed,
          token_usage: planResult.data?.token_usage,
          remote_instance_id: planResult.data?.remote_instance_id,
          is_blocked: planResult.data?.is_blocked,
          waiting_for_session: planResult.data?.waiting_for_session,
          requires_continuation: planResult.data?.requires_continuation,
          timestamp: new Date().toISOString()
        };
        
        planResults.push(stepData);
        planCompleted = planResult.plan_completed ?? false;

        console.log(`📊 Cycle ${totalPlanCycles} completed. Plan completed: ${planCompleted}`);
        
        // Log progress if available
        if (planResult.data?.plan_progress) {
          const progress = planResult.data.plan_progress;
          console.log(`📈 Progress: ${progress.completed_steps}/${progress.total_steps} (${progress.percentage}%)`);
        }
        
        // Log current step if available
        if (planResult.data?.step) {
          const step = planResult.data.step;
          console.log(`🔧 Step: ${step.title} (${step.status}) - ${step.result || 'In progress'}`);
        }
        
        // Log execution metrics
        if (planResult.data?.execution_time_ms) {
          console.log(`⏱️ Execution time: ${planResult.data.execution_time_ms}ms`);
        }
        
        // Log any blocking conditions
        if (planResult.data?.is_blocked) {
          console.log(`⚠️ Plan is blocked`);
        }
        
        if (planResult.data?.waiting_for_session) {
          console.log(`⏳ Waiting for session`);
        }

        if (!planCompleted) {
          console.log(`🔄 Plan not yet completed, continuing to next cycle...`);
          console.log(`⏱️ Waiting 30 seconds before next API call...`);
          await sleep('30s');
          console.log(`✅ Wait completed, proceeding to next cycle`);
        }

        // Update instance_plan_id if returned from the API (for first call)
        if (planResult.instance_plan_id && !instance_plan_id) {
          planParams.instance_plan_id = planResult.instance_plan_id;
          console.log(`🆔 Instance plan ID updated: ${planResult.instance_plan_id}`);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Robot plan act exception on cycle ${totalPlanCycles} for site ${site_id}:`, errorMessage);
        
        return {
          success: false,
          error: `Plan act exception on cycle ${totalPlanCycles}: ${errorMessage}`,
          instance_id,
          instance_plan_id,
          planResults,
          totalPlanCycles,
          site_id,
          activity,
          user_id,
          executedAt: new Date().toISOString()
        };
      }
    }

    if (totalPlanCycles >= maxCycles) {
      console.warn(`⚠️ Robot plan act execution loop reached maximum cycles (${maxCycles}) for site ${site_id}`);
      
      return {
        success: false,
        error: `Plan act execution loop reached maximum cycles (${maxCycles})`,
        instance_id,
        instance_plan_id,
        planResults,
        totalPlanCycles,
        site_id,
        activity,
        user_id,
        executedAt: new Date().toISOString()
      };
    }

    console.log(`✅ Robot execution workflow completed successfully for site: ${site_id}. Total plan act cycles: ${totalPlanCycles}`);

    // Calculate aggregate metrics
    const totalExecutionTime = planResults.reduce((sum, result) => sum + (result.execution_time_ms || 0), 0);
    const totalTokenUsage = planResults.reduce((acc, result) => {
      if (result.token_usage) {
        acc.input_tokens += result.token_usage.input_tokens || 0;
        acc.output_tokens += result.token_usage.output_tokens || 0;
      }
      return acc;
    }, { input_tokens: 0, output_tokens: 0 });
    
    // Get final progress from last result
    const finalProgress = planResults.length > 0 ? planResults[planResults.length - 1].plan_progress : undefined;
    
    console.log(`📊 Final metrics: ${totalExecutionTime}ms total, ${totalTokenUsage.input_tokens + totalTokenUsage.output_tokens} tokens used`);

    return {
      success: true,
      instance_id,
      instance_plan_id: instance_plan_id || planParams.instance_plan_id,
      planResults,
      totalPlanCycles,
      finalProgress,
      totalExecutionTime,
      totalTokenUsage,
      site_id,
      activity,
      user_id,
      executedAt: new Date().toISOString()
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Robot execution workflow exception for site ${site_id}:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      instance_id,
      instance_plan_id,
      site_id,
      activity,
      user_id,
      executedAt: new Date().toISOString()
    };
  }
}
