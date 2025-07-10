// Temporary implementation without Supabase
// TODO: Implement actual Supabase integration when credentials are available

import { getSupabaseService } from '../services/supabaseService';

/**
 * Activity to log workflow execution (temporary console implementation)
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
 * Activity to store workflow results (temporary console implementation)
 */
export async function storeWorkflowResultActivity(data: {
  workflowId: string;
  result: any;
  metadata?: Record<string, any>;
}): Promise<any> {
  console.log('Storing Workflow Result:', JSON.stringify(data, null, 2));
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