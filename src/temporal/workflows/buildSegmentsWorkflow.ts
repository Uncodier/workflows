import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  buildNewSegmentsActivity,
  buildICPSegmentsActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes', // Longer timeout for segment building
  retry: {
    maximumAttempts: 3,
  },
});

export interface BuildSegmentsOptions {
  siteId?: string;                    // Site ID (legacy)
  site_id: string;                    // Required: Site ID
  segmentCount?: number;
  mode?: 'analyze' | 'create' | 'update';
  timeout?: number;
  userId?: string;
  includeScreenshot?: boolean;
  profitabilityMetrics?: string[];
  minConfidenceScore?: number;
  segmentAttributes?: string[];
  industryContext?: string;
  additionalInstructions?: string;
  aiProvider?: 'openai' | 'anthropic' | 'gemini';
  aiModel?: string;
}

export interface BuildSegmentsResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  segmentsBuilt: number;
  mode: string;
  segments?: any[];
  analysis?: any;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to build segments for a site
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain the URL
 * 2. Builds segments using the site's URL via the segments API
 * 
 * @param options - Configuration options for segment building
 */
export async function buildSegmentsWorkflow(
  options: BuildSegmentsOptions
): Promise<BuildSegmentsResult> {
  // Support both siteId (legacy) and site_id (new)
  const siteId = options.site_id || options.siteId;
  
  if (!siteId) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `build-segments-${siteId}`;
  const startTime = Date.now();
  
  console.log(`🎯 Starting build segments workflow for site ${siteId}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'buildSegmentsWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: siteId,
    workflowId,
    scheduleId: `build-segments-${siteId}`,
    activityName: 'buildSegmentsWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let segments: any[] = [];
  let analysis: any = null;
  let segmentsBuilt = 0;
  let siteName = '';
  let siteUrl = '';

  try {
    console.log(`🏢 Step 1: Getting site information for ${siteId}...`);
    
    // Get site information to obtain the URL
    const siteResult = await getSiteActivity(siteId);
    
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
    
    if (!siteUrl) {
      const errorMsg = `Site ${siteId} has no URL configured`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    console.log(`🎯 Step 2: Building segments for ${siteName}...`);
    
    // Prepare segment building request for new API
    const segmentRequest = {
      siteId: siteId,
      userId: options.userId || site.user_id,
      segmentData: {
        segmentCount: options.segmentCount || 5
      }
    };
    
    console.log(`🔧 Segment building configuration:`);
    console.log(`   - Site ID: ${segmentRequest.siteId}`);
    console.log(`   - User ID: ${segmentRequest.userId}`);
    console.log(`   - Segment count: ${segmentRequest.segmentData.segmentCount}`);
    
    // Step 1: Build segments using the new segments API
    console.log(`📊 Step 2a: Building general segments...`);
    const segmentResult = await buildNewSegmentsActivity(segmentRequest);
    
    if (!segmentResult.success) {
      const errorMsg = `Failed to build segments: ${segmentResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    segments = segmentResult.segments || [];
    analysis = segmentResult.analysis;
    segmentsBuilt = segments.length;
    
    console.log(`✅ General segments built: ${segmentsBuilt}`);
    
    // Step 2: Build ICP segments using the ICP API
    console.log(`🎯 Step 2b: Building ICP segments...`);
    const icpResult = await buildICPSegmentsActivity(segmentRequest);
    
    if (icpResult.success) {
      const icpSegments = icpResult.segments || [];
      console.log(`✅ ICP segments built: ${icpSegments.length}`);
      
      // Combine both results
      segments = [...segments, ...icpSegments];
      segmentsBuilt = segments.length;
      
      // Merge analysis if available
      if (icpResult.analysis) {
        analysis = {
          general: analysis,
          icp: icpResult.analysis
        };
      }
    } else {
      console.log(`⚠️ ICP segments failed: ${icpResult.error || 'Unknown error'}`);
      errors.push(`ICP segments failed: ${icpResult.error || 'Unknown error'}`);
    }
    
    console.log(`✅ Successfully built segments for ${siteName}`);
    console.log(`📊 Results: ${segmentsBuilt} total segments created`);
    if (segments.length > 0) {
      console.log(`🎯 Segments overview:`);
      segments.forEach((segment, index) => {
        console.log(`   ${index + 1}. ${segment.name || segment.title || `Segment ${index + 1}`}`);
      });
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: BuildSegmentsResult = {
      success: true,
      siteId: siteId,
      siteName,
      siteUrl,
      segmentsBuilt,
      mode: 'create', // Default mode for new API
      segments,
      analysis,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Build segments workflow completed successfully!`);
    console.log(`📊 Summary: ${segmentsBuilt} total segments built for ${siteName} in ${executionTime}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: siteId,
      workflowId,
      scheduleId: `build-segments-${siteId}`,
      activityName: 'buildSegmentsWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'buildSegmentsWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Build segments workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: siteId,
      workflowId,
      scheduleId: `build-segments-${siteId}`,
      activityName: 'buildSegmentsWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'buildSegmentsWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: BuildSegmentsResult = {
      success: false,
      siteId: siteId,
      siteName,
      siteUrl,
      segmentsBuilt,
      mode: 'create', // Default mode for new API
      segments,
      analysis,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 