import { apiService } from '../services/apiService';

/**
 * CMO Daily Stand Up Activities
 * Activities for calling external CMO agent APIs
 */

export interface DailyStandUpRequest {
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface DailyStandUpResponse {
  success: boolean;
  command_id?: string;
  summary?: string;
  data?: any;
  error?: string;
}

/**
 * Activity to analyze system status, settings, and billing via external CMO agent
 */
export async function cmoSystemAnalysisActivity(request: DailyStandUpRequest): Promise<DailyStandUpResponse> {
  console.log(`🔧 Running CMO system analysis for site: ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    // Use extended timeout for CMO analysis operations (5 minutes)
    const response = await apiService.request('/api/agents/cmo/dailyStandUp/system', {
      method: 'POST',
      body: request,
      timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
    });

    if (!response.success) {
      console.error(`❌ CMO system analysis failed:`, response.error);
      throw new Error(`Failed to run system analysis: ${response.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ CMO system analysis completed successfully`);
    console.log(`📊 Command ID: ${response.data?.command_id}`);

    return {
      success: true,
      ...response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ CMO system analysis exception: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to get sales summary from external sales agent via CMO coordination
 */
export async function cmoSalesAnalysisActivity(request: DailyStandUpRequest & { command_id?: string }): Promise<DailyStandUpResponse> {
  console.log(`💰 Running CMO sales analysis for site: ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    // Use extended timeout for CMO analysis operations (5 minutes)
    const response = await apiService.request('/api/agents/cmo/dailyStandUp/sales', {
      method: 'POST',
      body: request,
      timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
    });

    if (!response.success) {
      console.error(`❌ CMO sales analysis failed:`, response.error);
      throw new Error(`Failed to run sales analysis: ${response.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ CMO sales analysis completed successfully`);
    console.log(`📊 Command ID: ${response.data?.command_id}`);

    return {
      success: true,
      ...response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ CMO sales analysis exception: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to analyze support tasks and conversations via external support agent coordination
 */
export async function cmoSupportAnalysisActivity(request: DailyStandUpRequest & { command_id?: string }): Promise<DailyStandUpResponse> {
  console.log(`🎧 Running CMO support analysis for site: ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    // Use extended timeout for CMO analysis operations (5 minutes)
    const response = await apiService.request('/api/agents/cmo/dailyStandUp/support', {
      method: 'POST',
      body: request,
      timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
    });

    if (!response.success) {
      console.error(`❌ CMO support analysis failed:`, response.error);
      throw new Error(`Failed to run support analysis: ${response.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ CMO support analysis completed successfully`);
    console.log(`📊 Command ID: ${response.data?.command_id}`);

    return {
      success: true,
      ...response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ CMO support analysis exception: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to analyze growth content and experiments via external growth agent coordination
 */
export async function cmoGrowthAnalysisActivity(request: DailyStandUpRequest & { command_id?: string }): Promise<DailyStandUpResponse> {
  console.log(`📈 Running CMO growth analysis for site: ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    // Use extended timeout for CMO analysis operations (5 minutes)
    const response = await apiService.request('/api/agents/cmo/dailyStandUp/growth', {
      method: 'POST',
      body: request,
      timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
    });

    if (!response.success) {
      console.error(`❌ CMO growth analysis failed:`, response.error);
      throw new Error(`Failed to run growth analysis: ${response.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ CMO growth analysis completed successfully`);
    console.log(`📊 Command ID: ${response.data?.command_id}`);

    return {
      success: true,
      ...response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ CMO growth analysis exception: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to wrap up all memories and create final summary via external CMO agent
 */
export async function cmoWrapUpActivity(request: DailyStandUpRequest & { command_id?: string }): Promise<DailyStandUpResponse> {
  console.log(`📋 Running CMO wrap up for site: ${request.site_id}`);
  console.log(`📊 Command ID: ${request.command_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    // Use extended timeout for CMO wrap up operations (5 minutes)
    const response = await apiService.request('/api/agents/cmo/dailyStandUp/wrapUp', {
      method: 'POST',
      body: request,
      timeout: 300000 // 5 minutes timeout (300,000ms) for CMO wrap up
    });

    if (!response.success) {
      console.error(`❌ CMO wrap up failed:`, response.error);
      throw new Error(`Failed to run wrap up: ${response.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ CMO wrap up completed successfully`);
    console.log(`📊 Final summary available`);

    return {
      success: true,
      ...response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ CMO wrap up exception: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 