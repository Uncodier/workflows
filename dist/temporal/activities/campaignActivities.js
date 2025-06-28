"use strict";
/**
 * Campaign and Segment Activities
 * Activities for managing campaigns and segments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSegmentsActivity = getSegmentsActivity;
exports.getSiteActivity = getSiteActivity;
exports.buildSegmentsActivity = buildSegmentsActivity;
exports.createCampaignsActivity = createCampaignsActivity;
exports.createCampaignRequirementsActivity = createCampaignRequirementsActivity;
exports.getDraftContentActivity = getDraftContentActivity;
exports.buildContentActivity = buildContentActivity;
exports.createContentCalendarActivity = createContentCalendarActivity;
exports.improveContentActivity = improveContentActivity;
exports.buildNewSegmentsActivity = buildNewSegmentsActivity;
exports.buildICPSegmentsActivity = buildICPSegmentsActivity;
const apiService_1 = require("../services/apiService");
const supabaseService_1 = require("../services/supabaseService");
/**
 * Activity to get segments for a specific site
 */
async function getSegmentsActivity(siteId) {
    console.log(`🎯 Getting segments for site: ${siteId}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot fetch segments');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, fetching segments...');
        // Fetch segments for the specific site
        const segmentsData = await supabaseService.fetchSegments(siteId);
        const segments = segmentsData.map(segmentData => ({
            id: segmentData.id,
            name: segmentData.name || 'Unnamed Segment',
            description: segmentData.description || '',
            criteria: segmentData.analysis || {},
            siteId: segmentData.site_id,
            createdAt: segmentData.created_at,
            updatedAt: segmentData.updated_at
        }));
        console.log(`✅ Retrieved ${segments.length} segments for site ${siteId}`);
        if (segments.length > 0) {
            console.log(`📋 Segments found:`);
            segments.forEach((segment, index) => {
                console.log(`   ${index + 1}. ${segment.name} (${segment.id})`);
            });
        }
        return {
            success: true,
            segments
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting segments for site ${siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to get site information by site_id
 */
async function getSiteActivity(siteId) {
    console.log(`🏢 Getting site information for: ${siteId}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot fetch site information');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, fetching site...');
        // Fetch all sites and find the specific one
        const allSites = await supabaseService.fetchSites();
        const siteData = allSites.find(site => site.id === siteId);
        if (!siteData) {
            console.error(`❌ Site ${siteId} not found`);
            return {
                success: false,
                error: 'Site not found'
            };
        }
        const site = {
            id: siteData.id,
            name: siteData.name || 'Unnamed Site',
            url: siteData.url || '',
            user_id: siteData.user_id,
            created_at: siteData.created_at,
            updated_at: siteData.updated_at
        };
        console.log(`✅ Retrieved site information for ${site.name}: ${site.url}`);
        return {
            success: true,
            site
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting site ${siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to build segments for a site
 */
async function buildSegmentsActivity(request) {
    console.log(`🎯 Building segments for URL: ${request.url}`);
    console.log(`📊 Request data:`, JSON.stringify(request, null, 2));
    try {
        const response = await apiService_1.apiService.post('/api/site/segments', request);
        if (!response.success) {
            console.error(`❌ Failed to build segments for URL ${request.url}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to build segments'
            };
        }
        console.log(`✅ Successfully built segments for URL ${request.url}`);
        console.log(`📈 Segments result:`, JSON.stringify(response.data, null, 2));
        return {
            success: true,
            segments: response.data?.segments || response.data?.results || [],
            analysis: response.data?.analysis || response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception building segments for URL ${request.url}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to create campaigns for a site using segments
 */
async function createCampaignsActivity(request) {
    console.log(`🚀 Creating campaigns for site: ${request.siteId}`);
    console.log(`📊 Campaign data:`, JSON.stringify(request.campaignData, null, 2));
    try {
        const requestBody = {
            siteId: request.siteId,
            ...(request.agent_id && { agent_id: request.agent_id }),
            ...(request.userId && { userId: request.userId }),
            campaignData: request.campaignData
        };
        const response = await apiService_1.apiService.post('/api/agents/growth/campaigns', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to create campaigns for site ${request.siteId}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to create campaigns'
            };
        }
        console.log(`✅ Successfully created campaigns for site ${request.siteId}`);
        console.log(`📈 Campaign result:`, JSON.stringify(response.data, null, 2));
        return {
            success: true,
            campaign: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception creating campaigns for site ${request.siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to create campaign requirements for a site using segments
 */
async function createCampaignRequirementsActivity(request) {
    console.log(`📋 Creating campaign requirements for site: ${request.siteId}`);
    console.log(`📊 Campaign data:`, JSON.stringify(request.campaignData, null, 2));
    try {
        const requestBody = {
            siteId: request.siteId,
            ...(request.agent_id && { agent_id: request.agent_id }),
            ...(request.userId && { userId: request.userId }),
            campaignData: request.campaignData
        };
        const response = await apiService_1.apiService.post('/api/agents/growth/campaigns/requirements', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to create campaign requirements for site ${request.siteId}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to create campaign requirements'
            };
        }
        console.log(`✅ Successfully created campaign requirements for site ${request.siteId}`);
        console.log(`📋 Requirements result:`, JSON.stringify(response.data, null, 2));
        return {
            success: true,
            requirements: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception creating campaign requirements for site ${request.siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to get draft contents for a site
 */
async function getDraftContentActivity(siteId) {
    console.log(`📋 Getting draft content for site: ${siteId}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot fetch draft content');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, fetching draft content...');
        // Query content table for draft status content
        const draftContents = await supabaseService.fetchDraftContent(siteId);
        console.log(`✅ Found ${draftContents.length} draft contents for site ${siteId}`);
        return {
            success: true,
            draftContents,
            count: draftContents.length
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting draft content for site ${siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to build content recommendations for a site
 * Uses AI to analyze the site and generate content recommendations
 */
async function buildContentActivity(request) {
    console.log(`📝 Building content recommendations for URL: ${request.url}`);
    console.log('📊 Request data:', JSON.stringify(request, null, 2));
    // Determine endpoint based on request or default
    const endpoint = request.endpoint || '/api/content/recommendations';
    console.log(`🎯 Using endpoint: ${endpoint}`);
    try {
        const response = await apiService_1.apiService.post(endpoint, request);
        if (!response.success) {
            console.error(`❌ Failed to build content for URL ${request.url}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to build content recommendations'
            };
        }
        console.log(`✅ Successfully built content recommendations for URL ${request.url}`);
        console.log('📈 Content result:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            recommendations: response.data.recommendations || response.data?.results || [],
            analysis: response.data.analysis || response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception building content for URL ${request.url}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to create content calendar using the new copywriter agent API
 */
async function createContentCalendarActivity(request) {
    console.log(`📅 Creating content calendar for site: ${request.siteId}`);
    console.log('📊 Request data:', JSON.stringify(request, null, 2));
    try {
        // Use 2 minute timeout for content calendar operations since they can take up to 2 minutes
        const response = await apiService_1.apiService.request('/api/agents/copywriter/content-calendar', {
            method: 'POST',
            body: request,
            timeout: 120000 // 2 minutes timeout for content operations
        });
        if (!response.success) {
            console.error(`❌ Failed to create content calendar for site ${request.siteId}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to create content calendar'
            };
        }
        console.log(`✅ Successfully created content calendar for site ${request.siteId}`);
        console.log('📈 Content calendar result:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            data: response.data,
            recommendations: response.data?.recommendations || response.data?.results || [],
            analysis: response.data?.analysis || response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception creating content calendar for site ${request.siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to improve existing draft content using the new copywriter agent API
 */
async function improveContentActivity(request) {
    console.log(`🔧 Improving content for site: ${request.siteId}`);
    console.log('📊 Request data:', JSON.stringify(request, null, 2));
    try {
        // Use 2 minute timeout for content improvement operations since they can take up to 2 minutes
        const response = await apiService_1.apiService.request('/api/agents/copywriter/content-improve', {
            method: 'POST',
            body: request,
            timeout: 120000 // 2 minutes timeout for content operations
        });
        if (!response.success) {
            console.error(`❌ Failed to improve content for site ${request.siteId}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to improve content'
            };
        }
        console.log(`✅ Successfully improved content for site ${request.siteId}`);
        console.log('📈 Content improvement result:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            data: response.data,
            recommendations: response.data?.recommendations || response.data?.results || [],
            analysis: response.data?.analysis || response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception improving content for site ${request.siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to build segments using the new segments API
 */
async function buildNewSegmentsActivity(request) {
    console.log(`🎯 Building segments using new API for site: ${request.siteId}`);
    console.log(`📊 Request data:`, JSON.stringify(request, null, 2));
    try {
        const requestBody = {
            siteId: request.siteId,
            ...(request.userId && { userId: request.userId }),
            ...(request.segmentData && { segmentData: request.segmentData })
        };
        const response = await apiService_1.apiService.request('/api/agents/growth/segments', {
            method: 'POST',
            body: requestBody,
            timeout: 300000 // 5 minutes timeout for segment building operations
        });
        if (!response.success) {
            const errorMessage = response.error?.message || 'Failed to build segments';
            console.error(`❌ Failed to build segments for site ${request.siteId}:`, response.error);
            throw new Error(errorMessage);
        }
        console.log(`✅ Successfully built segments for site ${request.siteId}`);
        console.log(`📈 Segments result:`, JSON.stringify(response.data, null, 2));
        return {
            success: true,
            segments: response.data?.segments || response.data?.results || [],
            analysis: response.data?.analysis || response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception building segments for site ${request.siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to build ICP segments using the new segments ICP API
 */
async function buildICPSegmentsActivity(request) {
    console.log(`🎯 Building ICP segments for site: ${request.siteId}`);
    console.log(`📊 Request data:`, JSON.stringify(request, null, 2));
    try {
        const requestBody = {
            siteId: request.siteId,
            ...(request.userId && { userId: request.userId }),
            ...(request.segmentIds && { segmentIds: request.segmentIds }),
            ...(request.segmentData && { segmentData: request.segmentData })
        };
        const response = await apiService_1.apiService.request('/api/agents/growth/segments/icp', {
            method: 'POST',
            body: requestBody,
            timeout: 300000 // 5 minutes timeout for ICP segment building operations
        });
        if (!response.success) {
            const errorMessage = response.error?.message || 'Failed to build ICP segments';
            console.error(`❌ Failed to build ICP segments for site ${request.siteId}:`, response.error);
            throw new Error(errorMessage);
        }
        console.log(`✅ Successfully built ICP segments for site ${request.siteId}`);
        console.log(`📈 ICP Segments result:`, JSON.stringify(response.data, null, 2));
        return {
            success: true,
            segments: response.data?.segments || response.data?.results || [],
            analysis: response.data?.analysis || response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception building ICP segments for site ${request.siteId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
