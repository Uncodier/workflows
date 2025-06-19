import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  deepResearchActivity,
  searchOperationActivity,
  dataAnalysisActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes', // Extended timeout for data analysis operations
  retry: {
    maximumAttempts: 3,
  },
});

export interface DeepResearchOptions {
  site_id: string;                    // Required: Site ID
  research_topic: string;             // Required: Research topic
  userId?: string;
  additionalData?: any;
}

export interface DeepResearchResult {
  success: boolean;
  siteId: string;
  researchTopic: string;
  siteName?: string;
  siteUrl?: string;
  operations?: any[];
  operationResults?: any[];
  analysis?: any;
  insights?: any[];
  recommendations?: any[];
  data?: any;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to execute deep research using data analyst
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain site details
 * 2. Starts deep research to get a list of operations to perform
 * 3. Executes each search operation sequentially
 * 4. Performs final analysis on all operation results
 * 
 * @param options - Configuration options for deep research
 */
export async function deepResearchWorkflow(
  options: DeepResearchOptions
): Promise<DeepResearchResult> {
  const { site_id, research_topic } = options;
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  if (!research_topic) {
    throw new Error('No research topic provided');
  }
  
  const workflowId = `deep-research-${site_id}-${Date.now()}`;
  const startTime = Date.now();
  
  console.log(`🔬 Starting deep research workflow for topic "${research_topic}" on site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'deepResearchWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `deep-research-${site_id}`,
    activityName: 'deepResearchWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let operations: any[] = [];
  const operationResults: any[] = [];
  let analysis: any = null;
  let insights: any[] = [];
  let recommendations: any[] = [];
  let siteName = '';
  let siteUrl = '';
  let data: any = null;

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information to obtain site details
    const siteResult = await getSiteActivity(site_id);
    
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

    console.log(`🔬 Step 2: Starting deep research for topic "${research_topic}"...`);
    
    // Prepare deep research request
    const researchRequest = {
      site_id: site_id,
      research_topic: research_topic,
      userId: options.userId || site.user_id,
      additionalData: options.additionalData
    };
    
    console.log(`🔧 Deep research configuration:`);
    console.log(`   - Site ID: ${researchRequest.site_id}`);
    console.log(`   - Research Topic: ${researchRequest.research_topic}`);
    console.log(`   - User ID: ${researchRequest.userId}`);
    
    // Execute deep research to get operations
    const researchResult = await deepResearchActivity(researchRequest);
    
    if (!researchResult.success) {
      const errorMsg = `Failed to start deep research: ${researchResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Debug: Log the complete research result to understand the structure
    console.log(`🔍 Deep research result structure:`, JSON.stringify(researchResult, null, 2));
    
    operations = researchResult.operations || [];
    data = researchResult.data;
    
    // Check if operations are in data.operations instead
    if (operations.length === 0 && data && data.operations) {
      console.log(`🔄 Found operations in data.operations, using those instead`);
      operations = data.operations;
    }
    
    // Check if operations are nested in data.data.operations
    if (operations.length === 0 && data && data.data && data.data.operations) {
      console.log(`🔄 Found operations in data.data.operations, extracting to main level`);
      operations = data.data.operations;
      
      // Also extract other useful fields from the nested structure
      if (data.data.commandId) {
        console.log(`📋 Command ID: ${data.data.commandId}`);
      }
      if (data.data.status) {
        console.log(`📊 Status: ${data.data.status}`);
      }
      if (data.data.message) {
        console.log(`💬 Message: ${data.data.message}`);
      }
    }
    
    console.log(`✅ Deep research started successfully`);
    console.log(`📊 Generated ${operations.length} operations to execute`);
    
    if (operations.length === 0) {
      console.log(`⚠️ No operations generated for research topic "${research_topic}"`);
      console.log(`🔍 Data structure:`, JSON.stringify(data, null, 2));
      errors.push('No operations generated for the research topic');
    } else {
      console.log(`🔧 Operations structure sample:`, JSON.stringify(operations[0], null, 2));
      
      // Validate operation structure
      const validOperations = operations.filter(op => {
        const isValid = op && 
          (op.type || op.search_queries || op.objective) && 
          (Array.isArray(op.search_queries) || typeof op.search_queries === 'string');
        
        if (!isValid) {
          console.log(`⚠️ Invalid operation structure found:`, JSON.stringify(op, null, 2));
        }
        
        return isValid;
      });
      
      if (validOperations.length !== operations.length) {
        console.log(`⚠️ Filtered out ${operations.length - validOperations.length} invalid operations`);
        operations = validOperations;
      }
    }

    // Step 3: Execute each search operation
    if (operations.length > 0) {
      console.log(`🔍 Step 3: Executing ${operations.length} search operations...`);
      
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        console.log(`🔍 Executing operation ${i + 1}/${operations.length}: ${operation.type || operation.description || `Operation ${i + 1}`}`);
        console.log(`🔧 Operation details:`, JSON.stringify(operation, null, 2));
        
        try {
          // Validate the operation structure before sending
          if (!operation.search_queries) {
            console.error(`❌ Operation missing search_queries:`, JSON.stringify(operation, null, 2));
            throw new Error('Operation missing search_queries field');
          }
          
          if (!Array.isArray(operation.search_queries) || operation.search_queries.length === 0) {
            console.error(`❌ Invalid search_queries format:`, operation.search_queries);
            throw new Error('search_queries must be a non-empty array');
          }
          
          // Pass the complete operation structure as an individual object (not array)
          const searchRequest = {
            operation: operation, // This should include type, objective, search_queries, search_options, expected_deliverables
            site_id: site_id,
            userId: options.userId || site.user_id
          };
          
          console.log(`📤 Sending search request for individual operation:`, JSON.stringify(searchRequest, null, 2));
          console.log(`🔍 Operation search_queries count: ${operation.search_queries.length}`);
          
          const searchResult = await searchOperationActivity(searchRequest);
          
          console.log(`📥 Search result for operation ${i + 1}:`, JSON.stringify(searchResult, null, 2));
          
          if (!searchResult.success) {
            const errorMsg = `Operation ${i + 1} failed: ${searchResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            // Continue with other operations even if one fails
            operationResults.push({
              operation: operation,
              success: false,
              error: searchResult.error,
              searchResult: searchResult
            });
          } else {
            console.log(`✅ Operation ${i + 1} completed successfully`);
            operationResults.push({
              operation: operation,
              success: true,
              data: searchResult.data,
              results: searchResult.results,
              searchResult: searchResult
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ Exception in operation ${i + 1}: ${errorMessage}`);
          errors.push(`Operation ${i + 1} exception: ${errorMessage}`);
          operationResults.push({
            operation: operation,
            success: false,
            error: errorMessage
          });
        }
      }
      
      const successfulOperations = operationResults.filter(result => result.success);
      console.log(`📊 Operations summary: ${successfulOperations.length}/${operations.length} successful`);
    }

    // Step 4: Perform final analysis on all operation results
    if (operationResults.length > 0) {
      console.log(`📊 Step 4: Performing final analysis on ${operationResults.length} operation results...`);
      
      try {
        const analysisRequest = {
          site_id: site_id,
          operations_results: operationResults,
          research_topic: research_topic,
          userId: options.userId || site.user_id,
          additionalData: options.additionalData
        };
        
        const analysisResult = await dataAnalysisActivity(analysisRequest);
        
        if (!analysisResult.success) {
          const errorMsg = `Failed to perform data analysis: ${analysisResult.error}`;
          console.error(`⚠️ ${errorMsg}`);
          errors.push(errorMsg);
          // Note: We don't throw here as we have partial results
        } else {
          analysis = analysisResult.analysis;
          insights = analysisResult.insights || [];
          recommendations = analysisResult.recommendations || [];
          
          console.log(`✅ Data analysis completed successfully`);
          
          if (insights.length > 0) {
            console.log(`🔍 Generated ${insights.length} insights`);
          }
          
          if (recommendations.length > 0) {
            console.log(`💡 Generated ${recommendations.length} recommendations`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ Exception during data analysis: ${errorMessage}`);
        errors.push(`Data analysis exception: ${errorMessage}`);
        // Note: We don't throw here as we have partial results
      }
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Clean up data to avoid nested structure issues
    // Only include essential information without the problematic nested structure
    const cleanData = data && data.data ? {
      success: data.success,
      commandId: data.data.commandId,
      status: data.data.status,
      message: data.data.message,
      agent_id: data.data.agent_id,
      research_topic: data.data.research_topic,
      research_depth: data.data.research_depth,
      siteName: data.data.siteName,
      siteUrl: data.data.siteUrl,
      errors: data.data.errors || [],
      executionTime: data.data.executionTime,
      completedAt: data.data.completedAt
      // Note: NOT including the nested operations to avoid duplication
    } : data;
    
    const result: DeepResearchResult = {
      success: true,
      siteId: site_id,
      researchTopic: research_topic,
      siteName,
      siteUrl,
      operations,
      operationResults,
      analysis,
      insights,
      recommendations,
      data: cleanData,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Deep research workflow completed successfully!`);
    console.log(`📊 Summary: Research on "${research_topic}" for ${siteName} completed in ${executionTime}`);
    console.log(`   - Operations executed: ${operationResults.length}`);
    console.log(`   - Insights generated: ${insights.length}`);
    console.log(`   - Recommendations: ${recommendations.length}`);
    
    if (errors.length > 0) {
      console.log(`⚠️ Warnings: ${errors.length} non-critical errors occurred`);
    }

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `deep-research-${site_id}`,
      activityName: 'deepResearchWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'deepResearchWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Deep research workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `deep-research-${site_id}`,
      activityName: 'deepResearchWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'deepResearchWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Clean up data even in error cases
    const cleanData = data && data.data ? {
      success: data.success,
      commandId: data.data.commandId,
      status: data.data.status,
      message: data.data.message,
      agent_id: data.data.agent_id,
      research_topic: data.data.research_topic,
      research_depth: data.data.research_depth,
      siteName: data.data.siteName,
      siteUrl: data.data.siteUrl,
      errors: data.data.errors || [],
      executionTime: data.data.executionTime,
      completedAt: data.data.completedAt
    } : data;

    // Return failed result instead of throwing to provide more information
    const result: DeepResearchResult = {
      success: false,
      siteId: site_id,
      researchTopic: research_topic,
      siteName,
      siteUrl,
      operations,
      operationResults,
      analysis,
      insights,
      recommendations,
      data: cleanData,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 