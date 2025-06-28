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
    
    const allSites = await supabaseService.fetchSites();
    const siteData = allSites.find(site => site.id === siteId);

    if (!siteData) {
      console.log(`⚠️  Site ${siteId} not found`);
      return {
        success: false,
        error: 'Site not found'
      };
    }

    const site: Site = {
      id: siteData.id,
      name: siteData.name,
      url: siteData.url,
      user_id: siteData.user_id,
      created_at: siteData.created_at,
      updated_at: siteData.updated_at
    };

    console.log(`✅ Retrieved site information: ${site.name} (${site.url})`);
    
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
  
  try {
    console.log('📤 Sending segment building request to agent API...');
    
    const response = await apiService.post('/api/agents/growth/segments', request);
    
    if (!response.success) {
      console.error(`❌ Failed to build segments:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to build segments'
      };
    }
    
    const data = response.data;
    const segments = data?.segments || [];
    const analysis = data?.analysis || {};
    
    console.log(`✅ Successfully built ${segments.length} segments`);
         if (segments.length > 0) {
       console.log(`📋 Segments created:`);
       segments.forEach((segment: any, index: number) => {
         console.log(`   ${index + 1}. ${segment.name || `Segment ${index + 1}`}`);
       });
     }
    
    return {
      success: true,
      segments,
      analysis
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception building segments:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to create campaigns for selected segments
 */
export async function createCampaignsActivity(request: CreateCampaignRequest): Promise<CreateCampaignResult> {
  console.log(`📢 Creating campaigns for site: ${request.siteId}`);
  
  try {
    console.log('📤 Sending campaign creation request...');
    
    const response = await apiService.post('/api/agents/growth/campaigns', {
      siteId: request.siteId,
      userId: request.userId,
      agentId: request.agent_id,
      ...request.campaignData
    });
    
    if (!response.success) {
      console.error(`❌ Failed to create campaigns:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to create campaigns'
      };
    }
    
    const campaign = response.data;
    
    console.log(`✅ Successfully created campaign`);
    
    return {
      success: true,
      campaign
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception creating campaigns:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to create campaign requirements
 */
export async function createCampaignRequirementsActivity(request: CreateCampaignRequest): Promise<CreateCampaignRequirementsResult> {
  console.log(`📋 Creating campaign requirements for site: ${request.siteId}`);
  
  try {
    console.log('📤 Sending campaign requirements creation request...');
    
    const response = await apiService.post('/api/agents/growth/campaigns/requirements', {
      siteId: request.siteId,
      userId: request.userId,
      agentId: request.agent_id,
      ...request.campaignData
    });
    
    if (!response.success) {
      console.error(`❌ Failed to create campaign requirements:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to create campaign requirements'
      };
    }
    
    const requirements = response.data;
    
    console.log(`✅ Successfully created campaign requirements`);
    
    return {
      success: true,
      requirements
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception creating campaign requirements:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to get draft content for a specific site
 */
export async function getDraftContentActivity(siteId: string): Promise<GetDraftContentResult> {
  console.log(`📝 Getting draft content for site: ${siteId}`);
  
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
    
    // Fetch draft content for the specific site
    const draftContentData = await supabaseService.fetchDraftContent(siteId);

    const draftContents: DraftContent[] = draftContentData.map(contentData => ({
      id: contentData.id,
      title: contentData.title || 'Untitled Content',
      description: contentData.description || '',
      type: contentData.type || 'unknown',
      status: contentData.status || 'draft',
      site_id: contentData.site_id,
      created_at: contentData.created_at,
      updated_at: contentData.updated_at
    }));

    console.log(`✅ Retrieved ${draftContents.length} draft content items for site ${siteId}`);
    if (draftContents.length > 0) {
      console.log(`📋 Draft content found:`);
      draftContents.forEach((content, index) => {
        console.log(`   ${index + 1}. ${content.title} (${content.type})`);
      });
    }
    
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
 * Activity to build content recommendations
 */
export async function buildContentActivity(request: BuildContentRequest & { endpoint?: string }): Promise<BuildContentResult> {
  console.log(`📝 Building content recommendations for URL: ${request.url}`);
  
  try {
    const endpoint = request.endpoint || '/api/agentes/copywriter/content-editor';
    console.log(`📤 Sending content building request to: ${endpoint}`);
    
    const response = await apiService.post(endpoint, request);
    
    if (!response.success) {
      console.error(`❌ Failed to build content:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to build content'
      };
    }
    
    const data = response.data;
    const recommendations = data?.recommendations || [];
    const analysis = data?.analysis || {};
    
    console.log(`✅ Successfully built ${recommendations.length} content recommendations`);
         if (recommendations.length > 0) {
       console.log(`📋 Content recommendations:`);
       recommendations.forEach((rec: any, index: number) => {
         console.log(`   ${index + 1}. ${rec.title || rec.name || `Recommendation ${index + 1}`}`);
       });
     }
    
    return {
      success: true,
      recommendations,
      analysis
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception building content:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to create content calendar
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
  
  try {
    console.log('📤 Sending content calendar creation request...');
    
    const response = await apiService.request('/api/agentes/copywriter/content-calendar', {
      method: 'POST',
      body: request,
      timeout: 120000 // 2 minutes timeout for content operations
    });
    
    if (!response.success) {
      console.error(`❌ Failed to create content calendar:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to create content calendar'
      };
    }
    
    const data = response.data;
    const recommendations = data?.recommendations || [];
    const analysis = data?.analysis || {};
    
    console.log(`✅ Successfully created content calendar`);
    if (recommendations.length > 0) {
      console.log(`📋 Content calendar recommendations: ${recommendations.length}`);
    }
    
    return {
      success: true,
      data,
      recommendations,
      analysis
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception creating content calendar:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to improve existing content
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
  console.log(`✨ Improving content for site: ${request.siteId}`);
  
  try {
    console.log('📤 Sending content improvement request...');
    
    const response = await apiService.request('/api/agentes/copywriter/content-improve', {
      method: 'POST',
      body: request,
      timeout: 120000 // 2 minutes timeout for content operations
    });
    
    if (!response.success) {
      console.error(`❌ Failed to improve content:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to improve content'
      };
    }
    
    const data = response.data;
    const recommendations = data?.recommendations || [];
    const analysis = data?.analysis || {};
    
    console.log(`✅ Successfully improved content`);
    if (recommendations.length > 0) {
      console.log(`📋 Content improvement recommendations: ${recommendations.length}`);
    }
    
    return {
      success: true,
      data,
      recommendations,
      analysis
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception improving content:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to build new segments for a site
 */
export async function buildNewSegmentsActivity(request: {
  siteId: string;
  userId?: string;
  segmentData?: {
    segmentCount?: number;
    [key: string]: any;
  };
}): Promise<BuildSegmentsResult> {
  console.log(`🎯 Building new segments for site: ${request.siteId}`);
  
  try {
    console.log('📤 Sending new segment building request...');
    
    const requestBody = {
      siteId: request.siteId,
      userId: request.userId,
      ...request.segmentData
    };
    
    const response = await apiService.request('/api/agents/growth/segments', {
      method: 'POST',
      body: requestBody,
      timeout: 300000 // 5 minutes timeout for segment building operations
    });
    
    if (!response.success) {
      console.error(`❌ Failed to build new segments:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to build new segments'
      };
    }
    
    const data = response.data;
    const segments = data?.segments || [];
    const analysis = data?.analysis || {};
    
    console.log(`✅ Successfully built ${segments.length} new segments`);
         if (segments.length > 0) {
       console.log(`📋 New segments created:`);
       segments.forEach((segment: any, index: number) => {
         console.log(`   ${index + 1}. ${segment.name || `Segment ${index + 1}`}`);
       });
     }
    
    return {
      success: true,
      segments,
      analysis
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception building new segments for site ${request.siteId}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to build ICP (Ideal Customer Profile) segments
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
  
  try {
    console.log('📤 Sending ICP segment building request...');
    
    const requestBody = {
      siteId: request.siteId,
      userId: request.userId,
      segmentIds: request.segmentIds,
      ...request.segmentData
    };
    
    const response = await apiService.request('/api/agents/growth/segments/icp', {
      method: 'POST',
      body: requestBody,
      timeout: 300000 // 5 minutes timeout for ICP segment building operations
    });
    
    if (!response.success) {
      console.error(`❌ Failed to build ICP segments:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to build ICP segments'
      };
    }
    
    const data = response.data;
    const segments = data?.segments || [];
    const analysis = data?.analysis || {};
    
    console.log(`✅ Successfully built ${segments.length} ICP segments`);
         if (segments.length > 0) {
       console.log(`📋 ICP segments created:`);
       segments.forEach((segment: any, index: number) => {
         console.log(`   ${index + 1}. ${segment.name || `ICP Segment ${index + 1}`}`);
       });
     }
    
    return {
      success: true,
      segments,
      analysis
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