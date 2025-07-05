import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { 
  UxAnalysisRequest,
  UxAnalysisResponse,
  UxAssimilateRequest,
  UxAssimilateResponse,
  UxExperimentsRequest,
  UxExperimentsResponse
} from '../activities/uxActivities';

// Define the activity interface with common activities
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

// Import specific UX activities
const {
  uxAnalysisActivity,
  uxAssimilateActivity,
  uxExperimentsActivity,
} = proxyActivities<{
  uxAnalysisActivity: (request: UxAnalysisRequest) => Promise<UxAnalysisResponse>;
  uxAssimilateActivity: (request: UxAssimilateRequest) => Promise<UxAssimilateResponse>;
  uxExperimentsActivity: (request: UxExperimentsRequest) => Promise<UxExperimentsResponse>;
}>({
  startToCloseTimeout: '10 minutes', // Longer timeout for UX analysis processes
  retry: {
    maximumAttempts: 3,
  },
});

export interface AnalyzeSiteOptions {
  site_id: string;                    // Required: Site ID
  userId?: string;
  additionalData?: any;
}

export interface AnalyzeSiteResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  analysisResult?: UxAnalysisResponse;
  assimilateResult?: UxAssimilateResponse;
  experimentsResult?: UxExperimentsResponse;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to analyze a site using UX agents
 * 
 * Este workflow ejecuta 3 actividades en secuencia:
 * 1. UX Analysis - Analiza el sitio web
 * 2. UX Assimilate - Procesa y asimila la información
 * 3. UX Experiments - Genera experimentos basados en el análisis
 * 
 * @param options - Configuration options for site analysis
 */
export async function analyzeSiteWorkflow(
  options: AnalyzeSiteOptions
): Promise<AnalyzeSiteResult> {
  const { site_id } = options;
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `analyze-site-${site_id}`;
  const startTime = Date.now();
  
  console.log(`🔍 Starting site analysis workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'analyzeSiteWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `analyze-site-${site_id}`,
    activityName: 'analyzeSiteWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let analysisResult: UxAnalysisResponse | undefined;
  let assimilateResult: UxAssimilateResponse | undefined;
  let experimentsResult: UxExperimentsResponse | undefined;
  let siteName = '';
  let siteUrl = '';

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information
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

    // Step 2: UX Analysis
    console.log(`🔍 Step 2: Running UX Analysis...`);
    
    const analysisRequest: UxAnalysisRequest = {
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: {
        ...options.additionalData,
        siteName: siteName,
        siteUrl: siteUrl
      }
    };
    
    analysisResult = await uxAnalysisActivity(analysisRequest);
    
    if (!analysisResult.success) {
      const warningMsg = `UX Analysis failed: ${analysisResult.error?.message}`;
      console.warn(`⚠️ ${warningMsg}`);
      errors.push(warningMsg);
      // Don't throw error, continue with next step
    } else {
      console.log(`✅ UX Analysis completed successfully`);
    }

    // Step 3: UX Assimilate
    console.log(`🧠 Step 3: Running UX Assimilation...`);
    
    const assimilateRequest: UxAssimilateRequest = {
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: {
        ...options.additionalData,
        siteName: siteName,
        siteUrl: siteUrl,
        analysisResult: analysisResult
      }
    };
    
    assimilateResult = await uxAssimilateActivity(assimilateRequest);
    
    if (!assimilateResult.success) {
      const warningMsg = `UX Assimilation failed: ${assimilateResult.error?.message}`;
      console.warn(`⚠️ ${warningMsg}`);
      errors.push(warningMsg);
      // Don't throw error, continue with next step
    } else {
      console.log(`✅ UX Assimilation completed successfully`);
    }

    // Step 4: UX Experiments
    console.log(`🧪 Step 4: Running UX Experiments...`);
    
    const experimentsRequest: UxExperimentsRequest = {
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: {
        ...options.additionalData,
        siteName: siteName,
        siteUrl: siteUrl,
        analysisResult: analysisResult,
        assimilateResult: assimilateResult
      }
    };
    
    experimentsResult = await uxExperimentsActivity(experimentsRequest);
    
    if (!experimentsResult.success) {
      const warningMsg = `UX Experiments failed: ${experimentsResult.error?.message}`;
      console.warn(`⚠️ ${warningMsg}`);
      errors.push(warningMsg);
      // Don't throw error, continue to completion
    } else {
      console.log(`✅ UX Experiments completed successfully`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    const result: AnalyzeSiteResult = {
      success: true,
      siteId: site_id,
      siteName,
      siteUrl,
      analysisResult,
      assimilateResult,
      experimentsResult,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Site analysis workflow completed successfully!`);
    console.log(`📊 Summary: Site analysis for ${siteName} completed in ${executionTime}`);
    console.log(`   - Site: ${siteName} (${siteUrl})`);
    console.log(`   - Analysis success: ${analysisResult?.success || false}`);
    console.log(`   - Assimilation success: ${assimilateResult?.success || false}`);
    console.log(`   - Experiments success: ${experimentsResult?.success || false}`);
    console.log(`   - Errors: ${errors.length}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `analyze-site-${site_id}`,
      activityName: 'analyzeSiteWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'analyzeSiteWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Site analysis workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `analyze-site-${site_id}`,
      activityName: 'analyzeSiteWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'analyzeSiteWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: AnalyzeSiteResult = {
      success: false,
      siteId: site_id,
      siteName,
      siteUrl,
      analysisResult,
      assimilateResult,
      experimentsResult,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 