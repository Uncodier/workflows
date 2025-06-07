/**
 * Build Content Workflow
 * 
 * This workflow generates AI-powered content recommendations for a website.
 * It analyzes the site and suggests content types, topics, and strategies.
 */

import { proxyActivities } from '@temporalio/workflow';
import type { 
  getSiteActivity,
  getDraftContentActivity,
  createContentCalendarActivity,
  improveContentActivity,
  GetSiteResult,
  GetDraftContentResult
} from '../activities/campaignActivities';
import type { logWorkflowExecutionActivity } from '../activities';

// New interfaces for the updated APIs
export interface ContentCalendarRequest {
  siteId: string;
  segmentId?: string;
  campaignId?: string;
  userId?: string;
  agent_id?: string;
  timeframe?: string;
  targetAudience?: string;
  goals?: string[];
  keywords?: string[];
}

export interface ContentImproveRequest {
  siteId: string;
  contentIds?: string[];
  segmentId?: string;
  campaignId?: string;
  userId?: string;
  agent_id?: string;
  improvementGoals?: string[];
  targetAudience?: string | string[];
  keywords?: string[];
  contentStyle?: string;
  maxLength?: number;
  limit?: number;
}

export interface ContentApiResult {
  success: boolean;
  data?: any;
  error?: string;
  recommendations?: any[];
  analysis?: any;
}



// Proxy activities with appropriate timeouts
const { 
  getSiteActivity: getSite,
  getDraftContentActivity: getDraftContent
} = proxyActivities<{
  getSiteActivity: typeof getSiteActivity;
  getDraftContentActivity: typeof getDraftContentActivity;
}>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

const {
  createContentCalendarActivity: createContentCalendar,
  improveContentActivity: improveContent
} = proxyActivities<{
  createContentCalendarActivity: typeof createContentCalendarActivity;
  improveContentActivity: typeof improveContentActivity;
}>({
  startToCloseTimeout: '15 minutes', // Increased timeout for content operations
  retry: {
    maximumAttempts: 3,
  },
});

const {
  logWorkflowExecutionActivity: logExecution
} = proxyActivities<{
  logWorkflowExecutionActivity: typeof logWorkflowExecutionActivity;
}>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 2,
  },
});

export interface BuildContentOptions {
  siteId?: string;                                              // Site ID (legacy)
  site_id: string;                                             // Required: Site ID
  segmentId?: string;                                         // Optional: Target specific segment
  campaignId?: string;                                        // Optional: Campaign ID
  contentTypes?: string[];                                    // Optional: Filter content types (deprecated - now uses contentType string)
  contentType?: string;                                       // Optional: Type of content to be planned
  timeframe?: string;                                         // Optional: Timeframe for content planning
  limit?: number;                                            // Optional: Max recommendations (1-50, default: 50)
  userId?: string;                                           // Optional: User ID
  agent_id?: string;                                         // Optional: Agent ID
  targetAudience?: string;                                   // Optional: Target audience description
  goals?: string[];                                          // Optional: Content marketing goals
  keywords?: string[];                                       // Optional: Focus keywords
  improvementGoals?: string[];                               // Optional: Improvement goals for draft content
  contentStyle?: string;                                     // Optional: Desired content style
  maxLength?: number;                                        // Optional: Max length for improved content
  includeMetadata?: boolean;                                 // Optional: Include detailed metadata (legacy)
  sortBy?: 'relevance' | 'date' | 'popularity';            // Optional: Sort criteria (legacy)
}

export interface BuildContentResult {
  success: boolean;              // Whether the workflow succeeded
  siteId: string;               // Site ID processed
  siteName?: string;            // Site name
  siteUrl?: string;             // Site URL analyzed
  recommendationsGenerated: number; // Number of recommendations created
  contentTypes?: string[];      // Types of content recommended
  contentType?: string;         // Type of content planned
  timeframe?: string;           // Timeframe used
  operationType: 'calendar' | 'improve'; // Operation performed
  recommendations?: any[];      // Content recommendations
  analysis?: any;               // Analysis metadata
  errors: string[];             // List of errors encountered
  executionTime: string;        // Total execution time
  completedAt: string;          // Completion timestamp
}

