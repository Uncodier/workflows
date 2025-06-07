"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCampaignsWorkflow = buildCampaignsWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Configure activity options
const { createCampaignsActivity, getSiteActivity, getSegmentsActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Build Campaigns Workflow
 * Creates marketing campaigns for a specific site using the provided campaign data
 */
async function buildCampaignsWorkflow(params) {
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
        return {
            success: false,
            processed: false,
            reason: 'Invalid parameters',
            error: errorMessage
        };
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
            return {
                success: false,
                processed: false,
                reason: 'Site validation failed',
                error: siteResult.error || 'Site validation failed'
            };
        }
        if (!siteResult.site) {
            const errorMessage = `Site ${siteId} data is invalid or empty`;
            console.error(`❌ ${errorMessage}`);
            throw new Error(errorMessage);
        }
        console.log(`✅ Site validated: ${siteResult.site.name} (${siteResult.site.url})`);
        // 2. If segmentIds are provided, validate they exist
        let segmentsUsed = [];
        if (params.campaignData?.segmentIds && params.campaignData.segmentIds.length > 0) {
            console.log('🎯 Validating segments...');
            const segmentsResult = await getSegmentsActivity(siteId);
            if (segmentsResult.success && segmentsResult.segments) {
                // Filter to only include segments that exist
                const existingSegmentIds = segmentsResult.segments.map(s => s.id);
                const validSegmentIds = params.campaignData.segmentIds.filter(id => existingSegmentIds.includes(id));
                if (validSegmentIds.length === 0) {
                    console.log('⚠️ No valid segments found, proceeding without specific segments');
                }
                else {
                    segmentsUsed = segmentsResult.segments.filter(s => validSegmentIds.includes(s.id));
                    console.log(`✅ Using ${segmentsUsed.length} valid segments:`, segmentsUsed.map(s => s.name).join(', '));
                    // Update campaign data with only valid segment IDs
                    params.campaignData.segmentIds = validSegmentIds;
                }
            }
            else {
                console.log('⚠️ Could not fetch segments, proceeding without segment validation');
            }
        }
        else {
            console.log('📋 No specific segments provided, creating general campaigns');
        }
        // 3. Create the campaigns using validated site and segment information
        console.log('🛠️ Creating campaigns...');
        const campaignRequest = {
            siteId: siteResult.site.id, // Use the validated site ID from getSiteActivity
            userId: params.userId || siteResult.site.user_id, // Use provided userId or fall back to site owner
            campaignData: {
                ...(params.campaignData || {}),
                // Use only the validated segment IDs (already filtered above)
                segmentIds: params.campaignData?.segmentIds || []
            }
        };
        console.log('📋 Final campaign request:', JSON.stringify(campaignRequest, null, 2));
        const campaignResult = await createCampaignsActivity(campaignRequest);
        if (!campaignResult.success) {
            console.error('❌ Campaign creation failed:', campaignResult.error);
            return {
                success: false,
                processed: true,
                reason: 'Campaign creation failed',
                error: campaignResult.error,
                siteInfo: siteResult.site,
                segmentsUsed
            };
        }
        console.log('✅ Campaigns created successfully');
        console.log(`📈 Campaign result:`, JSON.stringify(campaignResult.campaign, null, 2));
        return {
            success: true,
            processed: true,
            reason: 'Campaigns created successfully',
            campaign: campaignResult.campaign,
            siteInfo: siteResult.site,
            segmentsUsed
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Build campaigns workflow failed:', errorMessage);
        // Re-throw the error to fail the workflow completely
        throw new Error(`Build campaigns workflow failed: ${errorMessage}`);
    }
}
