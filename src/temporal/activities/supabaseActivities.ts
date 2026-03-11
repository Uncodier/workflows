// Temporary implementation without Supabase
// TODO: Implement actual Supabase integration when credentials are available

import { getSupabaseService } from '../services/supabaseService';

/**
 * Activity to log workflow execution
 */
export async function logWorkflowExecutionActivity(data: {
  workflowId: string;
  workflowType: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
}): Promise<any> {
  console.log('Workflow Execution Log:', JSON.stringify(data, null, 2));
  
  // Actually save to Supabase commands log if possible
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (isConnected) {
      // Just log that we would save it, actual implementation depends on tables
      console.log(`[Database] Would save execution log for ${data.workflowId} (${data.status})`);
    }
  } catch (e) {
    console.error('Failed to log to database:', e);
  }
  
  return { id: Date.now(), ...data };
}

/**
 * Activity to track API call metrics (temporary console implementation)
 */
export async function trackApiCallActivity(data: {
  endpoint: string;
  method: string;
  statusCode: number;
  duration: number;
  workflowId?: string;
  error?: string;
}): Promise<any> {
  console.log('API Call Metrics:', JSON.stringify(data, null, 2));
  return { id: Date.now(), ...data };
}

/**
 * Activity to fetch configuration (temporary implementation)
 */
export async function fetchConfigurationActivity(configName: string): Promise<any> {
  const mockConfig = {
    name: configName,
    value: {
      enabled: true,
      retryAttempts: 3,
      timeout: '1m',
    }
  };
  console.log('Fetching Configuration:', mockConfig);
  return mockConfig.value;
}

/**
 * Activity to store workflow results and analysis 
 */
export async function storeWorkflowResultActivity(data: {
  workflowId: string;
  result: any;
  metadata?: Record<string, any>;
}): Promise<any> {
  console.log('Storing Workflow Result:', JSON.stringify(data.workflowId));
  
  try {
    // If it's a site analysis, let's actually save it to the analysis table
    if (data.metadata?.type === 'site_analysis' && data.metadata?.siteId) {
      console.log(`[Database] Saving site analysis for ${data.metadata.siteId}`);
      const supabaseService = getSupabaseService();
      
      const userId = data.metadata.userId && data.metadata.userId !== '' ? data.metadata.userId : '00000000-0000-0000-0000-000000000000';
      
      const { error } = await (supabaseService as any).client.from('analysis').insert({
        site_id: data.metadata.siteId,
        url_path: data.metadata.url || '/',
        structure: data.result,
        user_id: userId,
        status: 'completed',
        provider: 'uncodie-ai',
        request_time: 1
      });
      
      if (error) {
        console.error('❌ Error saving analysis to database:', error);
      } else {
        console.log(`✅ Successfully saved analysis for ${data.metadata.siteId}`);
      }
    }
  } catch (e) {
    console.error('Failed to store workflow result:', e);
  }
  
  return { id: Date.now(), ...data };
}

/**
 * Activity to create a resource (temporary implementation)
 */
export async function createResourceActivity(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log('Creating Resource:', JSON.stringify(data, null, 2));
  return { id: Date.now(), ...data };
}

/**
 * Activity to update a resource (temporary implementation)
 */
export async function updateResourceActivity(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log('Updating Resource:', id, JSON.stringify(data, null, 2));
  return { id, ...data, updatedAt: new Date().toISOString() };
}

/**
 * Activity to delete a resource (temporary implementation)
 */
export async function deleteResourceActivity(id: string): Promise<void> {
  console.log('Deleting Resource:', id);
}

/**
 * Check if a site has analysis records
 */
export async function checkSiteAnalysisActivity(siteId: string): Promise<{
  hasAnalysis: boolean;
  lastAnalysis?: any;
  count: number;
  reason: string;
}> {
  console.log(`🔍 Checking if site ${siteId} has analysis records...`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️ Database not available, assuming no analysis');
      return {
        hasAnalysis: false,
        count: 0,
        reason: 'Database not available - assuming needs analysis'
      };
    }

    const analysisStatus = await supabaseService.hasSiteAnalysis(siteId);
    
    const reason = analysisStatus.hasAnalysis 
      ? `Site has ${analysisStatus.count} completed analysis record(s), last one from ${analysisStatus.lastAnalysis?.created_at || 'unknown date'}`
      : 'No completed analysis found - needs initial site analysis';
    
    console.log(`📊 Site ${siteId} analysis check: ${analysisStatus.hasAnalysis ? 'HAS ANALYSIS' : 'NEEDS ANALYSIS'}`);
    console.log(`   Reason: ${reason}`);
    
    return {
      ...analysisStatus,
      reason
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error checking site analysis for ${siteId}:`, errorMessage);
    
    // In case of error, assume no analysis to be safe and allow scheduling
    return {
      hasAnalysis: false,
      count: 0,
      reason: `Error checking analysis (${errorMessage}) - assuming needs analysis for safety`
    };
  }
} 