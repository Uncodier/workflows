import { apiService } from '../services/apiService';

/**
 * Data Analyst Activities
 * Activities for calling external data analyst API endpoints
 */

export interface DeepResearchRequest {
  site_id: string;
  research_topic: string;
  userId?: string;
  additionalData?: any;
  deliverables?: any;
}

export interface DeepResearchResponse {
  success: boolean;
  operations?: Operation[];
  data?: any;
  error?: string;
  fallback?: boolean; // Indicates if fallback mode was used
}

export interface Operation {
  id?: string;
  type: string;
  objective?: string;
  description?: string;
  search_queries?: string[];
  search_options?: any;
  expected_deliverables?: any; // This should be an object, not a JSON string
  params?: any;
  [key: string]: any;
}

export interface SearchRequest {
  operation: Operation;
  site_id?: string;
  userId?: string;
  command_id?: string;
  deliverables?: any;
}

export interface SearchResponse {
  success: boolean;
  data?: any;
  results?: any[];
  error?: string;
  fallback?: boolean; // Indicates if fallback mode was used
}

export interface AnalysisRequest {
  site_id: string;
  research_topic: string;
  userId?: string;
  additionalData?: any;
  deliverables?: any;
  command_id?: string;
}

export interface AnalysisResponse {
  success: boolean;
  analysis?: any;
  insights?: any[];
  recommendations?: any[];
  data?: any;
  error?: string;
  fallback?: boolean; // Indicates if fallback mode was used
}

