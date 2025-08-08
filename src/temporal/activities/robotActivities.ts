import { apiService } from '../services/apiService';


/**
 * Activity to start the robot stream display
 */
export async function startRobotStreamActivity(params: {
  site_id: string;
  activity: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  const { site_id, activity, user_id } = params;

  console.log(`📺 Starting robot stream for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Build request payload, only include user_id if provided
    const payload: any = {
      site_id,
      activity
    };
    
    if (user_id) {
      payload.user_id = user_id;
    }

    const response = await apiService.post('/api/robots/stream/start', payload);

    if (!response.success) {
      throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
    }

    console.log('✅ Robot stream started successfully');
    
    return {
      success: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('❌ Robot operation failed:', error);
    throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to stop the robot stream display
 */
export async function stopRobotStreamActivity(params: {
  site_id: string;
  activity: string;
  instance_id?: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  const { site_id, activity, instance_id, user_id } = params;

  console.log(`📺 Stopping robot stream for site: ${site_id}, activity: ${activity}${instance_id ? `, instance: ${instance_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Build request payload, include available data
    const payload: any = {
      site_id,
      activity
    };
    
    if (instance_id) {
      payload.instance_id = instance_id;
    }
    
    if (user_id) {
      payload.user_id = user_id;
    }

    const response = await apiService.post('/api/robots/stream/stop', payload);

    if (!response.success) {
      throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
    }

    console.log('✅ Robot stream stopped successfully');
    
    return {
      success: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('❌ Robot operation failed:', error);
    throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to call the robot instance API
 */
export async function callRobotInstanceActivity(params: {
  site_id: string;
  activity: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  instance_id?: string;
  data?: any;
  error?: string;
}> {
  const { site_id, activity, user_id } = params;

  console.log(`🤖 Calling robot instance API for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Build request payload, only include user_id if provided
    const payload: any = {
      site_id,
      activity
    };
    
    if (user_id) {
      payload.user_id = user_id;
    }

    const response = await apiService.post('/api/robots/instance', payload);

    if (!response.success) {
      throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
    }

    console.log('✅ Robot instance API call successful');
    
    // Extract instance_id from response
    const instance_id = response.data?.instance_id;
    
    if (!instance_id) {
      console.warn('⚠️ No instance_id returned from robot/instance API');
    }
    
    return {
      success: true,
      instance_id,
      data: response.data
    };
    
  } catch (error) {
    console.error('❌ Robot operation failed:', error);
    throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to call the robot plan API
 */
export async function callRobotPlanActivity(params: {
  site_id: string;
  activity: string;
  instance_id: string;
  instance_plan_id?: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  plan_completed?: boolean;
  instance_plan_id?: string;
}> {
  const { site_id, activity, instance_id, instance_plan_id, user_id } = params;

  console.log(`🤖 Calling robot plan API for site: ${site_id}, activity: ${activity}, instance: ${instance_id}${instance_plan_id ? `, plan: ${instance_plan_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Build request payload, always include instance_id, optionally include instance_plan_id and user_id
    const payload: any = {
      site_id,
      activity,
      instance_id
    };
    
    if (instance_plan_id) {
      payload.instance_plan_id = instance_plan_id;
    }
    
    if (user_id) {
      payload.user_id = user_id;
    }

    const response = await apiService.post('/api/agents/growth/robot/plan', payload);

    if (!response.success) {
      throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
    }

    console.log('✅ Robot plan API call successful');
    
    // Handle nested data structure: response.data.data (consistent with other APIs)
    const actualData = response.data?.data || response.data;
    console.log(`🔍 Full API response structure:`, JSON.stringify(response, null, 2));
    
    // Extract plan_completed and instance_plan_id from nested data
    const plan_completed = actualData?.plan_completed ?? false;
    const returned_instance_plan_id = actualData?.instance_plan_id;
    
    console.log(`📊 Plan completion status: ${plan_completed}`);
    if (returned_instance_plan_id) {
      console.log(`🆔 Instance plan ID: ${returned_instance_plan_id}`);
    }
    
    return {
      success: true,
      data: actualData, // Return the actual nested data, not the wrapper
      plan_completed,
      instance_plan_id: returned_instance_plan_id
    };
    
  } catch (error) {
    console.error('❌ Robot operation failed:', error);
    throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to call the robot plan act API for execution loop
 * This is specifically for the robotWorkflow execution phase
 */
export async function callRobotPlanActActivity(params: {
  site_id: string;
  activity: string;
  instance_id: string;
  instance_plan_id?: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  plan_completed?: boolean;
  instance_plan_id?: string;
}> {
  const { site_id, activity, instance_id, instance_plan_id, user_id } = params;

  console.log(`⚡ Calling robot plan act API for site: ${site_id}, activity: ${activity}, instance: ${instance_id}${instance_plan_id ? `, plan: ${instance_plan_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Build request payload, always include instance_id, optionally include instance_plan_id and user_id
    const payload: any = {
      site_id,
      activity,
      instance_id
    };
    
    if (instance_plan_id) {
      payload.instance_plan_id = instance_plan_id;
    }
    
    if (user_id) {
      payload.user_id = user_id;
    }

    const response = await apiService.post('/api/robots/plan/act', payload);

    if (!response.success) {
      throw new Error(`Robot plan act API call failed: ${response.error?.message || 'Unknown error'}`);
    }

    console.log('✅ Robot plan act API call successful');
    
    // Handle nested data structure: response.data.data
    const actualData = response.data?.data || response.data;
    console.log(`🔍 Full API response structure:`, JSON.stringify(response, null, 2));
    
    // Extract plan_completed and instance_plan_id from nested data
    const plan_completed = actualData?.plan_completed ?? false;
    const returned_instance_plan_id = actualData?.instance_plan_id;
    
    console.log(`📊 Plan completion status: ${plan_completed}`);
    if (returned_instance_plan_id) {
      console.log(`🆔 Instance plan ID: ${returned_instance_plan_id}`);
    }
    
    return {
      success: true,
      data: actualData, // Return the actual nested data, not the wrapper
      plan_completed,
      instance_plan_id: returned_instance_plan_id
    };
    
  } catch (error) {
    console.error('❌ Robot plan act operation failed:', error);
    throw new Error(`Robot plan act activity failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

