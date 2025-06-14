/**
 * Campaign and Segment Activities
 * Activities for managing campaigns and segments
 */

import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services/supabaseService';

export interface Segment {
  id: string;
  name: string;
  description?: string;
  criteria?: any;
  siteId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetSegmentsResult {
  success: boolean;
  segments?: Segment[];
  error?: string;
}

export interface CreateCampaignRequest {
  siteId: string;
  agent_id?: string;
  userId?: string;
  campaignData: {
    segmentIds?: string[];
    [key: string]: any;
  };
}

export interface CreateCampaignResult {
  success: boolean;
  campaign?: any;
  error?: string;
}

export interface CreateCampaignRequirementsResult {
  success: boolean;
  requirements?: any;
  error?: string;
}

export interface Site {
  id: string;
  name: string;
  url: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface GetSiteResult {
  success: boolean;
  site?: Site;
  error?: string;
}

export interface BuildSegmentsRequest {
  url: string;
  segmentCount?: number;
  mode?: 'analyze' | 'create' | 'update';
  timeout?: number;
  user_id?: string;
  site_id?: string;
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
  segments?: any[];
  analysis?: any;
  error?: string;
}

// Content recommendation interfaces
export interface BuildContentRequest {
  url: string;
  segment_id?: string;
  content_types?: string[];
  limit?: number;
  user_id?: string;
  site_id?: string;
  funnel_stage?: 'all' | 'awareness' | 'consideration' | 'decision' | 'retention';
  topics?: string[];
  aiProvider?: 'openai' | 'anthropic' | 'gemini';
  aiModel?: string;
  timeout?: number;
  include_metadata?: boolean;
  sort_by?: 'relevance' | 'date' | 'popularity';
}

export interface BuildContentResult {
  success: boolean;
  recommendations?: any[];
  analysis?: any;
  error?: string;
}

// Draft content interfaces
export interface DraftContent {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  site_id: string;
  created_at: string;
  updated_at: string;
}

export interface GetDraftContentResult {
  success: boolean;
  draftContents?: DraftContent[];
  count?: number;
  error?: string;
}

/**
 * Activity to get segments for a specific site
 */
export async function getSegmentsActivity(siteId: string): Promise<GetSegmentsResult> {
  console.log(`🎯 Getting segments for site: ${siteId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
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

    const segments: Segment[] = segmentsData.map(segmentData => ({
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
    
  } catch (error) {
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
export async function getSiteActivity(siteId: string): Promise<GetSiteResult> {
  console.log(`🏢 Getting site information for: ${siteId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
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

    const site: Site = {
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
    
  } catch (error) {
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
export async function buildSegmentsActivity(request: BuildSegmentsRequest): Promise<BuildSegmentsResult> {
  console.log(`🎯 Building segments for URL: ${request.url}`);
  console.log(`📊 Request data:`, JSON.stringify(request, null, 2));
  
  try {
    const response = await apiService.post('/api/site/segments', request);
    
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
    
  } catch (error) {
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
export async function createCampaignsActivity(request: CreateCampaignRequest): Promise<CreateCampaignResult> {
  console.log(`🚀 Creating campaigns for site: ${request.siteId}`);
  console.log(`📊 Campaign data:`, JSON.stringify(request.campaignData, null, 2));
  
  try {
    const requestBody = {
      siteId: request.siteId,
      ...(request.agent_id && { agent_id: request.agent_id }),
      ...(request.userId && { userId: request.userId }),
      campaignData: request.campaignData
    };
    
    const response = await apiService.post('/api/agents/growth/campaigns', requestBody);
    
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
    
  } catch (error) {
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
export async function createCampaignRequirementsActivity(request: CreateCampaignRequest): Promise<CreateCampaignRequirementsResult> {
  console.log(`📋 Creating campaign requirements for site: ${request.siteId}`);
  console.log(`📊 Campaign data:`, JSON.stringify(request.campaignData, null, 2));
  
  try {
    const requestBody = {
      siteId: request.siteId,
      ...(request.agent_id && { agent_id: request.agent_id }),
      ...(request.userId && { userId: request.userId }),
      campaignData: request.campaignData
    };
    
    const response = await apiService.post('/api/agents/growth/campaigns/requirements', requestBody);
    
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
    
  } catch (error) {
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
export async function getDraftContentActivity(siteId: string): Promise<GetDraftContentResult> {
  console.log(`📋 Getting draft content for site: ${siteId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
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
    
  } catch (error) {
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
export async function buildContentActivity(request: BuildContentRequest & { endpoint?: string }): Promise<BuildContentResult> {
  console.log(`📝 Building content recommendations for URL: ${request.url}`);
  console.log('📊 Request data:', JSON.stringify(request, null, 2));
  
  // Determine endpoint based on request or default
  const endpoint = request.endpoint || '/api/content/recommendations';
  console.log(`🎯 Using endpoint: ${endpoint}`);
  
  try {
    const response = await apiService.post(endpoint, request);
    
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

  } catch (error) {
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
export async function createContentCalendarActivity(request: {
  siteId: string;
  segmentId?: string;
  campaignId?: string;
  userId?: string;
  agent_id?: string;
  timeframe?: string;
  targetAudience?: string;
  goals?: string[];
  keywords?: string[];
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  recommendations?: any[];
  analysis?: any;
}> {
  console.log(`📅 Creating content calendar for site: ${request.siteId}`);
  console.log('📊 Request data:', JSON.stringify(request, null, 2));
  
  try {
    // Use 2 minute timeout for content calendar operations since they can take up to 2 minutes
    const response = await apiService.request('/api/agents/copywriter/content-calendar', {
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

  } catch (error) {
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
export async function improveContentActivity(request: {
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
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  recommendations?: any[];
  analysis?: any;
}> {
  console.log(`🔧 Improving content for site: ${request.siteId}`);
  console.log('📊 Request data:', JSON.stringify(request, null, 2));
  
  try {
    // Use 2 minute timeout for content improvement operations since they can take up to 2 minutes
    const response = await apiService.request('/api/agents/copywriter/content-improve', {
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

  } catch (error) {
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
export async function buildNewSegmentsActivity(request: {
  siteId: string;
  userId?: string;
  segmentData?: {
    segmentCount?: number;
    [key: string]: any;
  };
}): Promise<BuildSegmentsResult> {
  console.log(`🎯 Building segments using new API for site: ${request.siteId}`);
  console.log(`📊 Request data:`, JSON.stringify(request, null, 2));
  
  try {
    const requestBody = {
      siteId: request.siteId,
      ...(request.userId && { userId: request.userId }),
      ...(request.segmentData && { segmentData: request.segmentData })
    };
    
    const response = await apiService.request('/api/agents/growth/segments', {
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
    
  } catch (error) {
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
export async function buildICPSegmentsActivity(request: {
  siteId: string;
  userId?: string;
  segmentIds?: string[];
  segmentData?: {
    segmentCount?: number;
    [key: string]: any;
  };
}): Promise<BuildSegmentsResult> {
  console.log(`🎯 Building ICP segments for site: ${request.siteId}`);
  console.log(`📊 Request data:`, JSON.stringify(request, null, 2));
  
  try {
    const requestBody = {
      siteId: request.siteId,
      ...(request.userId && { userId: request.userId }),
      ...(request.segmentIds && { segmentIds: request.segmentIds }),
      ...(request.segmentData && { segmentData: request.segmentData })
    };
    
    const response = await apiService.request('/api/agents/growth/segments/icp', {
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
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception building ICP segments for site ${request.siteId}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Lead follow-up interfaces
export interface LeadFollowUpRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  data?: any;
  error?: string;
  followUpActions?: any[];
  nextSteps?: string[];
}

// Lead research interfaces
export interface LeadResearchRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadResearchResult {
  success: boolean;
  data?: any;
  error?: string;
  researchData?: any;
  insights?: any[];
  recommendations?: string[];
}

/**
 * Activity to execute lead follow-up via sales agent API
 */
export async function leadFollowUpActivity(request: LeadFollowUpRequest): Promise<LeadFollowUpResult> {
  console.log(`📞 Executing lead follow-up for lead: ${request.lead_id}, site: ${request.site_id}`);
  
  try {
    const requestBody = {
      leadId: request.lead_id,        // Convert to camelCase for API
      siteId: request.site_id,        // Convert to camelCase for API
      userId: request.userId,
      ...request.additionalData,
    };

    console.log('📤 Sending lead follow-up request:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadFollowUp', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to execute lead follow-up for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute lead follow-up'
      };
    }
    
    const data = response.data;
    const followUpActions = data?.followUpActions || data?.actions || [];
    const nextSteps = data?.nextSteps || data?.next_steps || [];
    
    console.log(`✅ Lead follow-up executed successfully for lead ${request.lead_id}`);
    if (followUpActions.length > 0) {
      console.log(`📋 Follow-up actions generated: ${followUpActions.length}`);
    }
    if (nextSteps.length > 0) {
      console.log(`🎯 Next steps identified: ${nextSteps.length}`);
    }
    
    return {
      success: true,
      data,
      followUpActions,
      nextSteps
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception executing lead follow-up for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to execute lead research via sales agent API
 */
export async function leadResearchActivity(request: LeadResearchRequest): Promise<LeadResearchResult> {
  console.log(`🔍 Executing lead research for lead: ${request.lead_id}, site: ${request.site_id}`);
  
  try {
    const requestBody = {
      leadId: request.lead_id,        // Convert to camelCase for API
      siteId: request.site_id,        // Convert to camelCase for API
      userId: request.userId,
      ...request.additionalData,
    };

    console.log('📤 Sending lead research request:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadResearch', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to execute lead research for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute lead research'
      };
    }
    
    const data = response.data;
    const researchData = data?.researchData || data?.research || data;
    const insights = data?.insights || data?.findings || [];
    const recommendations = data?.recommendations || data?.next_steps || [];
    
    console.log(`✅ Lead research executed successfully for lead ${request.lead_id}`);
    if (insights.length > 0) {
      console.log(`🔍 Research insights generated: ${insights.length}`);
    }
    if (recommendations.length > 0) {
      console.log(`💡 Recommendations identified: ${recommendations.length}`);
    }
    
    return {
      success: true,
      data,
      researchData,
      insights,
      recommendations
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception executing lead research for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}