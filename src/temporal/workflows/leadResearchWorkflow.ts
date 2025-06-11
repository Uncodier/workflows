import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  leadResearchActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', // Reasonable timeout for lead research
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadResearchOptions {
  lead_id: string;                    // Required: Lead ID
  site_id: string;                    // Required: Site ID
  userId?: string;
  additionalData?: any;
}

export interface LeadResearchResult {
  success: boolean;
  leadId: string;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  researchData?: any;
  insights?: any[];
  recommendations?: string[];
  data?: any;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to execute lead research
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain site details
 * 2. Executes lead research using the sales agent API
 * 
 * @param options - Configuration options for lead research
 */
export async function leadResearchWorkflow(
  options: LeadResearchOptions
): Promise<LeadResearchResult> {
  const { lead_id, site_id } = options;
  
  if (!lead_id) {
    throw new Error('No lead ID provided');
  }
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `lead-research-${lead_id}-${site_id}`;
  const startTime = Date.now();
  
  console.log(`🔍 Starting lead research workflow for lead ${lead_id} on site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadResearchWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `lead-research-${lead_id}-${site_id}`,
    activityName: 'leadResearchWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let researchData: any = null;
  let insights: any[] = [];
  let recommendations: string[] = [];
  let siteName = '';
  let siteUrl = '';
  let data: any = null;

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information to obtain site details
    const siteResult = await getSiteActivity(site_id);
    
    if (!siteResult.success) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    console.log(`🔍 Step 2: Executing lead research for lead ${lead_id}...`);
    
    // Prepare lead research request
    const researchRequest = {
      lead_id: lead_id,
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: options.additionalData
    };
    
    console.log(`🔧 Lead research configuration:`);
    console.log(`   - Lead ID: ${researchRequest.lead_id}`);
    console.log(`   - Site ID: ${researchRequest.site_id}`);
    console.log(`   - User ID: ${researchRequest.userId}`);
    
    // Execute lead research
    const researchResult = await leadResearchActivity(researchRequest);
    
    if (!researchResult.success) {
      const errorMsg = `Failed to execute lead research: ${researchResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    researchData = researchResult.researchData || researchResult.data;
    insights = researchResult.insights || [];
    recommendations = researchResult.recommendations || [];
    data = researchResult.data;
    
    console.log(`✅ Successfully executed lead research for lead ${lead_id}`);
    console.log(`📊 Results: ${insights.length} insights, ${recommendations.length} recommendations`);
    
    if (insights.length > 0) {
      console.log(`🔍 Research insights:`);
      insights.forEach((insight, index) => {
        console.log(`   ${index + 1}. ${insight.title || insight.summary || insight.description || `Insight ${index + 1}`}`);
      });
    }
    
    if (recommendations.length > 0) {
      console.log(`💡 Recommendations:`);
      recommendations.forEach((recommendation, index) => {
        console.log(`   ${index + 1}. ${recommendation}`);
      });
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: LeadResearchResult = {
      success: true,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      researchData,
      insights,
      recommendations,
      data,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead research workflow completed successfully!`);
    console.log(`📊 Summary: Lead ${lead_id} research completed for ${siteName} in ${executionTime}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-research-${lead_id}-${site_id}`,
      activityName: 'leadResearchWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadResearchWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Lead research workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-research-${lead_id}-${site_id}`,
      activityName: 'leadResearchWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadResearchWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: LeadResearchResult = {
      success: false,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      researchData,
      insights,
      recommendations,
      data,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 