export interface LeadSegmentationRequest {
  site_id: string;
  lead_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadSegmentationResponse {
  success: boolean;
  data?: any;
  segmentation?: any;
  error?: string;
  fallback?: boolean; // Indicates if fallback mode was used
}

/**
 * Create fallback research operations when API is not available
 */
function createFallbackOperations(request: DeepResearchRequest): Operation[] {
  const { research_topic } = request;
  
  // Create basic operations based on research topic
  const operations: Operation[] = [
    {
      id: 'basic-search-1',
      type: 'web_search',
      objective: `Research basic information about ${research_topic}`,
      description: `Basic information gathering for ${research_topic}`,
      search_queries: [research_topic],
      search_options: { limit: 10 },
      expected_deliverables: {
        type: 'basic_info',
        fields: ['name', 'description', 'key_facts']
      }
    },
    {
      id: 'contextual-search-1',
      type: 'contextual_search',
      objective: `Find contextual information about ${research_topic}`,
      description: `Contextual research for ${research_topic}`,
      search_queries: [`${research_topic} context`, `${research_topic} background`],
      search_options: { limit: 5 },
      expected_deliverables: {
        type: 'contextual_info',
        fields: ['context', 'background', 'related_topics']
      }
    }
  ];

  console.log(`📋 Created ${operations.length} fallback operations for research topic: ${research_topic}`);
  return operations;
}

/**
 * Create fallback search results when API is not available
 */
function createFallbackSearchResults(request: SearchRequest): any {
  const { operation, site_id } = request;
  
  const fallbackResults = {
    operation_id: operation.id,
    operation_type: operation.type,
    search_queries: operation.search_queries,
    results: [],
    metadata: {
      fallback_mode: true,
      message: 'API not available - using fallback mode',
      site_id: site_id,
      timestamp: new Date().toISOString()
    }
  };

  console.log(`📋 Created fallback search results for operation: ${operation.type}`);
  return fallbackResults;
}

/**
 * Create fallback analysis results when API is not available
 */
function createFallbackAnalysis(request: AnalysisRequest): any {
  const { research_topic, site_id, deliverables } = request;
  
  const fallbackAnalysis = {
    research_topic,
    site_id,
    timestamp: new Date().toISOString(),
    fallback_mode: true,
    deliverables: deliverables || {},
    analysis: {
      status: 'fallback_mode',
      message: 'Deep research API not available - using fallback analysis',
      research_topic,
      basic_insights: [
        `Research topic: ${research_topic}`,
        'API service temporarily unavailable',
        'Workflow continued in fallback mode'
      ]
    },
    insights: [
      {
        type: 'system_status',
        message: 'Deep research API not available',
        severity: 'warning',
        timestamp: new Date().toISOString()
      }
    ],
    recommendations: [
      'Retry workflow when API service is restored',
      'Check API configuration and connectivity',
      'Review system logs for detailed error information'
    ]
  };

  console.log(`📋 Created fallback analysis for research topic: ${research_topic}`);
  return fallbackAnalysis;
}

/**
 * Create fallback segmentation results when API is not available
 */
function createFallbackSegmentation(request: LeadSegmentationRequest): any {
  const { lead_id, site_id } = request;
  
  const fallbackSegmentation = {
    lead_id,
    site_id,
    timestamp: new Date().toISOString(),
    fallback_mode: true,
    segmentation: {
      status: 'fallback_mode',
      message: 'Lead segmentation API not available - using fallback segmentation',
      lead_id,
      basic_info: {
        id: lead_id,
        status: 'unknown',
        priority: 'medium',
        source: 'unknown'
      }
    },
    metadata: {
      fallback_mode: true,
      message: 'API not available - using fallback mode',
      site_id: site_id,
      lead_id: lead_id,
      timestamp: new Date().toISOString()
    }
  };

  console.log(`📋 Created fallback segmentation for lead: ${lead_id}`);
  return fallbackSegmentation;
}

/**
 * Activity to start deep research and get operations list
 * Now with improved error handling and fallback mechanisms
 */
export async function deepResearchActivity(
  request: DeepResearchRequest
): Promise<DeepResearchResponse> {
  console.log(`🔬 Starting deep research for topic: ${request.research_topic}, site: ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  let retryCount = 0;
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  while (retryCount < maxRetries) {
    try {
      console.log(`🔄 Attempt ${retryCount + 1}/${maxRetries} for deep research API call`);
      
      // Use extended timeout for deep research operations (10 minutes to match activity timeout)
      const response = await apiService.request('/api/agents/dataAnalyst/deepResearch', {
        method: 'POST',
        body: request,
        timeout: 600000 // 10 minutes timeout (600,000ms) to match workflow activity timeout
      });

      if (!response.success) {
        console.error(`❌ Deep research failed (attempt ${retryCount + 1}):`, response.error);
        
        // Check if this is a critical error that should trigger fallback immediately
        if (response.error?.status === 404 || response.error?.code === 'HTTP_404') {
          console.log(`🔄 API endpoint not found - switching to fallback mode immediately`);
          break; // Exit retry loop and go to fallback
        }
        
        // For other errors, retry if we haven't exceeded max retries
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
        
        // Max retries reached, switch to fallback
        console.log(`🔄 Max retries reached - switching to fallback mode`);
        break;
      }

      // Debug: Log the complete response structure to understand where data is
      console.log(`🔍 Deep research API response structure:`, JSON.stringify(response, null, 2));

      // After apiService changes, we need to look for operations in multiple places
      // Try to find operations in various possible locations
      let operations: any[] = [];
      let command_id: string | undefined;
      
      // Cast response to any to access potential properties that may not be in ApiResponse interface
      const apiResponse = response as any;
      
      // Check different possible locations for operations
      if (response.data?.operations) {
        operations = response.data.operations;
        console.log(`✅ Found operations in response.data.operations (${operations.length} operations)`);
      } else if (response.data?.data?.operations) {
        operations = response.data.data.operations;
        console.log(`✅ Found operations in response.data.data.operations (${operations.length} operations)`);
      } else if (response.data?.results) {
        operations = response.data.results;
        console.log(`✅ Found operations in response.data.results (${operations.length} operations)`);
      } else if (apiResponse.operations) {
        operations = apiResponse.operations;
        console.log(`✅ Found operations in response.operations (${operations.length} operations)`);
      } else if (Array.isArray(response.data)) {
        operations = response.data;
        console.log(`✅ Found operations as response.data array (${operations.length} operations)`);
      } else {
        console.log(`⚠️ No operations found in response structure`);
        console.log(`🔍 Available response.data keys:`, Object.keys(response.data || {}));
        operations = [];
      }

      // Check different possible locations for command_id
      if (response.data?.command_id) {
        command_id = response.data.command_id;
        console.log(`✅ Found command_id in response.data.command_id: ${command_id}`);
      } else if (response.data?.data?.command_id) {
        command_id = response.data.data.command_id;
        console.log(`✅ Found command_id in response.data.data.command_id: ${command_id}`);
      } else if (apiResponse.command_id) {
        command_id = apiResponse.command_id;
        console.log(`✅ Found command_id in response.command_id: ${command_id}`);
      } else {
        console.log(`⚠️ No command_id found in response`);
      }
      
      // Fix parsing issue: ensure expected_deliverables is an object, not a JSON string
      if (Array.isArray(operations)) {
        operations.forEach((operation: any, index: number) => {
          if (operation.expected_deliverables && typeof operation.expected_deliverables === 'string') {
            try {
              console.log(`🔧 Parsing expected_deliverables from JSON string for operation ${index + 1}`);
              operation.expected_deliverables = JSON.parse(operation.expected_deliverables);
              console.log(`✅ Successfully parsed expected_deliverables for operation ${index + 1}`);
            } catch (parseError) {
              console.error(`⚠️ Failed to parse expected_deliverables for operation ${index + 1}:`, parseError);
              // Keep the original string value if parsing fails
            }
          }
        });
      }
      
      console.log(`✅ Deep research started successfully`);
      console.log(`📊 Generated ${operations.length} operations`);
      
      if (operations.length > 0) {
        console.log(`🔍 Operations:`);
        operations.forEach((op: Operation, index: number) => {
          console.log(`   ${index + 1}. ${op.type || op.description || `Operation ${index + 1}`}`);
          // Log the type of expected_deliverables to verify it's now an object
          if (op.expected_deliverables) {
            console.log(`      - expected_deliverables type: ${typeof op.expected_deliverables}`);
          }
        });
      }

      // Create enhanced response data that includes command_id at the top level for workflow access
      const enhancedData = {
        ...response.data,
        command_id: command_id, // Ensure command_id is available at top level
        operations: operations   // Ensure operations are available at top level
      };

      return {
        success: true,
        operations,
        data: enhancedData,
        fallback: false
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Deep research failed (attempt ${retryCount + 1}): ${errorMessage}`);
      
      // Check if this is a network timeout or connection error
      if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch')) {
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Network error - retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
      }
      
