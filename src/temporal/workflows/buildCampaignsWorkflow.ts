import { proxyActivities } from '@temporalio/workflow';
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

// Configure non-critical campaign activities with no retry policy
const {
  createCampaignsActivity,
  createCampaignRequirementsActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DEFAULT,
  retry: RETRY_POLICIES.NO_RETRY, // No retries for campaign creation failures
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
    
    // Try to create campaigns - treat as non-critical operation
    let campaignResult;
    let campaignCreated = false;
    
    try {
      campaignResult = await createCampaignsActivity(campaignRequest);
      
      if (campaignResult.success) {
        console.log('✅ Campaigns created successfully');
        console.log(`📈 Campaign result:`, JSON.stringify(campaignResult.campaign, null, 2));
        campaignCreated = true;
      } else {
        console.warn('⚠️ Campaign creation failed (non-critical):', campaignResult.error);
        console.log('🔄 Continuing workflow execution without campaigns...');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('⚠️ Campaign creation threw error (non-critical):', errorMessage);
      console.log('🔄 Continuing workflow execution without campaigns...');
    }
    
    // Try to create campaign requirements - also non-critical
    let requirementsResult;
    let requirementsCreated = false;
    
    // Only attempt requirements if campaigns were created successfully
    if (campaignCreated && campaignResult?.campaign) {
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
    } else {
      console.log('⏭️ Skipping campaign requirements creation (campaigns not created)');
    }
    
    // Return success even if campaigns/requirements failed (they are non-critical)
    const warnings = [];
    if (!campaignCreated) {
      warnings.push('Campaign creation failed');
    }
    if (!requirementsCreated && campaignCreated) {
      warnings.push('Campaign requirements creation failed');
    }
    
    const warningMessage = warnings.length > 0 ? ` (warnings: ${warnings.join(', ')})` : '';
    
    return {
      success: true, // Always success as campaign creation is non-critical
      processed: true,
      reason: `Workflow completed successfully${warningMessage}`,
      campaign: campaignCreated ? campaignResult?.campaign : undefined,
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