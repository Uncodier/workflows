"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepResearchWorkflow = deepResearchWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, getCompanyActivity, upsertCompanyActivity, deepResearchActivity, searchOperationActivity, dataAnalysisActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes', // Extended timeout for data analysis operations
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Generates a company structure based on the database schema
 */
function generateCompanyStructure(existingCompany) {
    return {
        // Basic required fields
        name: existingCompany?.name || null,
        // Basic optional fields
        website: existingCompany?.website || null,
        industry: existingCompany?.industry || null,
        size: existingCompany?.size || null,
        annual_revenue: existingCompany?.annual_revenue || null,
        founded: existingCompany?.founded || null,
        description: existingCompany?.description || null,
        address: existingCompany?.address || {},
        // Legal information
        legal_name: existingCompany?.legal_name || null,
        tax_id: existingCompany?.tax_id || null,
        tax_country: existingCompany?.tax_country || null,
        registration_number: existingCompany?.registration_number || null,
        vat_number: existingCompany?.vat_number || null,
        legal_structure: existingCompany?.legal_structure || null,
        // Contact information
        phone: existingCompany?.phone || null,
        email: existingCompany?.email || null,
        linkedin_url: existingCompany?.linkedin_url || null,
        // Company details
        employees_count: existingCompany?.employees_count || null,
        is_public: existingCompany?.is_public || false,
        stock_symbol: existingCompany?.stock_symbol || null,
        parent_company_id: existingCompany?.parent_company_id || null,
        // Media and branding
        logo_url: existingCompany?.logo_url || null,
        cover_image_url: existingCompany?.cover_image_url || null,
        video_url: existingCompany?.video_url || null,
        // Social and business information
        social_media: existingCompany?.social_media || {},
        key_people: existingCompany?.key_people || [],
        funding_info: existingCompany?.funding_info || {},
        certifications: existingCompany?.certifications || [],
        awards: existingCompany?.awards || [],
        // Business model and operations
        business_model: existingCompany?.business_model || null,
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
        remote_policy: existingCompany?.remote_policy || null,
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
async function deepResearchWorkflow(options) {
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
    const errors = [];
    let operations = [];
    const operationResults = [];
    let analysis = null;
    let insights = [];
    let recommendations = [];
    let research_analysis = null; // Initialize at workflow level
    let siteName = '';
    let siteUrl = '';
    let data = null;
    let companyInfo = null;
    let enhancedDeliverables = null; // Initialize at workflow level
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
        const site = siteResult.site;
        siteName = site.name;
        siteUrl = site.url;
        console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);
        // Step 1.5: Get company information if company_id is provided
        const companyId = options.additionalData?.leadInfo?.company_id;
        if (companyId) {
            console.log(`🏢 Step 1.5: Getting company information for company_id: ${companyId}...`);
            try {
                const companyResult = await getCompanyActivity(companyId);
                if (companyResult.success && companyResult.company) {
                    companyInfo = companyResult.company;
                    console.log(`✅ Retrieved company information: ${companyInfo.name}`);
                }
                else {
                    console.log(`⚠️  Company ${companyId} not found or error: ${companyResult.error}`);
                }
            }
            catch (error) {
                console.error(`⚠️  Error fetching company ${companyId}:`, error);
            }
        }
        else {
            console.log(`ℹ️  No company_id provided in additionalData, skipping company lookup`);
        }
        console.log(`🔬 Step 2: Starting deep research for topic "${research_topic}"...`);
        // Prepare deep research request with structured deliverables (lead + company)
        // If deliverables already has lead/company structure, use it; otherwise create it
        if (options.deliverables && options.deliverables.lead && options.deliverables.company) {
            // leadResearchWorkflow style: deliverables already structured
            console.log(`📋 Using pre-structured deliverables from leadResearchWorkflow`);
            const companyStructure = generateCompanyStructure(companyInfo);
            // Merge the existing company info with the structured company template
            enhancedDeliverables = {
                lead: options.deliverables.lead,
                company: {
                    ...companyStructure,
                    ...options.deliverables.company // Override with existing data from lead
                }
            };
        }
        else {
            // Generic deep research: create structure from scratch
            console.log(`📋 Creating fresh deliverable structure for generic deep research`);
            const companyStructure = generateCompanyStructure(companyInfo);
            enhancedDeliverables = {
                lead: options.deliverables || {},
                company: companyStructure
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
        // Debug: Log the complete research result to understand the structure
        console.log(`🔍 Deep research result structure:`, JSON.stringify(researchResult, null, 2));
        operations = researchResult.operations || [];
        data = researchResult.data;
        // Extract command_id for workflow consolidation - simplified structure
        let commandId;
        if (data && data.command_id) {
            commandId = data.command_id;
            console.log(`🔗 Extracted command_id for workflow consolidation: ${commandId}`);
        }
        else {
            console.log(`⚠️ No command_id found in research result - operations may not be properly consolidated`);
        }
        // Check if operations are in data.operations
        if (operations.length === 0 && data && data.operations) {
            console.log(`🔄 Found operations in data.operations, using those instead`);
            operations = data.operations;
        }
        console.log(`✅ Deep research started successfully`);
        console.log(`📊 Generated ${operations.length} operations to execute`);
        if (operations.length === 0) {
            console.log(`⚠️ No operations generated for research topic "${research_topic}"`);
            console.log(`🔍 Data structure:`, JSON.stringify(data, null, 2));
            errors.push('No operations generated for the research topic');
        }
        else {
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
                    }
                    else {
                        console.log(`✅ Operation ${i + 1} completed successfully`);
                        operationResults.push({
                            operation: operation,
                            success: true,
                            data: searchResult.data,
                            results: searchResult.results,
                            searchResult: searchResult
                        });
                    }
                }
                catch (error) {
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
                        timestamp: new Date().toISOString()
                    };
                    // Also update the main data object even in error case
                    data = {
                        ...data, // Preserve existing data
                        research_analysis,
                        deliverables: enhancedDeliverables, // Include deliverables at data level for leadResearchWorkflow
                        analysis: null // No analysis available in error case
                    };
                }
                else {
                    analysis = analysisResult.analysis;
                    insights = analysisResult.insights || [];
                    recommendations = analysisResult.recommendations || [];
                    // Build the complete research_analysis object
                    research_analysis = {
                        success: true,
                        analysis: analysisResult.analysis,
                        insights: analysisResult.insights || [],
                        recommendations: analysisResult.recommendations || [],
                        data: analysisResult.data || {},
                        deliverables: enhancedDeliverables,
                        site_id: site_id,
                        research_topic: research_topic,
                        timestamp: new Date().toISOString(),
                        operations_count: operations.length,
                        operation_results_count: operationResults.length,
                        successful_operations: operationResults.filter(result => result.success).length
                    };
                    // Also update the main data object to include research_analysis and deliverables for leadResearchWorkflow
                    data = {
                        ...data, // Preserve existing data
                        research_analysis,
                        deliverables: enhancedDeliverables, // Include deliverables at data level for leadResearchWorkflow
                        analysis: analysisResult.analysis // Include analysis at data level
                    };
                    console.log(`✅ Data analysis completed successfully`);
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
                            }
                            else {
                                console.error(`⚠️  Failed to upsert company: ${upsertResult.error}`);
                                errors.push(`Company upsert failed: ${upsertResult.error}`);
                            }
                        }
                        catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            console.error(`⚠️  Exception during company upsert: ${errorMessage}`);
                            errors.push(`Company upsert exception: ${errorMessage}`);
                        }
                    }
                    else {
                        console.log(`ℹ️  No company information found in analysis results`);
                        console.log(`🔍 Available analysis result keys:`, Object.keys(analysisResult.data || {}));
                    }
                }
            }
            catch (error) {
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
                    timestamp: new Date().toISOString()
                };
                // Also update the main data object even in exception case
                data = {
                    ...data, // Preserve existing data
                    research_analysis,
                    deliverables: enhancedDeliverables, // Include deliverables at data level for leadResearchWorkflow
                    analysis: null // No analysis available in exception case
                };
            }
        }
        else {
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
                successful_operations: 0
            };
            // Also update the main data object even when no operations executed
            data = {
                ...data, // Preserve existing data
                research_analysis,
                deliverables: enhancedDeliverables, // Include deliverables at data level for leadResearchWorkflow
                analysis: null // No analysis available when no operations executed
            };
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Prepare result data with all the information including research_analysis
        const resultData = {
            siteId: site_id,
            researchTopic: research_topic,
            siteName,
            siteUrl,
            operations,
            operationResults,
            analysis,
            insights,
            recommendations,
            companyInfo,
            data: data,
            research_analysis, // Always include research_analysis
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
            output: resultData,
        });
        return {
            success: true,
            data: resultData,
            error: errors.length > 0 ? errors : null
        };
    }
    catch (error) {
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
        // Prepare error result data
        const errorData = {
            siteId: site_id,
            researchTopic: research_topic,
            siteName,
            siteUrl,
            operations,
            operationResults,
            analysis,
            insights,
            recommendations,
            companyInfo,
            data: data,
            research_analysis: research_analysis || {
                success: false,
                error: errorMessage,
                site_id: site_id,
                research_topic: research_topic,
                deliverables: enhancedDeliverables || options.deliverables,
                timestamp: new Date().toISOString()
            },
            executionTime,
            completedAt: new Date().toISOString()
        };
        return {
            success: false,
            data: errorData,
            error: errorMessage
        };
    }
}