      // For other errors or max retries reached, switch to fallback
      console.log(`🔄 Error occurred - switching to fallback mode`);
      break;
    }
  }

  // Fallback mode - API not available
  console.log(`🔄 FALLBACK MODE: Deep research API not available - creating fallback operations`);
  
  const fallbackOperations = createFallbackOperations(request);
  const fallbackData = {
    fallback_mode: true,
    message: 'Deep research API not available - using fallback operations',
    site_id: request.site_id,
    research_topic: request.research_topic,
    timestamp: new Date().toISOString(),
    operations: fallbackOperations
  };

  return {
    success: true, // Still return success to allow workflow to continue
    operations: fallbackOperations,
    data: fallbackData,
    fallback: true,
    error: 'API not available - using fallback mode'
  };
}

/**
 * Activity to execute search operation
 * Now with improved error handling and fallback mechanisms
 */
export async function searchOperationActivity(
  request: SearchRequest
): Promise<SearchResponse> {
  console.log(`🔍 Executing search operation: ${request.operation.type || request.operation.id}`);
  console.log(`📋 Individual Operation (not array):`, JSON.stringify(request.operation, null, 2));

  let retryCount = 0;
  const maxRetries = 2;
  const retryDelay = 1000; // 1 second

  while (retryCount < maxRetries) {
    try {
      console.log(`🔄 Attempt ${retryCount + 1}/${maxRetries} for search operation API call`);
      
      // Validate that search_queries is properly formatted
      if (!request.operation.search_queries) {
        throw new Error('Operation missing search_queries field');
      }
      
      if (!Array.isArray(request.operation.search_queries)) {
        console.error(`❌ search_queries is not an array:`, typeof request.operation.search_queries, request.operation.search_queries);
        throw new Error('search_queries must be an array');
      }
      
      if (request.operation.search_queries.length === 0) {
        throw new Error('search_queries must be a non-empty array');
      }

      console.log(`✅ Validated search_queries: ${request.operation.search_queries.length} queries`);
      console.log(`🔍 Queries:`, request.operation.search_queries);

      const requestBody = {
        operation: request.operation,  // Single operation object, NOT an array
        ...(request.site_id && { site_id: request.site_id }),
        ...(request.userId && { userId: request.userId }),
        ...(request.command_id && { command_id: request.command_id }),
        ...(request.deliverables && { deliverables: request.deliverables })
      };

      console.log(`📤 Final request body being sent to API:`, JSON.stringify(requestBody, null, 2));

      // Use extended timeout for search operations (10 minutes to match activity timeout)
      const response = await apiService.request('/api/agents/dataAnalyst/search', {
        method: 'POST',
        body: requestBody,
        timeout: 600000 // 10 minutes timeout (600,000ms) to match workflow activity timeout
      });

      if (!response.success) {
        console.error(`❌ Search operation failed (attempt ${retryCount + 1}):`, response.error);
        
        // Check if this is a critical error that should trigger fallback immediately
        if (response.error?.status === 404 || response.error?.code === 'HTTP_404') {
          console.log(`🔄 API endpoint not found - switching to fallback mode immediately`);
          break; // Exit retry loop and go to fallback
        }
        
        // For other errors, retry if we haven't exceeded max retries
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
        
        // Max retries reached, switch to fallback
        console.log(`🔄 Max retries reached - switching to fallback mode`);
        break;
      }

      const results = response.data?.results || response.data?.data || [];
      
      console.log(`✅ Search operation completed successfully`);
      console.log(`📊 Found ${Array.isArray(results) ? results.length : 'N/A'} results`);

      return {
        success: true,
        data: response.data,
        results,
        fallback: false
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Search operation failed (attempt ${retryCount + 1}): ${errorMessage}`);
      
      // Check if this is a network timeout or connection error
      if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch')) {
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Network error - retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
      }
      
      // For other errors or max retries reached, switch to fallback
      console.log(`🔄 Error occurred - switching to fallback mode`);
      break;
    }
  }

  // Fallback mode - API not available
  console.log(`🔄 FALLBACK MODE: Search operation API not available - creating fallback results`);
  
  const fallbackResults = createFallbackSearchResults(request);

  return {
    success: true, // Still return success to allow workflow to continue
    data: fallbackResults,
    results: fallbackResults.results,
    fallback: true,
    error: 'API not available - using fallback mode'
  };
}

/**
 * Activity to perform final analysis on all operation results
 * Now with improved error handling and fallback mechanisms
 */
export async function dataAnalysisActivity(
  request: AnalysisRequest
): Promise<AnalysisResponse> {
  console.log(`📊 Performing data analysis for topic: ${request.research_topic}, site: ${request.site_id}`);
  console.log(`📋 Analysis request with command_id: ${request.command_id}`);

  let retryCount = 0;
  const maxRetries = 2;
  const retryDelay = 1000; // 1 second

  while (retryCount < maxRetries) {
    try {
      console.log(`🔄 Attempt ${retryCount + 1}/${maxRetries} for data analysis API call`);
      
      // Send the complete request including command_id if present
      console.log(`📤 Final analysis request being sent to API:`, JSON.stringify(request, null, 2));
      
      // Use extended timeout for data analysis operations (10 minutes to match activity timeout)
      const response = await apiService.request('/api/agents/dataAnalyst/analysis', {
        method: 'POST',
        body: request,
        timeout: 600000 // 10 minutes timeout (600,000ms) to match workflow activity timeout
      });

      if (!response.success) {
        console.error(`❌ Data analysis failed (attempt ${retryCount + 1}):`, response.error);
        
        // Check if this is a critical error that should trigger fallback immediately
        if (response.error?.status === 404 || response.error?.code === 'HTTP_404') {
          console.log(`🔄 API endpoint not found - switching to fallback mode immediately`);
          break; // Exit retry loop and go to fallback
        }
        
        // For other errors, retry if we haven't exceeded max retries
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
        
        // Max retries reached, switch to fallback
        console.log(`🔄 Max retries reached - switching to fallback mode`);
        break;
      }

      const analysis = response.data?.analysis || response.data;
      const insights = response.data?.insights || response.data?.findings || [];
      const recommendations = response.data?.recommendations || response.data?.next_steps || [];
      
      console.log(`✅ Data analysis completed successfully`);
      
      if (insights.length > 0) {
        console.log(`🔍 Generated ${insights.length} insights`);
      }
      
      if (recommendations.length > 0) {
        console.log(`💡 Generated ${recommendations.length} recommendations`);
      }

      return {
        success: true,
        analysis,
        insights,
        recommendations,
        data: response.data,
        fallback: false
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Data analysis failed (attempt ${retryCount + 1}): ${errorMessage}`);
      
      // Check if this is a network timeout or connection error
      if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch')) {
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Network error - retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
      }
      
      // For other errors or max retries reached, switch to fallback
      console.log(`🔄 Error occurred - switching to fallback mode`);
      break;
    }
  }

  // Fallback mode - API not available
  console.log(`🔄 FALLBACK MODE: Data analysis API not available - creating fallback analysis`);
  
  const fallbackAnalysis = createFallbackAnalysis(request);

  return {
    success: true, // Still return success to allow workflow to continue
    analysis: fallbackAnalysis.analysis,
    insights: fallbackAnalysis.insights,
    recommendations: fallbackAnalysis.recommendations,
    data: fallbackAnalysis,
    fallback: true,
    error: 'API not available - using fallback mode'
  };
}

