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
}

export interface DeepResearchResponse {
  success: boolean;
  operations?: Operation[];
  data?: any;
  error?: string;
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
}

export interface SearchResponse {
  success: boolean;
  data?: any;
  results?: any[];
  error?: string;
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
}

/**
 * Activity to start deep research and get operations list
 */
export async function deepResearchActivity(
  request: DeepResearchRequest
): Promise<DeepResearchResponse> {
  console.log(`🔬 Starting deep research for topic: ${request.research_topic}, site: ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    const response = await apiService.post('/api/agents/dataAnalyst/deepResearch', request);

    if (!response.success) {
      console.error(`❌ Deep research failed:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to start deep research'
      };
    }

    const operations = response.data?.operations || response.data?.results || [];
    
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

    // Flatten the data structure if it has nested data.data
    let flattenedData = response.data;
    if (response.data && response.data.data && typeof response.data.data === 'object') {
      console.log(`🔄 Flattening nested data.data structure to avoid unnecessary nesting`);
      flattenedData = {
        ...response.data,
        ...response.data.data, // Merge the nested data to the top level
        // Remove the nested data property to avoid duplication
        data: undefined
      };
      // Clean up undefined values
      delete flattenedData.data;
    }

    return {
      success: true,
      operations,
      data: flattenedData
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Deep research failed: ${errorMessage}`);
    
    return {
      success: false,
      error: `Deep research activity failed: ${errorMessage}`
    };
  }
}

/**
 * Activity to execute search operation
 */
export async function searchOperationActivity(
  request: SearchRequest
): Promise<SearchResponse> {
  console.log(`🔍 Executing search operation: ${request.operation.type || request.operation.id}`);
  console.log(`📋 Individual Operation (not array):`, JSON.stringify(request.operation, null, 2));

  try {
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
      ...(request.command_id && { command_id: request.command_id })
    };

    console.log(`📤 Final request body being sent to API:`, JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/dataAnalyst/search', requestBody);

    if (!response.success) {
      console.error(`❌ Search operation failed:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute search operation'
      };
    }

    const results = response.data?.results || response.data?.data || [];
    
    console.log(`✅ Search operation completed successfully`);
    console.log(`📊 Found ${Array.isArray(results) ? results.length : 'N/A'} results`);

    // Flatten the data structure if it has nested data.data
    let flattenedData = response.data;
    if (response.data && response.data.data && typeof response.data.data === 'object') {
      console.log(`🔄 Flattening nested data.data structure to avoid unnecessary nesting`);
      flattenedData = {
        ...response.data,
        ...response.data.data, // Merge the nested data to the top level
        // Remove the nested data property to avoid duplication
        data: undefined
      };
      // Clean up undefined values
      delete flattenedData.data;
    }

    return {
      success: true,
      data: flattenedData,
      results
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Search operation failed: ${errorMessage}`);
    
    return {
      success: false,
      error: `Search operation activity failed: ${errorMessage}`
    };
  }
}

/**
 * Activity to perform final analysis on all operation results
 */
export async function dataAnalysisActivity(
  request: AnalysisRequest
): Promise<AnalysisResponse> {
  console.log(`📊 Performing data analysis for topic: ${request.research_topic}, site: ${request.site_id}`);
  console.log(`📋 Analysis request with command_id: ${request.command_id}`);

  try {
    // Send the complete request including command_id if present
    console.log(`📤 Final analysis request being sent to API:`, JSON.stringify(request, null, 2));
    
    const response = await apiService.post('/api/agents/dataAnalyst/analysis', request);

    if (!response.success) {
      console.error(`❌ Data analysis failed:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to perform data analysis'
      };
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

    // Flatten the data structure if it has nested data.data
    let flattenedData = response.data;
    if (response.data && response.data.data && typeof response.data.data === 'object') {
      console.log(`🔄 Flattening nested data.data structure to avoid unnecessary nesting`);
      flattenedData = {
        ...response.data,
        ...response.data.data, // Merge the nested data to the top level
        // Remove the nested data property to avoid duplication
        data: undefined
      };
      // Clean up undefined values
      delete flattenedData.data;
    }

    return {
      success: true,
      analysis,
      insights,
      recommendations,
      data: flattenedData
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Data analysis failed: ${errorMessage}`);
    
    return {
      success: false,
      error: `Data analysis activity failed: ${errorMessage}`
    };
  }
} 