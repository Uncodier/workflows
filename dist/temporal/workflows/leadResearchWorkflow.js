"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadResearchWorkflow = leadResearchWorkflow;
const workflow_1 = require("@temporalio/workflow");
const deepResearchWorkflow_1 = require("./deepResearchWorkflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, getLeadActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes', // Reasonable timeout for lead research
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Genera un query de búsqueda estructurado basado en la información del lead
 */
function generateLeadResearchQuery(lead) {
    const queryParts = [];
    // Información básica del lead
    if (lead.company || lead.company_name) {
        let companyName = 'Unknown Company';
        // Extraer el nombre de la empresa de diferentes estructuras posibles
        if (typeof lead.company === 'object' && lead.company !== null) {
            // Si company es un objeto, buscar propiedades comunes
            companyName = lead.company.name || lead.company.company_name || lead.company.title || 'Unknown Company';
        }
        else if (typeof lead.company === 'string') {
            // Si company es un string directo
            companyName = lead.company;
        }
        else if (lead.company_name) {
            // Usar company_name como fallback
            companyName = typeof lead.company_name === 'object' ?
                (lead.company_name.name || lead.company_name.title || 'Unknown Company') :
                lead.company_name;
        }
        // Solo agregar si no es el valor por defecto o está vacío
        if (companyName !== 'Unknown Company' && companyName.trim() !== '') {
            queryParts.push(`empresa: ${companyName}`);
        }
    }
    if (lead.industry) {
        queryParts.push(`industria: ${lead.industry}`);
    }
    if (lead.job_title || lead.position) {
        queryParts.push(`cargo: ${lead.job_title || lead.position}`);
    }
    if (lead.location) {
        queryParts.push(`ubicación: ${lead.location}`);
    }
    if (lead.company_size) {
        queryParts.push(`tamaño empresa: ${lead.company_size}`);
    }
    if (lead.website) {
        queryParts.push(`sitio web: ${lead.website}`);
    }
    // Información del contacto
    if (lead.name) {
        queryParts.push(`contacto: ${lead.name}`);
    }
    // Si no hay información específica, usar un query genérico
    if (queryParts.length === 0) {
        const identifier = lead.email || lead.name || lead.id;
        return `investigación de prospecto ${identifier} - análisis de oportunidades comerciales`;
    }
    // Combinar todas las partes del query
    const baseQuery = queryParts.join(', ');
    return `investigación profunda sobre prospecto: ${baseQuery} - análisis de mercado, competencia, oportunidades de negocio y estrategias de acercamiento`;
}
/**
 * Workflow to execute lead research using deepResearchWorkflow
 *
 * Este workflow:
 * 1. Obtiene información del sitio
 * 2. Obtiene información del lead de la base de datos
 * 3. Genera un query de investigación basado en la información del lead
 * 4. Ejecuta deepResearchWorkflow con ese query
 * 5. Retorna los resultados del deep research
 *
 * @param options - Configuration options for lead research
 */
async function leadResearchWorkflow(options) {
    const { lead_id, site_id } = options;
    if (!lead_id) {
        throw new Error('No lead ID provided');
    }
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    const workflowId = `lead-research-${lead_id}-${site_id}`;
    const startTime = Date.now();
    console.log(`🔍 Starting lead research workflow for lead ${lead_id} on site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadResearchWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `lead-research-${lead_id}-${site_id}`,
        activityName: 'leadResearchWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    let deepResearchResult = null;
    let leadInfo = null;
    let siteName = '';
    let siteUrl = '';
    let researchQuery = '';
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
        console.log(`👤 Step 2: Getting lead information for ${lead_id}...`);
        // Get lead information from database
        const leadResult = await getLeadActivity(lead_id);
        if (!leadResult.success) {
            const errorMsg = `Failed to get lead information: ${leadResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        leadInfo = leadResult.lead;
        console.log(`✅ Retrieved lead information: ${leadInfo.name || leadInfo.email} from ${leadInfo.company || leadInfo.company_name || 'Unknown Company'}`);
        console.log(`📋 Lead details:`);
        console.log(`   - Name: ${leadInfo.name || 'N/A'}`);
        console.log(`   - Email: ${leadInfo.email || 'N/A'}`);
        console.log(`   - Company: ${leadInfo.company || leadInfo.company_name || 'N/A'}`);
        console.log(`   - Position: ${leadInfo.job_title || leadInfo.position || 'N/A'}`);
        console.log(`   - Industry: ${leadInfo.industry || 'N/A'}`);
        console.log(`   - Location: ${leadInfo.location || 'N/A'}`);
        console.log(`🔍 Step 3: Generating research query from lead information...`);
        // Debug: Log lead info structure before generating query
        console.log(`🔧 Lead company structure:`, JSON.stringify(leadInfo.company, null, 2));
        console.log(`🔧 Lead company_name structure:`, JSON.stringify(leadInfo.company_name, null, 2));
        // Estructurar la información del lead como query de búsqueda
        researchQuery = generateLeadResearchQuery(leadInfo);
        console.log(`🔧 Generated research query: "${researchQuery}"`);
        console.log(`🔬 Step 4: Executing deep research workflow...`);
        // Preparar opciones para el deep research workflow
        const deepResearchOptions = {
            site_id: site_id,
            research_topic: researchQuery,
            userId: options.userId || site.user_id,
            additionalData: {
                ...options.additionalData,
                leadId: lead_id,
                leadInfo: leadInfo,
                researchContext: 'lead_research_workflow',
                siteName: siteName,
                siteUrl: siteUrl
            }
        };
        // Ejecutar deep research workflow como proceso hijo
        try {
            const deepResearchHandle = await (0, workflow_1.startChild)(deepResearchWorkflow_1.deepResearchWorkflow, {
                args: [deepResearchOptions],
                workflowId: `deep-research-lead-${lead_id}-${site_id}-${Date.now()}`,
            });
            deepResearchResult = await deepResearchHandle.result();
            // Debug: Log complete deep research result structure
            console.log(`🔍 Deep research result structure:`, JSON.stringify(deepResearchResult, null, 2));
            if (deepResearchResult.success) {
                console.log(`✅ Deep research completed successfully`);
                console.log(`📊 Deep research results:`);
                console.log(`   - Operations in main level: ${deepResearchResult.operations?.length || 0}`);
                console.log(`   - Operations executed: ${deepResearchResult.operationResults?.length || 0}`);
                console.log(`   - Insights generated: ${deepResearchResult.insights?.length || 0}`);
                console.log(`   - Recommendations: ${deepResearchResult.recommendations?.length || 0}`);
                // Check for data.data nesting issue
                if (deepResearchResult.data && deepResearchResult.data.data) {
                    console.log(`⚠️ Detected data.data nesting - this might be the anidation issue`);
                    console.log(`   - Operations in data.data: ${deepResearchResult.data.data.operations?.length || 0}`);
                }
                if (deepResearchResult.insights && deepResearchResult.insights.length > 0) {
                    console.log(`🔍 Research insights:`);
                    deepResearchResult.insights.slice(0, 5).forEach((insight, index) => {
                        console.log(`   ${index + 1}. ${insight.title || insight.summary || insight.description || `Insight ${index + 1}`}`);
                    });
                    if (deepResearchResult.insights.length > 5) {
                        console.log(`   ... and ${deepResearchResult.insights.length - 5} more insights`);
                    }
                }
                if (deepResearchResult.recommendations && deepResearchResult.recommendations.length > 0) {
                    console.log(`💡 Research recommendations:`);
                    deepResearchResult.recommendations.slice(0, 3).forEach((recommendation, index) => {
                        console.log(`   ${index + 1}. ${recommendation}`);
                    });
                    if (deepResearchResult.recommendations.length > 3) {
                        console.log(`   ... and ${deepResearchResult.recommendations.length - 3} more recommendations`);
                    }
                }
            }
            else {
                console.log(`⚠️ Deep research completed with errors: ${deepResearchResult.errors?.join(', ')}`);
                errors.push(`Deep research errors: ${deepResearchResult.errors?.join(', ')}`);
            }
        }
        catch (deepResearchError) {
            const errorMessage = deepResearchError instanceof Error ? deepResearchError.message : String(deepResearchError);
            console.error(`⚠️ Deep research workflow failed: ${errorMessage}`);
            errors.push(`Deep research workflow error: ${errorMessage}`);
            // No lanzamos error aquí para que continúe con los resultados parciales
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Clean up the deep research result to avoid nesting issues
        let cleanedDeepResearchResult = null;
        if (deepResearchResult) {
            // Extract operations from nested data.data.operations if main operations array is empty
            let actualOperations = deepResearchResult.operations || [];
            let actualOperationResults = deepResearchResult.operationResults || [];
            // Check if operations are nested in data.data.operations
            if (actualOperations.length === 0 &&
                deepResearchResult.data &&
                deepResearchResult.data.data &&
                deepResearchResult.data.data.operations) {
                console.log(`🔄 Mapping operations from data.data.operations to main level`);
                actualOperations = deepResearchResult.data.data.operations;
                // Also check for operation results in the nested structure
                if (deepResearchResult.data.data.operationResults) {
                    actualOperationResults = deepResearchResult.data.data.operationResults;
                }
            }
            cleanedDeepResearchResult = {
                success: deepResearchResult.success,
                siteId: deepResearchResult.siteId,
                researchTopic: deepResearchResult.researchTopic,
                siteName: deepResearchResult.siteName,
                siteUrl: deepResearchResult.siteUrl,
                operations: actualOperations,
                operationResults: actualOperationResults,
                analysis: deepResearchResult.analysis,
                insights: deepResearchResult.insights || [],
                recommendations: deepResearchResult.recommendations || [],
                errors: deepResearchResult.errors || [],
                executionTime: deepResearchResult.executionTime,
                completedAt: deepResearchResult.completedAt
                // Note: We're NOT including the raw 'data' field to avoid nesting
            };
            console.log(`🧹 Cleaned result operations count: ${actualOperations.length}`);
        }
        const result = {
            success: true,
            leadId: lead_id,
            siteId: site_id,
            siteName,
            siteUrl,
            leadInfo,
            deepResearchResult: cleanedDeepResearchResult,
            researchQuery,
            data: cleanedDeepResearchResult, // Use cleaned version instead of raw deepResearchResult
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 Lead research workflow completed successfully!`);
        console.log(`📊 Summary: Lead research for ${leadInfo.name || leadInfo.email} completed in ${executionTime}`);
        console.log(`   - Lead: ${leadInfo.name || leadInfo.email} from ${leadInfo.company || leadInfo.company_name}`);
        console.log(`   - Site: ${siteName}`);
        console.log(`   - Deep research executed: ${deepResearchResult ? 'Yes' : 'No'}`);
        if (cleanedDeepResearchResult) {
            console.log(`   - Operations mapped: ${cleanedDeepResearchResult.operations?.length || 0}`);
            console.log(`   - Operation results: ${cleanedDeepResearchResult.operationResults?.length || 0}`);
            console.log(`   - Total insights: ${cleanedDeepResearchResult.insights?.length || 0}`);
            console.log(`   - Total recommendations: ${cleanedDeepResearchResult.recommendations?.length || 0}`);
        }
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-research-${lead_id}-${site_id}`,
            activityName: 'leadResearchWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadResearchWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Lead research workflow failed: ${errorMessage}`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-research-${lead_id}-${site_id}`,
            activityName: 'leadResearchWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadResearchWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Clean up the deep research result even in error cases
        let cleanedDeepResearchResult = null;
        if (deepResearchResult) {
            // Extract operations from nested data.data.operations if main operations array is empty
            let actualOperations = deepResearchResult.operations || [];
            let actualOperationResults = deepResearchResult.operationResults || [];
            // Check if operations are nested in data.data.operations
            if (actualOperations.length === 0 &&
                deepResearchResult.data &&
                deepResearchResult.data.data &&
                deepResearchResult.data.data.operations) {
                console.log(`🔄 Mapping operations from data.data.operations to main level (error case)`);
                actualOperations = deepResearchResult.data.data.operations;
                // Also check for operation results in the nested structure
                if (deepResearchResult.data.data.operationResults) {
                    actualOperationResults = deepResearchResult.data.data.operationResults;
                }
            }
            cleanedDeepResearchResult = {
                success: deepResearchResult.success,
                siteId: deepResearchResult.siteId,
                researchTopic: deepResearchResult.researchTopic,
                siteName: deepResearchResult.siteName,
                siteUrl: deepResearchResult.siteUrl,
                operations: actualOperations,
                operationResults: actualOperationResults,
                analysis: deepResearchResult.analysis,
                insights: deepResearchResult.insights || [],
                recommendations: deepResearchResult.recommendations || [],
                errors: deepResearchResult.errors || [],
                executionTime: deepResearchResult.executionTime,
                completedAt: deepResearchResult.completedAt
            };
        }
        // Return failed result instead of throwing to provide more information
        const result = {
            success: false,
            leadId: lead_id,
            siteId: site_id,
            siteName,
            siteUrl,
            leadInfo,
            deepResearchResult: cleanedDeepResearchResult,
            researchQuery,
            data: cleanedDeepResearchResult,
            errors: [...errors, errorMessage],
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
    }
}
