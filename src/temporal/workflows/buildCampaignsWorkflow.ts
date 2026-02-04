import { proxyActivities, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { CreateCampaignRequest } from '../activities/campaignActivities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';

// Configure critical activities with standard retry policy
const {
  getSiteActivity,
  getSegmentsActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DEFAULT,
  retry: RETRY_POLICIES.DEFAULT,
});

// Configure campaign activities with retry policy for critical campaign creation
const {
  createCampaignsActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DEFAULT,
  retry: RETRY_POLICIES.DEFAULT, // Enable retries for campaign creation
});

// Configure non-critical campaign requirements with no retry policy
const {
  createCampaignRequirementsActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DEFAULT,
  retry: RETRY_POLICIES.NO_RETRY, // No retries for campaign requirements creation
});

export interface BuildCampaignsWorkflowParams {
  siteId?: string;
  site_id?: string; // Support both formats
  userId?: string;
  campaignData: {
    segmentIds?: string[];
    [key: string]: any;
  };
}

export interface BuildCampaignsWorkflowResult {
  success: boolean;
  campaign?: any;
  requirements?: any;
  siteInfo?: any;
  segmentsUsed?: any[];
  error?: string;
  processed: boolean;
  reason: string;
  warnings?: string[]; // New field to track non-critical failures
}

/**
 * Build Campaigns Workflow
 * Creates marketing campaigns for a specific site using the provided campaign data
 */
export async function buildCampaignsWorkflow(
  params: BuildCampaignsWorkflowParams
): Promise<BuildCampaignsWorkflowResult> {
  // Support both siteId (legacy) and site_id (new format)
  const siteId = params.siteId || params.site_id;
  
  console.log('🚀 Starting build campaigns workflow...');
  console.log(`🏢 Site ID: ${siteId}`);
  console.log(`🆔 User ID: ${params.userId || 'not specified'}`);
  console.log(`📊 Campaign Data:`, JSON.stringify(params.campaignData, null, 2));
  
  // Validate required parameters
  if (!siteId) {
    const errorMessage = 'Site ID is required but not provided';
    console.error(`❌ ${errorMessage}`);
    throw new Error(errorMessage);
  }

  const searchAttributes: Record<string, string[]> = {
    site_id: [siteId],
  };
  if (params.userId) {
    searchAttributes.user_id = [params.userId];
  }
  upsertSearchAttributes(searchAttributes);

  try {
    // 1. Validate site exists and get site information
    console.log('🔍 Validating site...');
    const siteResult = await getSiteActivity(siteId);
    
    if (!siteResult.success) {
      const errorMessage = `Site validation failed: ${siteResult.error}`;
      console.error(`❌ ${errorMessage}`);
      
      // If site not found, this is a critical error that should fail the workflow
      if (siteResult.error === 'Site not found') {
        throw new Error(`Site ${siteId} not found`);
      }
      
      throw new Error(siteResult.error || 'Site validation failed');
    }
    
    if (!siteResult.site) {
      const errorMessage = `Site ${siteId} data is invalid or empty`;
      console.error(`❌ ${errorMessage}`);
      throw new Error(errorMessage);
    }
    
    console.log(`✅ Site validated: ${siteResult.site.name} (${siteResult.site.url})`);
    
    // 2. If segmentIds are provided, validate they exist
    let segmentsUsed: any[] = [];
    if (params.campaignData?.segmentIds && params.campaignData.segmentIds.length > 0) {
      console.log('🎯 Validating segments...');
      const segmentsResult = await getSegmentsActivity(siteId);
      
      if (segmentsResult.success && segmentsResult.segments) {
        // Filter to only include segments that exist
        const existingSegmentIds = segmentsResult.segments.map(s => s.id);
        const validSegmentIds = params.campaignData.segmentIds.filter(id => 
          existingSegmentIds.includes(id)
        );
        
        if (validSegmentIds.length === 0) {
          console.log('⚠️ No valid segments found, proceeding without specific segments');
        } else {
          segmentsUsed = segmentsResult.segments.filter(s => 
            validSegmentIds.includes(s.id)
          );
          console.log(`✅ Using ${segmentsUsed.length} valid segments:`, 
            segmentsUsed.map(s => s.name).join(', '));
          
          // Update campaign data with only valid segment IDs
          params.campaignData.segmentIds = validSegmentIds;
        }
      } else {
        console.log('⚠️ Could not fetch segments, proceeding without segment validation');
      }
    } else {
      console.log('📋 No specific segments provided, creating general campaigns');
    }
    
    // 3. Create the campaigns using validated site and segment information
    console.log('🛠️ Creating campaigns...');
    const campaignRequest: CreateCampaignRequest = {
      siteId: siteResult.site.id,  // Use the validated site ID from getSiteActivity
      userId: params.userId || siteResult.site.user_id,  // Use provided userId or fall back to site owner
      campaignData: {
        ...(params.campaignData || {}),
        // Use only the validated segment IDs (already filtered above)
        segmentIds: params.campaignData?.segmentIds || []
      }
    };
    
    console.log('📋 Final campaign request:', JSON.stringify(campaignRequest, null, 2));
    
    // Create campaigns - this is now a critical operation with retries
    console.log('🚀 Creating campaigns (critical operation with retries)...');
    const campaignResult = await createCampaignsActivity(campaignRequest);
    
    if (!campaignResult.success) {
      const errorMessage = `Campaign creation failed: ${campaignResult.error}`;
      console.error(`❌ ${errorMessage}`);
      throw new Error(errorMessage);
    }
    
    console.log('✅ Campaigns created successfully');
    console.log(`📈 Campaign result:`, JSON.stringify(campaignResult.campaign, null, 2));
    
    // Try to create campaign requirements - non-critical operation
    let requirementsResult;
    let requirementsCreated = false;
    
    try {
      console.log('📋 Creating campaign requirements...');
      requirementsResult = await createCampaignRequirementsActivity(campaignRequest);
      
      if (requirementsResult.success) {
        console.log('✅ Campaign requirements created successfully');
        console.log(`📋 Requirements result:`, JSON.stringify(requirementsResult.requirements, null, 2));
        requirementsCreated = true;
      } else {
        console.warn('⚠️ Campaign requirements creation failed (non-critical):', requirementsResult.error);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('⚠️ Campaign requirements creation threw error (non-critical):', errorMessage);
    }
    
    // Build final result - campaigns creation is now critical, requirements are optional
    const warnings = [];
    if (!requirementsCreated) {
      warnings.push('Campaign requirements creation failed');
    }
    
    const warningMessage = warnings.length > 0 ? ` (warnings: ${warnings.join(', ')})` : '';
    
    return {
      success: true, // Success because campaigns were created successfully
      processed: true,
      reason: `Workflow completed successfully${warningMessage}`,
      campaign: campaignResult.campaign,
      requirements: requirementsCreated ? requirementsResult?.requirements : undefined,
      siteInfo: siteResult.site,
      segmentsUsed,
      warnings: warnings.length > 0 ? warnings : undefined
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Build campaigns workflow failed:', errorMessage);
    
    // Re-throw the error to fail the workflow completely
    throw new Error(`Build campaigns workflow failed: ${errorMessage}`);
  }
} 