"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadResearchWorkflow = leadResearchWorkflow;
const workflow_1 = require("@temporalio/workflow");
const deepResearchWorkflow_1 = require("./deepResearchWorkflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, getLeadActivity, updateLeadActivity, upsertCompanyActivity, } = (0, workflow_1.proxyActivities)({
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
 * Genera una estructura de deliverables basada en la información actual del lead
 * Esto define qué campos esperamos que el deep research llene o actualice
 * Retorna estructura separada en lead y company para mejor procesamiento
 */
function generateLeadDeliverables(lead) {
    return {
        // Estructura para información del lead
        lead: {
            // Información básica del lead que puede ser completada/mejorada
            name: lead.name || null,
            job_title: lead.job_title || lead.position || null,
            position: lead.position || lead.job_title || null,
            industry: lead.industry || null,
            location: lead.location || null,
            linkedin_url: lead.linkedin_url || null,
            phone: lead.phone || null,
            // Información profesional que puede ser enriquecida
            decision_maker_info: lead.decision_maker_info || null,
            pain_points: lead.pain_points || null,
            business_priorities: lead.business_priorities || null,
            recent_news: lead.recent_news || null,
            // Metadatos de investigación
            research_timestamp: new Date().toISOString(),
            research_source: 'lead_research_workflow',
            // Campos que NO deben ser sobrescritos (para referencia de la API)
            _preserve_fields: ['email', 'id', 'site_id', 'created_at', 'updated_at', 'user_id']
        },
        // Estructura para información de la empresa (se usará la estructura de deepResearchWorkflow)
        // Esta será completada por el deepResearchWorkflow usando generateCompanyStructure()
        company: {
            // Información básica que tenemos del lead
            name: lead.company || lead.company_name || null,
            website: lead.website || null,
            industry: lead.industry || null,
            size: lead.company_size || null,
            // Campos que pueden ser enriquecidos por la investigación
            description: lead.company_description || null,
            founded: lead.company_founded || null,
            employees_count: lead.company_employees || null,
            annual_revenue: lead.company_revenue || null,
            tech_stack: lead.company_technologies || null,
            competitors: lead.competitors || null,
            // Metadatos de investigación
            _preserve_fields: ['id', 'created_at', 'updated_at'],
            _research_timestamp: new Date().toISOString(),
            _research_source: 'lead_research_workflow'
        }
    };
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
        // Generar deliverables basados en la estructura actual del lead
        const leadDeliverables = generateLeadDeliverables(leadInfo);
        console.log(`📋 Generated deliverables structure:`, JSON.stringify(leadDeliverables, null, 2));
        // Preparar opciones para el deep research workflow
        const deepResearchOptions = {
            site_id: site_id,
            research_topic: researchQuery,
            userId: options.userId || site.user_id,
            deliverables: leadDeliverables,
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
                // Process deliverables and analysis for lead and company updates
                let leadDeliverablesToUpdate = null;
                let companyDeliverablesToUpdate = null;
                let analysisForMetadata = null;
                // Extract deliverables from the result - structured format
                if (deepResearchResult.data && deepResearchResult.data.deliverables) {
                    const deliverables = deepResearchResult.data.deliverables;
                    console.log(`📦 Found deliverables in data.deliverables:`, JSON.stringify(deliverables, null, 2));
                    // Extract lead deliverables
                    if (deliverables.lead) {
                        leadDeliverablesToUpdate = deliverables.lead;
                        console.log(`👤 Found lead deliverables:`, Object.keys(leadDeliverablesToUpdate));
                    }
                    // Extract company deliverables  
                    if (deliverables.company) {
                        companyDeliverablesToUpdate = deliverables.company;
                        console.log(`🏢 Found company deliverables:`, Object.keys(companyDeliverablesToUpdate));
                    }
                }
                // Extract analysis for metadata - simplified structure
                if (deepResearchResult.data && deepResearchResult.data.analysis) {
                    analysisForMetadata = deepResearchResult.data.analysis;
                    console.log(`🔍 Found analysis in data.analysis`);
                }
                else if (deepResearchResult.analysis) {
                    analysisForMetadata = deepResearchResult.analysis;
                    console.log(`🔍 Found analysis in main level`);
                }
                // Step 5a: Update lead if we have lead deliverables or analysis
                if (leadDeliverablesToUpdate || analysisForMetadata) {
                    console.log(`🔄 Step 5a: Updating lead with research results...`);
                    try {
                        // Prepare lead update data
                        const leadUpdateData = {};
                        // Add lead deliverables (excluding preserved fields)
                        if (leadDeliverablesToUpdate) {
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            const { _preserve_fields, ...safeLeadDeliverables } = leadDeliverablesToUpdate;
                            Object.assign(leadUpdateData, safeLeadDeliverables);
                            console.log(`📦 Adding lead deliverables to update:`, Object.keys(safeLeadDeliverables));
                        }
                        // Add analysis to metadata
                        if (analysisForMetadata) {
                            leadUpdateData.metadata = {
                                ...leadInfo.metadata,
                                research_analysis: analysisForMetadata,
                                last_research_date: new Date().toISOString(),
                                research_workflow_id: workflowId
                            };
                            console.log(`🔍 Adding analysis to lead metadata`);
                        }
                        if (Object.keys(leadUpdateData).length > 0) {
                            const leadUpdateResult = await updateLeadActivity({
                                lead_id: lead_id,
                                updateData: leadUpdateData,
                                safeUpdate: true // Ensure email and phone are not overwritten
                            });
                            if (leadUpdateResult.success) {
                                console.log(`✅ Lead updated successfully with research results`);
                                console.log(`📊 Updated lead fields: ${Object.keys(leadUpdateData).join(', ')}`);
                            }
                            else {
                                console.error(`❌ Failed to update lead: ${leadUpdateResult.error}`);
                                errors.push(`Lead update failed: ${leadUpdateResult.error}`);
                            }
                        }
                        else {
                            console.log(`⚠️ No lead deliverables or analysis found to update lead`);
                        }
                    }
                    catch (updateError) {
                        const updateErrorMessage = updateError instanceof Error ? updateError.message : String(updateError);
                        console.error(`❌ Exception updating lead: ${updateErrorMessage}`);
                        errors.push(`Lead update exception: ${updateErrorMessage}`);
                    }
                }
                else {
                    console.log(`⚠️ No lead deliverables or analysis found in deep research result`);
                }
                // Step 5b: Update company if we have company deliverables
                if (companyDeliverablesToUpdate && companyDeliverablesToUpdate.name) {
                    console.log(`🔄 Step 5b: Updating company with research results...`);
                    try {
                        // Clean up company data (remove metadata fields)
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { _preserve_fields, _research_timestamp, _research_source, ...cleanCompanyData } = companyDeliverablesToUpdate;
                        // If lead has company_id, use it for company identification
                        const companyId = leadInfo.company_id;
                        if (companyId) {
                            cleanCompanyData.id = companyId;
                            console.log(`🔗 Using company_id from lead: ${companyId}`);
                        }
                        console.log(`🏢 Upserting company: ${cleanCompanyData.name}`);
                        console.log(`📊 Company fields to update: ${Object.keys(cleanCompanyData).join(', ')}`);
                        const companyUpsertResult = await upsertCompanyActivity(cleanCompanyData);
                        if (companyUpsertResult.success) {
                            console.log(`✅ Company updated successfully: ${companyUpsertResult.company.name}`);
                            console.log(`🆔 Company ID: ${companyUpsertResult.company.id}`);
                            // Update lead with company_id if it wasn't set before
                            if (!leadInfo.company_id && companyUpsertResult.company.id) {
                                try {
                                    const leadCompanyUpdateResult = await updateLeadActivity({
                                        lead_id: lead_id,
                                        updateData: { company_id: companyUpsertResult.company.id },
                                        safeUpdate: true
                                    });
                                    if (leadCompanyUpdateResult.success) {
                                        console.log(`✅ Lead updated with company_id: ${companyUpsertResult.company.id}`);
                                    }
                                    else {
                                        console.error(`⚠️ Failed to update lead with company_id: ${leadCompanyUpdateResult.error}`);
                                    }
                                }
                                catch (companyIdUpdateError) {
                                    console.error(`⚠️ Exception updating lead with company_id:`, companyIdUpdateError);
                                }
                            }
                        }
                        else {
                            console.error(`❌ Failed to update company: ${companyUpsertResult.error}`);
                            errors.push(`Company update failed: ${companyUpsertResult.error}`);
                        }
                    }
                    catch (companyUpdateError) {
                        const companyUpdateErrorMessage = companyUpdateError instanceof Error ? companyUpdateError.message : String(companyUpdateError);
                        console.error(`❌ Exception updating company: ${companyUpdateErrorMessage}`);
                        errors.push(`Company update exception: ${companyUpdateErrorMessage}`);
                    }
                }
                else {
                    console.log(`ℹ️ No company deliverables found or company name missing - skipping company update`);
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
        // Deep research result is now already cleaned by the activities - no need for complex cleaning
        let cleanedDeepResearchResult = null;
        if (deepResearchResult) {
            cleanedDeepResearchResult = {
                success: deepResearchResult.success,
                siteId: deepResearchResult.siteId,
                researchTopic: deepResearchResult.researchTopic,
                siteName: deepResearchResult.siteName,
                siteUrl: deepResearchResult.siteUrl,
                operations: deepResearchResult.operations || [],
                operationResults: deepResearchResult.operationResults || [],
                analysis: deepResearchResult.analysis,
                insights: deepResearchResult.insights || [],
                recommendations: deepResearchResult.recommendations || [],
                errors: deepResearchResult.errors || [],
                executionTime: deepResearchResult.executionTime,
                completedAt: deepResearchResult.completedAt
                // Note: We're NOT including the raw 'data' field to avoid nesting
            };
            console.log(`🧹 Cleaned result operations count: ${cleanedDeepResearchResult.operations.length}`);
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
            console.log(`   - Operations mapped: ${cleanedDeepResearchResult.operations.length}`);
            console.log(`   - Operation results: ${cleanedDeepResearchResult.operationResults.length}`);
            console.log(`   - Total insights: ${cleanedDeepResearchResult.insights.length}`);
            console.log(`   - Total recommendations: ${cleanedDeepResearchResult.recommendations.length}`);
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
            cleanedDeepResearchResult = {
                success: deepResearchResult.success,
                siteId: deepResearchResult.siteId,
                researchTopic: deepResearchResult.researchTopic,
                siteName: deepResearchResult.siteName,
                siteUrl: deepResearchResult.siteUrl,
                operations: deepResearchResult.operations || [],
                operationResults: deepResearchResult.operationResults || [],
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
