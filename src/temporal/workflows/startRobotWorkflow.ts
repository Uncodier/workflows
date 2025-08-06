import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';



// Define the activity interface and options
const { 
  callRobotInstanceActivity,
  callRobotPlanActivity
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
}

export interface StartRobotResult {
  success: boolean;
  instance_id?: string;
  instanceData?: any;
  planData?: any;
  error?: string;
  site_id: string;
  activity: string;
  user_id?: string;
  executedAt: string;
}

/**
 * Workflow to start robot planning for a specific site and activity
 * 
 * This workflow makes two sequential API calls:
 * 1. POST /api/robots/instance - Creates/prepares robot instance, returns instance_id
 * 2. POST /api/agents/growth/robot/plan - Executes robot planning using the instance_id
 * 
 * First call receives: site_id, activity, and optionally user_id
 * Second call receives: site_id, activity, instance_id (from step 1), and optionally user_id
 */
export async function startRobotWorkflow(input: StartRobotInput): Promise<StartRobotResult> {
  const { site_id, activity, user_id } = input;
  
  console.log(`🚀 Starting robot workflow for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}`);

  try {
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
      
      return {
        success: false,
        error: `Instance call failed: ${instanceResult.error}`,
        site_id,
        activity,
        user_id,
        executedAt: new Date().toISOString()
      };
    }

    // Validate instance_id was returned
    if (!instanceResult.instance_id) {
      console.error(`❌ No instance_id returned from robot instance API for site ${site_id}`);
      
      return {
        success: false,
        error: 'Instance API did not return instance_id',
        instanceData: instanceResult.data,
        site_id,
        activity,
        user_id,
        executedAt: new Date().toISOString()
      };
    }

    const instance_id = instanceResult.instance_id;
    console.log(`✅ Robot instance call completed successfully. Instance ID: ${instance_id}`);

    // Step 2: Call robot plan API with instance_id
    console.log(`🔄 Step 2: Calling robot plan API with instance_id: ${instance_id}...`);
    
    const planParams: any = {
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
      
      return {
        success: false,
        error: `Plan call failed: ${planResult.error}`,
        instanceData: instanceResult.data,
        site_id,
        activity,
        user_id,
        executedAt: new Date().toISOString()
      };
    }

    console.log(`✅ Robot workflow completed successfully for site: ${site_id}`);

    return {
      success: true,
      instance_id,
      instanceData: instanceResult.data,
      planData: planResult.data,
      site_id,
      activity,
      user_id,
      executedAt: new Date().toISOString()
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Robot workflow exception for site ${site_id}:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      site_id,
      activity,
      user_id,
      executedAt: new Date().toISOString()
    };
  }
}