/**
 * Activity to perform lead segmentation analysis
 * Now with improved error handling and fallback mechanisms
 */
export async function leadSegmentationActivity(
  request: LeadSegmentationRequest
): Promise<LeadSegmentationResponse> {
  console.log(`🎯 Performing lead segmentation for lead: ${request.lead_id}, site: ${request.site_id}`);
  console.log(`📋 Segmentation request:`, JSON.stringify(request, null, 2));

  let retryCount = 0;
  const maxRetries = 2;
  const retryDelay = 1000; // 1 second

  while (retryCount < maxRetries) {
    try {
      console.log(`🔄 Attempt ${retryCount + 1}/${maxRetries} for lead segmentation API call`);
      
      const requestBody = {
        site_id: request.site_id,
        lead_id: request.lead_id,
        ...(request.userId && { userId: request.userId }),
        ...(request.additionalData && { ...request.additionalData })
      };

      console.log(`📤 Final segmentation request being sent to API:`, JSON.stringify(requestBody, null, 2));

      // Use reasonable timeout for lead segmentation operations
      const response = await apiService.request('/api/agents/dataAnalyst/leadSegmentation', {
        method: 'POST',
        body: requestBody,
        timeout: 300000 // 5 minutes timeout for segmentation operations
      });

      if (!response.success) {
        console.error(`❌ Lead segmentation failed (attempt ${retryCount + 1}):`, response.error);
        
        // Check if this is a critical error that should trigger fallback immediately
        if (response.error?.status === 404 || response.error?.code === 'HTTP_404') {
          console.log(`🔄 API endpoint not found - switching to fallback mode immediately`);
          break; // Exit retry loop and go to fallback
        }
        
        // For other errors, retry if we haven't exceeded max retries
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
        
        // Max retries reached, switch to fallback
        console.log(`🔄 Max retries reached - switching to fallback mode`);
        break;
      }

      const segmentation = response.data?.segmentation || response.data;
      
      console.log(`✅ Lead segmentation completed successfully`);
      console.log(`🎯 Segmentation result:`, JSON.stringify(segmentation, null, 2));

      return {
        success: true,
        data: response.data,
        segmentation,
        fallback: false
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Lead segmentation failed (attempt ${retryCount + 1}): ${errorMessage}`);
      
      // Check if this is a network timeout or connection error
      if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch')) {
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Network error - retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
      }
      
      // For other errors or max retries reached, switch to fallback
      console.log(`🔄 Error occurred - switching to fallback mode`);
      break;
    }
  }

  // Fallback mode - API not available
  console.log(`🔄 FALLBACK MODE: Lead segmentation API not available - creating fallback segmentation`);
  
  const fallbackSegmentation = createFallbackSegmentation(request);

  return {
    success: true, // Still return success to allow workflow to continue
    data: fallbackSegmentation,
    segmentation: fallbackSegmentation.segmentation,
    fallback: true,
    error: 'API not available - using fallback mode'
  };
} 