/**
 * Build Content Workflow
 * 
 * Generates content recommendations for a specific site by:
 * 1. Getting site information from database
 * 2. Checking for draft content
 * 3. If draft content exists: calling content improve API
 * 4. If no draft content: calling content calendar API
 * 5. Processing and returning structured recommendations
 */
export async function buildContentWorkflow(options: BuildContentOptions): Promise<BuildContentResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  // Support both siteId (legacy) and site_id (new)
  const siteId = options.site_id || options.siteId;
  
  if (!siteId) {
    console.error('❌ No site ID provided');
    return {
      success: false,
      siteId: '',
      recommendationsGenerated: 0,
      operationType: 'calendar',
      errors: ['No site ID provided'],
      executionTime: '0s',
      completedAt: new Date().toISOString()
    };
  }
  
  console.log(`📝 Starting buildContentWorkflow for site: ${siteId}`);
  console.log('⚙️  Workflow options:', JSON.stringify(options, null, 2));

  // Log workflow start
  try {
    await logExecution({
      workflowType: 'buildContentWorkflow',
      workflowId: `build-content-${siteId}-${Date.now()}`,
      status: 'STARTED',
      input: options
    });
  } catch (logError) {
    console.warn('⚠️  Failed to log workflow start:', logError);
  }

  // Initialize variables that need to be accessible in catch block
  let hasDraftContent = false;
  let draftCount = 0;
  
  try {
    // Step 1: Get site information
    console.log('🏢 Step 1: Getting site information...');
    const siteResult: GetSiteResult = await getSite(siteId);
    
    if (!siteResult.success || !siteResult.site) {
      const error = siteResult.error || 'Site not found';
      console.error(`❌ Failed to get site information: ${error}`);
      errors.push(`Site fetch failed: ${error}`);
      
      throw new Error(`Site fetch failed: ${error}`);
    }

    const site = siteResult.site;
    console.log(`✅ Retrieved site: ${site.name} (${site.url})`);

    // Step 2: Check for draft content
    console.log('📋 Step 2: Checking for draft content...');
    const draftResult: GetDraftContentResult = await getDraftContent(siteId);
    
    if (draftResult.success && draftResult.draftContents && draftResult.draftContents.length > 0) {
      hasDraftContent = true;
      draftCount = draftResult.draftContents.length;
      console.log(`✅ Found ${draftCount} draft content(s) - will use content improve endpoint`);
    } else {
      console.log('📝 No draft content found - will use content calendar endpoint');
    }

    let contentResult: ContentApiResult;
    let operationType: 'calendar' | 'improve';

    if (hasDraftContent) {
      // Step 3A: Improve existing draft content
      console.log('🔧 Step 3A: Improving existing draft content...');
      operationType = 'improve';
      
      const improveRequest: ContentImproveRequest = {
        siteId: siteId,
        contentIds: options.contentTypes ? undefined : draftResult.draftContents?.map(dc => dc.id), // Use all if no specific IDs
        segmentId: options.segmentId,
        campaignId: options.campaignId,
        userId: options.userId || site.user_id,
        agent_id: options.agent_id,
        improvementGoals: options.improvementGoals,
        targetAudience: options.targetAudience,
        keywords: options.keywords,
        contentStyle: options.contentStyle,
        maxLength: options.maxLength,
        limit: options.limit || 50
      };

      console.log('📊 Content improve request:', JSON.stringify(improveRequest, null, 2));
      console.log(`🎯 Improving ${draftCount} existing draft content(s)`);

      contentResult = await improveContent(improveRequest);
      
    } else {
      // Step 3B: Create new content calendar
      console.log('📅 Step 3B: Creating new content calendar...');
      operationType = 'calendar';
      
      const calendarRequest: ContentCalendarRequest = {
        siteId: siteId,
        segmentId: options.segmentId,
        campaignId: options.campaignId,
        userId: options.userId || site.user_id,
        agent_id: options.agent_id,
        timeframe: options.timeframe || 'month',
        targetAudience: options.targetAudience,
        goals: options.goals,
        keywords: options.keywords
      };

      console.log('📊 Content calendar request:', JSON.stringify(calendarRequest, null, 2));
      console.log(`🎯 Creating content calendar with timeframe: ${calendarRequest.timeframe}`);

      contentResult = await createContentCalendar(calendarRequest);
    }
    
    if (!contentResult.success) {
      const error = contentResult.error || `Failed to ${operationType === 'improve' ? 'improve content' : 'create content calendar'}`;
      console.error(`❌ Content ${operationType} failed: ${error}`);
      errors.push(`Content ${operationType} failed: ${error}`);
      
      throw new Error(`Content ${operationType} failed: ${error}`);
    }

    // Step 4: Process successful result
    const recommendations = contentResult.recommendations || [];
    const analysis = contentResult.analysis || {};
    
    if (operationType === 'improve') {
      console.log(`✅ Successfully improved ${recommendations.length} content recommendations from ${draftCount} draft content(s)`);
    } else {
      console.log(`✅ Successfully created content calendar with ${recommendations.length} content recommendations`);
    }
    console.log('📈 Analysis summary:', JSON.stringify(analysis, null, 2));

    const executionTime = `${(Date.now() - startTime) / 1000}s`;
    const completedAt = new Date().toISOString();

    // Extract content types from recommendations if available
    const recommendedContentTypes = [...new Set(
      recommendations
        .map((rec: any) => rec.type || rec.content_type || rec.contentType)
        .filter(Boolean)
    )];

    const result: BuildContentResult = {
      success: true,
      siteId: siteId,
      siteName: site.name,
      siteUrl: site.url,
      recommendationsGenerated: recommendations.length,
      contentTypes: recommendedContentTypes.length > 0 ? recommendedContentTypes : undefined,
      contentType: options.contentType,
      timeframe: options.timeframe,
      operationType,
      recommendations,
      analysis,
      errors,
      executionTime,
      completedAt
    };

    // Log successful completion
    try {
      await logExecution({
        workflowType: 'buildContentWorkflow',
        workflowId: `build-content-${siteId}-${Date.now()}`,
        status: 'COMPLETED',
        input: options,
        output: {
          recommendationsGenerated: recommendations.length,
          contentTypes: recommendedContentTypes,
          operationType,
          executionTime
        }
      });
    } catch (logError) {
      console.warn('⚠️  Failed to log workflow completion:', logError);
    }

    console.log(`🎉 buildContentWorkflow completed successfully in ${executionTime}`);
    if (operationType === 'improve') {
      console.log(`📊 Improved ${recommendations.length} recommendations from ${draftCount} draft content(s) for ${site.name}`);
    } else {
      console.log(`📊 Created content calendar with ${recommendations.length} recommendations for ${site.name}`);
    }
    
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ buildContentWorkflow failed:`, errorMessage);
    errors.push(`Workflow error: ${errorMessage}`);

    // Log failure
    try {
      await logExecution({
        workflowType: 'buildContentWorkflow',
        workflowId: `build-content-${siteId}-${Date.now()}`,
        status: 'FAILED',
        input: options,
        error: errorMessage
      });
    } catch (logError) {
      console.warn('⚠️  Failed to log workflow failure:', logError);
    }

    // Return failure result
    const executionTime = `${(Date.now() - startTime) / 1000}s`;
    return {
      success: false,
      siteId: siteId,
      recommendationsGenerated: 0,
      operationType: hasDraftContent ? 'improve' : 'calendar',
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };
  }
} 