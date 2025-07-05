import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getCompanyActivity,
  upsertCompanyActivity,
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
  deliverables?: any;                 // Optional: Expected deliverables structure for lead updates
}

export interface DeepResearchResponse {
  success: boolean;
  data: any;
  error: any;
}

/**
 * Helper function to safely extract string values, handling empty objects
 */
const safeString = (value: any): string | null => {
  if (!value) return null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'object' && Object.keys(value).length === 0) return null;
  return typeof value === 'string' ? value : null;
};

/**
 * Generates a company structure based on the database schema
 */
function generateCompanyStructure(existingCompany?: any): any {

  return {
    // Basic required fields
    name: safeString(existingCompany?.name),
    
    // Basic optional fields
    website: safeString(existingCompany?.website),
    industry: safeString(existingCompany?.industry),
    size: safeString(existingCompany?.size),
    annual_revenue: safeString(existingCompany?.annual_revenue),
    founded: safeString(existingCompany?.founded),
    description: safeString(existingCompany?.description),
    address: existingCompany?.address || {},
    
    // Legal information
    legal_name: safeString(existingCompany?.legal_name),
    tax_id: safeString(existingCompany?.tax_id),
    tax_country: safeString(existingCompany?.tax_country),
    registration_number: safeString(existingCompany?.registration_number),
    vat_number: safeString(existingCompany?.vat_number),
    legal_structure: safeString(existingCompany?.legal_structure),
    
    // Contact information
    phone: safeString(existingCompany?.phone),
    email: safeString(existingCompany?.email),
    linkedin_url: safeString(existingCompany?.linkedin_url),
    
    // Company details
    employees_count: existingCompany?.employees_count || null,
    is_public: existingCompany?.is_public || false,
    stock_symbol: safeString(existingCompany?.stock_symbol),
    parent_company_id: existingCompany?.parent_company_id || null,
    
    // Media and branding
    logo_url: safeString(existingCompany?.logo_url),
    cover_image_url: safeString(existingCompany?.cover_image_url),
    video_url: safeString(existingCompany?.video_url),
    
    // Social and business information
    social_media: existingCompany?.social_media || {},
    key_people: existingCompany?.key_people || [],
    funding_info: existingCompany?.funding_info || {},
    certifications: existingCompany?.certifications || [],
    awards: existingCompany?.awards || [],
    
    // Business model and operations
    business_model: safeString(existingCompany?.business_model),
    products_services: existingCompany?.products_services || [],
    tech_stack: existingCompany?.tech_stack || [],
    languages: existingCompany?.languages || ['en'],
    business_hours: existingCompany?.business_hours || {},
    
    // Strategic information
    press_releases: existingCompany?.press_releases || [],
    partnerships: existingCompany?.partnerships || [],
    competitor_info: existingCompany?.competitor_info || {},
    sustainability_score: existingCompany?.sustainability_score || null,
    diversity_info: existingCompany?.diversity_info || {},
    
    // Work and location information
    remote_policy: safeString(existingCompany?.remote_policy),
    office_locations: existingCompany?.office_locations || [],
    
    // Financial information
    market_cap: existingCompany?.market_cap || null,
    last_funding_date: existingCompany?.last_funding_date || null,
    ipo_date: existingCompany?.ipo_date || null,
    acquisition_date: existingCompany?.acquisition_date || null,
    acquired_by_id: existingCompany?.acquired_by_id || null,
    
    // Metadata for research workflow
    _preserve_fields: ['id', 'created_at', 'updated_at'],
    _research_timestamp: new Date().toISOString(),
    _research_source: 'deep_research_workflow'
  };
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
): Promise<DeepResearchResponse> {
  const { site_id, research_topic } = options;
  
  if (!site_id) {
    return {
      success: false,
      data: null,
      error: 'No site ID provided'
    };
  }
  
  if (!research_topic) {
    return {
      success: false,
      data: null,
      error: 'No research topic provided'
    };
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
  let insights: any[] = [];
  let recommendations: any[] = [];
  let research_analysis: any = null; // Initialize at workflow level
  let siteName = '';
  let siteUrl = '';
  let companyInfo: any = null;
  let enhancedDeliverables: any = null; // Initialize at workflow level

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

    // Step 1.5: Get company information if company_id is provided
    const companyId: string | undefined = options.additionalData?.leadInfo?.company_id;
    if (companyId) {
      console.log(`🏢 Step 1.5: Getting company information for company_id: ${companyId}...`);
      
      try {
        const companyResult = await getCompanyActivity(companyId);
        
        if (companyResult.success && companyResult.company) {
          companyInfo = companyResult.company;
          console.log(`✅ Retrieved company information: ${companyInfo.name}`);
        } else {
          console.log(`⚠️  Company ${companyId} not found or error: ${companyResult.error}`);
        }
      } catch (error) {
        console.error(`⚠️  Error fetching company ${companyId}:`, error);
      }
    } else {
      console.log(`ℹ️  No company_id provided in additionalData, skipping company lookup`);
    }

    console.log(`🔬 Step 2: Starting deep research for topic "${research_topic}"...`);
    
    // Prepare deep research request with structured deliverables
    // Support multiple deliverable structures:
    // 1. New unified structure: deliverables.leads (with company info integrated)
    // 2. Old separate structure: deliverables.lead + deliverables.company
    // 3. Legacy structure: deliverables (generic)
    
    if (options.deliverables && options.deliverables.leads && Array.isArray(options.deliverables.leads)) {
      // New unified structure: deliverables.leads with integrated company info
      console.log(`📋 Using new unified deliverables structure (deliverables.leads)`);
      
      // For the new structure, we still need to provide both lead and company structures
      // for backwards compatibility with existing activities
      const firstLead = options.deliverables.leads[0] || {};
      const companyStructure = generateCompanyStructure(companyInfo);
      
      // Extract company information from the first lead (if available)
      const leadCompanyInfo = firstLead.company || {};
      const leadCompanyName = leadCompanyInfo.name || firstLead.company_name || 
                             safeString(options.additionalData?.leadInfo?.company_name);
      
      enhancedDeliverables = {
        // Keep the unified leads structure for new workflows
        leads: options.deliverables.leads,
        
        // Also provide separate lead/company structures for backwards compatibility
        lead: {
          // Extract lead info from first lead for compatibility
          name: firstLead.name || null,
          telephone: firstLead.telephone || null,
          email: firstLead.email || null,
          position: firstLead.position || null,
          address: firstLead.address || null,
          web: firstLead.web || null
        },
        company: {
          ...companyStructure,
          ...leadCompanyInfo, // Override with company info from lead
          name: leadCompanyName || companyStructure.name
        }
      };
      
      console.log(`🔧 Unified structure - leads count: ${options.deliverables.leads.length}`);
      console.log(`🔧 Company from lead: ${leadCompanyName || 'None'}`);
      
    } else if (options.deliverables && options.deliverables.lead && options.deliverables.company) {
      // Old separate structure: deliverables.lead + deliverables.company
      console.log(`📋 Using old separate deliverables structure (lead + company)`);
      const companyStructure = generateCompanyStructure(companyInfo);
      
      // Merge the existing company info with the structured company template
      const leadCompanyName = safeString(options.additionalData?.leadInfo?.company_name);
      const leadCompany = options.deliverables.company || {};
      
      enhancedDeliverables = {
        lead: options.deliverables.lead,
        company: {
          ...companyStructure,
          ...leadCompany, // Override with existing data from lead
          // Prioritize company_name from lead if available
          name: leadCompanyName || safeString(leadCompany.name) || companyStructure.name
        }
      };
      
    } else {
      // Generic deep research: create structure from scratch
      console.log(`📋 Creating fresh deliverable structure for generic deep research`);
      const companyStructure = generateCompanyStructure(companyInfo);
      
      // Also check if lead has company_name in additionalData
      const leadCompanyName = safeString(options.additionalData?.leadInfo?.company_name);
      
      enhancedDeliverables = {
        lead: options.deliverables || {},
        company: {
          ...companyStructure,
          // Use company_name from lead if available
          name: leadCompanyName || companyStructure.name
        }
      };
    }
    
    const researchRequest = {
      site_id: site_id,
      research_topic: research_topic,
      userId: options.userId || site.user_id,
      additionalData: options.additionalData,
      deliverables: enhancedDeliverables
    };
    
    console.log(`🔧 Deep research configuration:`);
    console.log(`   - Site ID: ${researchRequest.site_id}`);
    console.log(`   - Research Topic: ${researchRequest.research_topic}`);
    console.log(`   - User ID: ${researchRequest.userId}`);
    console.log(`   - Structured Deliverables:`);
    console.log(`     * Lead structure: ${JSON.stringify(enhancedDeliverables.lead, null, 6).substring(0, 200)}...`);
    console.log(`     * Company structure: ${companyInfo ? `Using existing company: ${companyInfo.name}` : 'New company structure generated'}`);
    if (companyId) {
      console.log(`     * Company ID from lead: ${companyId}`);
    }
    
    // Execute deep research to get operations
    const researchResult = await deepResearchActivity(researchRequest);
    
    if (!researchResult.success) {
      const errorMsg = `Failed to start deep research: ${researchResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Check if we're in fallback mode
    const isFallbackMode = researchResult.fallback || false;
    if (isFallbackMode) {
      console.log(`🔄 FALLBACK MODE DETECTED: Deep research API not available`);
      console.log(`⚠️  Continuing workflow with fallback operations`);
    }
    
    // Debug: Log the complete research result to understand the structure
    console.log(`🔍 Deep research result structure:`, JSON.stringify(researchResult, null, 2));
    
    operations = researchResult.operations || [];
    const researchData = researchResult.data;
    
    // Extract command_id for workflow consolidation - simplified structure
    let commandId: string | undefined;
    if (researchData && researchData.command_id) {
      commandId = researchData.command_id;
      console.log(`🔗 Extracted command_id for workflow consolidation: ${commandId}`);
    } else {
      console.log(`⚠️ No command_id found in research result - operations may not be properly consolidated`);
    }
    
    // Check if operations are in researchData.operations
    if (operations.length === 0 && researchData && researchData.operations) {
      console.log(`🔄 Found operations in researchData.operations, using those instead`);
      operations = researchData.operations;
    }
    
    console.log(`✅ Deep research ${isFallbackMode ? 'fallback' : 'completed'} successfully`);
    console.log(`📊 Generated ${operations.length} operations to execute`);
    
    if (operations.length === 0) {
      console.log(`⚠️ No operations generated for research topic "${research_topic}"`);
      console.log(`🔍 Research data structure:`, JSON.stringify(researchData, null, 2));
      if (!isFallbackMode) {
        errors.push('No operations generated for the research topic');
      } else {
        console.log(`ℹ️  This is expected in fallback mode - operations will be minimal`);
      }
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
            userId: options.userId || site.user_id,
            deliverables: enhancedDeliverables, // Include company structure for search operations
            command_id: commandId // Pass command_id for workflow consolidation
          };
          
          console.log(`📤 Sending search request for individual operation:`, JSON.stringify(searchRequest, null, 2));
          console.log(`🔍 Operation search_queries count: ${operation.search_queries.length}`);
          if (commandId) {
            console.log(`🔗 Using command_id for consolidation: ${commandId}`);
          }
          
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
            const isSearchFallback = searchResult.fallback || false;
            if (isSearchFallback) {
              console.log(`🔄 Operation ${i + 1} completed in fallback mode`);
            } else {
              console.log(`✅ Operation ${i + 1} completed successfully`);
            }
            operationResults.push({
              operation: operation,
              success: true,
              data: searchResult.data,
              results: searchResult.results,
              searchResult: searchResult,
              fallback: isSearchFallback
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
          research_topic: research_topic,
          userId: options.userId || site.user_id,
          additionalData: options.additionalData,
          deliverables: enhancedDeliverables, // Use enhanced deliverables instead of options.deliverables
          command_id: commandId // Pass command_id for workflow consolidation
        };
        
        if (commandId) {
          console.log(`🔗 Using command_id for final analysis consolidation: ${commandId}`);
        }
        
        const analysisResult = await dataAnalysisActivity(analysisRequest);
        
        if (!analysisResult.success) {
          const errorMsg = `Failed to perform data analysis: ${analysisResult.error}`;
          console.error(`⚠️ ${errorMsg}`);
          errors.push(errorMsg);
          // Create a basic research_analysis structure even if analysis fails
          research_analysis = {
            success: false,
            error: analysisResult.error,
            site_id: site_id,
            research_topic: research_topic,
            deliverables: enhancedDeliverables,
            timestamp: new Date().toISOString(),
            operations_count: operations.length,
            operation_results_count: operationResults.length,
            successful_operations: operationResults.filter(result => result.success).length,
            insights: [],
            recommendations: [],
            fallback: analysisResult.fallback || false
          };
        } else {
          const isAnalysisFallback = analysisResult.fallback || false;
          if (isAnalysisFallback) {
            console.log(`🔄 Data analysis completed in fallback mode`);
          } else {
            console.log(`✅ Data analysis completed successfully`);
          }
          
          insights = analysisResult.insights || [];
          recommendations = analysisResult.recommendations || [];
          
          // Flatten the analysis result - extract the actual analysis data
          let analysisData = analysisResult.data || {};
          const analysisContent = analysisResult.analysis || {};
          
          // If analysis has nested data structure, extract it
          if (analysisContent.data) {
            analysisData = { ...analysisData, ...analysisContent.data };
          }
          
          // Extract deliverables from dataAnalysis API response (data.deliverables)
          let processedDeliverables = null;
          
          if (analysisResult.data?.deliverables) {
            processedDeliverables = analysisResult.data.deliverables;
            console.log(`✅ Found deliverables in analysisResult.data.deliverables:`, JSON.stringify(processedDeliverables, null, 2));
          } else {
            // Fallback to enhancedDeliverables if API didn't return deliverables
            processedDeliverables = enhancedDeliverables;
            if (isAnalysisFallback) {
              console.log(`🔄 Fallback mode - using enhancedDeliverables`);
            } else {
              console.log(`⚠️ API dataAnalysis didn't return data.deliverables, using fallback enhancedDeliverables`);
              console.log(`🔍 Available analysisResult.data keys:`, Object.keys(analysisResult.data || {}));
              console.log(`🔍 analysisResult.data content:`, JSON.stringify(analysisResult.data, null, 2));
            }
          }
          
          // Build a flattened research_analysis object
          research_analysis = {
            success: true,
            site_id: site_id,
            research_topic: research_topic,
            timestamp: new Date().toISOString(),
            operations_count: operations.length,
            operation_results_count: operationResults.length,
            successful_operations: operationResults.filter(result => result.success).length,
            insights: insights,
            recommendations: recommendations,
            deliverables: processedDeliverables,
            fallback: isAnalysisFallback,
            // Flatten analysis content directly at root level
            ...analysisData,
            // Add structured analysis if available
            ...(analysisContent.conclusions && {
              conclusions: analysisContent.conclusions,
              key_findings: analysisContent.key_findings,
              data_insights: analysisContent.data_insights,
              trend_analysis: analysisContent.trend_analysis,
              methodology: analysisContent.methodology,
              limitations: analysisContent.limitations,
              executive_summary: analysisContent.executive_summary
            })
          };
          
          if (insights.length > 0) {
            console.log(`🔍 Generated ${insights.length} insights`);
          }
          
          if (recommendations.length > 0) {
            console.log(`💡 Generated ${recommendations.length} recommendations`);
          }
          
          // Step 4.5: Process company information if present in analysis result
          if (analysisResult.data?.company && analysisResult.data.company.name) {
            console.log(`🏢 Step 4.5: Processing company information from analysis results...`);
            
            try {
              const companyDataFromAnalysis = analysisResult.data.company;
              console.log(`📋 Company data from analysis:`, JSON.stringify(companyDataFromAnalysis, null, 2));
              
              // Clean up the company data (remove metadata fields)
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { _preserve_fields, _research_timestamp, _research_source, ...cleanCompanyData } = companyDataFromAnalysis;
              
              // If we have existing company info, merge with new data
              if (companyInfo && companyInfo.id) {
                cleanCompanyData.id = companyInfo.id;
              }
              
              const upsertResult = await upsertCompanyActivity(cleanCompanyData);
              
              if (upsertResult.success) {
                companyInfo = upsertResult.company;
                console.log(`✅ Successfully upserted company: ${companyInfo.name}`);
              } else {
                console.error(`⚠️  Failed to upsert company: ${upsertResult.error}`);
                errors.push(`Company upsert failed: ${upsertResult.error}`);
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`⚠️  Exception during company upsert: ${errorMessage}`);
              errors.push(`Company upsert exception: ${errorMessage}`);
            }
          } else {
            console.log(`ℹ️  No company information found in analysis results`);
            console.log(`🔍 Available analysis result keys:`, Object.keys(analysisResult.data || {}));
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ Exception during data analysis: ${errorMessage}`);
        errors.push(`Data analysis exception: ${errorMessage}`);
        // Create a basic research_analysis structure even if analysis fails with exception
        research_analysis = {
          success: false,
          error: errorMessage,
          site_id: site_id,
          research_topic: research_topic,
          deliverables: enhancedDeliverables,
          timestamp: new Date().toISOString(),
          operations_count: operations.length,
          operation_results_count: operationResults.length,
          successful_operations: operationResults.filter(result => result.success).length,
          insights: [],
          recommendations: [],
          fallback: false
        };
      }
    } else {
      // If no operations were executed, still provide a basic research_analysis
      console.log(`⚠️ No operations executed - creating basic research_analysis structure`);
      research_analysis = {
        success: false,
        error: 'No operations were executed for analysis',
        site_id: site_id,
        research_topic: research_topic,
        deliverables: enhancedDeliverables,
        timestamp: new Date().toISOString(),
        operations_count: 0,
        operation_results_count: 0,
        successful_operations: 0,
        insights: [],
        recommendations: [],
        fallback: false
      };
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Check if workflow ran in fallback mode
    const workflowFallbackMode = (researchResult?.fallback || false) || 
                                 operationResults.some(result => result.fallback || false) ||
                                 (research_analysis?.fallback || false);
    
    // Prepare flattened result data - merge research_analysis content directly
    const resultData = {
      // Spread research_analysis content directly at root level
      ...research_analysis,
      // Keep deliverables at top level for leadResearchWorkflow compatibility
      // Use the deliverables from research_analysis (which already contains processed deliverables)
      deliverables: research_analysis?.deliverables || enhancedDeliverables,
      // Add execution metadata
      execution_time: executionTime,
      completed_at: new Date().toISOString(),
      // Add fallback information
      workflow_fallback_mode: workflowFallbackMode,
      fallback_operations: operationResults.filter(result => result.fallback).length,
      api_status: workflowFallbackMode ? 'fallback' : 'normal'
    };

    const statusMessage = workflowFallbackMode ? 
      `completed in fallback mode (API unavailable)` : 
      `completed successfully`;
    
    console.log(`🎉 Deep research workflow ${statusMessage}!`);
    console.log(`📊 Summary: Research on "${research_topic}" for ${siteName} completed in ${executionTime}`);
    console.log(`   - Operations executed: ${operationResults.length}`);
    console.log(`   - Insights generated: ${insights.length}`);
    console.log(`   - Recommendations: ${recommendations.length}`);
    
    if (workflowFallbackMode) {
      console.log(`🔄 Fallback mode information:`);
      console.log(`   - Fallback operations: ${operationResults.filter(result => result.fallback).length}`);
      console.log(`   - Research API status: ${researchResult?.fallback ? 'fallback' : 'normal'}`);
      console.log(`   - Analysis API status: ${research_analysis?.fallback ? 'fallback' : 'normal'}`);
    }
    
    if (errors.length > 0) {
      console.log(`⚠️ ${workflowFallbackMode ? 'Fallback mode warnings' : 'Non-critical errors'}: ${errors.length} occurred`);
    }

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `deep-research-${site_id}`,
      activityName: 'deepResearchWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString(),
      ...(workflowFallbackMode && {
        errorMessage: 'Completed in fallback mode - API services unavailable',
        retryCount: 0
      })
    });

    // Log successful completion (with full data for logging purposes)
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'deepResearchWorkflow',
      status: 'COMPLETED',
      input: options,
      output: {
        siteId: site_id,
        researchTopic: research_topic,
        siteName,
        siteUrl,
        operations: operations.length,
        operationResults: operationResults.length,
        insights: insights.length,
        recommendations: recommendations.length,
        executionTime,
        completedAt: new Date().toISOString(),
        fallbackMode: workflowFallbackMode,
        apiStatus: workflowFallbackMode ? 'fallback' : 'normal'
      },
    });

    return {
      success: true,
      data: resultData,
      error: errors.length > 0 ? (workflowFallbackMode ? 'Completed in fallback mode' : errors) : null
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Deep research workflow failed: ${errorMessage}`);
    
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

    // Log workflow execution failure (with full data for logging purposes)
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'deepResearchWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Prepare flattened error result data
    const errorResearchAnalysis = research_analysis || { // Ensure research_analysis is always present even in error cases
      success: false,
      error: errorMessage,
      site_id: site_id,
      research_topic: research_topic,
      deliverables: enhancedDeliverables || options.deliverables,
      timestamp: new Date().toISOString(),
      fallback: false
    };
    
    // Check if any operations completed in fallback mode before the error
    const hadFallbackOperations = operationResults.some(result => result.fallback || false);
    
    const errorData = {
      // Spread error research analysis content directly at root level
      ...errorResearchAnalysis,
      // Keep deliverables at top level for consistency
      // Use the deliverables from errorResearchAnalysis (which already contains appropriate deliverables)
      deliverables: errorResearchAnalysis?.deliverables || enhancedDeliverables || options.deliverables,
      // Add execution metadata
      execution_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      completed_at: new Date().toISOString(),
      // Add fallback information
      workflow_fallback_mode: hadFallbackOperations,
      fallback_operations: operationResults.filter(result => result.fallback).length,
      api_status: 'error',
      error_stage: research_analysis ? 'post_analysis' : 'pre_analysis'
    };

    return {
      success: false,
      data: errorData,
      error: errorMessage
    };
  }
} 