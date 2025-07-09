"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSiteWorkflow = analyzeSiteWorkflow;
const workflow_1 = require("@temporalio/workflow");
const deepResearchWorkflow_1 = require("./deepResearchWorkflow");
// Define the activity interface with common activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, getSettingsActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Filtra y valida datos para enviar solo información que realmente existe
 */
function filterValidData(data) {
    if (!data || typeof data !== 'object')
        return null;
    if (Array.isArray(data)) {
        const filtered = data.filter(item => {
            if (!item)
                return false;
            if (typeof item === 'string')
                return item.trim() !== '';
            if (typeof item === 'object') {
                const valid = filterValidData(item);
                return valid !== null && Object.keys(valid).length > 0;
            }
            return true;
        });
        return filtered.length > 0 ? filtered : null;
    }
    const filtered = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined)
            continue;
        if (typeof value === 'string') {
            if (value.trim() !== '') {
                filtered[key] = value.trim();
            }
        }
        else if (Array.isArray(value)) {
            const filteredArray = filterValidData(value);
            if (filteredArray) {
                filtered[key] = filteredArray;
            }
        }
        else if (typeof value === 'object') {
            const filteredObject = filterValidData(value);
            if (filteredObject && Object.keys(filteredObject).length > 0) {
                filtered[key] = filteredObject;
            }
        }
        else {
            filtered[key] = value;
        }
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
}
/**
 * Genera una estructura de deliverables para research de empresa y proyecto
 * Solo incluye campos que realmente tienen datos
 */
function generateCompanyProjectResearchDeliverables(site, siteSettings) {
    console.log(`🔍 DEBUG: Processing site and settings for deliverables...`);
    console.log(`📊 Site data:`, {
        name: site?.name,
        url: site?.url,
        description: site?.description ? `${site.description.substring(0, 100)}...` : null
    });
    console.log(`📊 Settings data before filtering:`, {
        about: siteSettings?.about ? `${siteSettings.about.substring(0, 50)}...` : null,
        industry: siteSettings?.industry,
        company_size: siteSettings?.company_size,
        products: Array.isArray(siteSettings?.products) ? siteSettings.products.length : null,
        services: Array.isArray(siteSettings?.services) ? siteSettings.services.length : null,
        goals: Array.isArray(siteSettings?.goals) ? siteSettings.goals.length : null,
        swot: siteSettings?.swot ? Object.keys(siteSettings.swot) : null,
        competitors: Array.isArray(siteSettings?.competitors) ? siteSettings.competitors.length : null,
        team_members: Array.isArray(siteSettings?.team_members) ? siteSettings.team_members.length : null,
        team_roles: Array.isArray(siteSettings?.team_roles) ? siteSettings.team_roles.length : null,
        marketing_channels: Array.isArray(siteSettings?.marketing_channels) ? siteSettings.marketing_channels.length : null,
        branding: siteSettings?.branding ? Object.keys(siteSettings.branding) : null
    });
    const deliverables = {
        // Información básica de la empresa - incluir datos del sitio
        company_information: {
            name: site?.name || null,
            url: site?.url || null,
            description: site?.description || null,
            about: siteSettings?.about || null,
            industry: siteSettings?.industry || null,
            company_size: siteSettings?.company_size || null,
        },
        // Productos y servicios - solo si tienen datos
        products_and_services: {
            products: filterValidData(siteSettings?.products) || null,
            services: filterValidData(siteSettings?.services) || null,
        },
        // Objetivos del negocio - solo si tienen datos
        business_goals: filterValidData(siteSettings?.goals) || null,
        // Análisis SWOT - solo si tiene datos reales
        swot_analysis: filterValidData(siteSettings?.swot) || null,
        // Competidores - solo si tienen datos
        competitors: filterValidData(siteSettings?.competitors) || null,
        // Equipo y organización - solo si tienen datos
        team_and_organization: {
            team_members: filterValidData(siteSettings?.team_members) || null,
            team_roles: filterValidData(siteSettings?.team_roles) || null,
            org_structure: filterValidData(siteSettings?.org_structure) || null
        },
        // Ubicaciones y horarios - solo si tienen datos
        locations_and_hours: {
            locations: filterValidData(siteSettings?.locations) || null,
            business_hours: filterValidData(siteSettings?.business_hours) || null
        },
        // Marketing y comunicación - solo si tienen datos
        marketing_and_communication: {
            marketing_channels: filterValidData(siteSettings?.marketing_channels) || null,
            social_media: filterValidData(siteSettings?.social_media) || null,
            communication_channels: filterValidData(siteSettings?.channels) || null
        },
        // Branding - solo si tiene datos
        branding: filterValidData(siteSettings?.branding) || null
    };
    console.log(`🔍 DEBUG: Deliverables after filtering:`, {
        company_information: deliverables.company_information ? Object.keys(deliverables.company_information).filter(k => deliverables.company_information[k] !== null) : [],
        products_and_services: deliverables.products_and_services ? Object.keys(deliverables.products_and_services).filter(k => deliverables.products_and_services[k] !== null) : [],
        business_goals: deliverables.business_goals ? `${JSON.stringify(deliverables.business_goals).length} chars` : null,
        swot_analysis: deliverables.swot_analysis ? Object.keys(deliverables.swot_analysis) : null,
        competitors: deliverables.competitors ? `${deliverables.competitors.length} items` : null,
        team_and_organization: deliverables.team_and_organization ? Object.keys(deliverables.team_and_organization).filter(k => deliverables.team_and_organization[k] !== null) : [],
        locations_and_hours: deliverables.locations_and_hours ? Object.keys(deliverables.locations_and_hours).filter(k => deliverables.locations_and_hours[k] !== null) : [],
        marketing_and_communication: deliverables.marketing_and_communication ? Object.keys(deliverables.marketing_and_communication).filter(k => deliverables.marketing_and_communication[k] !== null) : [],
        branding: deliverables.branding ? Object.keys(deliverables.branding) : null
    });
    // Filtrar la estructura final para remover secciones vacías
    const finalDeliverables = filterValidData(deliverables);
    console.log(`🔍 DEBUG: Final deliverables structure:`, {
        sections: finalDeliverables ? Object.keys(finalDeliverables) : [],
        total_fields: finalDeliverables ? Object.values(finalDeliverables).filter(v => v !== null).length : 0
    });
    return finalDeliverables;
}
/**
 * Genera un research topic específico basado en los datos reales disponibles
 */
function generateIntelligentResearchTopic(siteName, siteUrl, site, siteSettings) {
    console.log(`🔍 DEBUG: Generating research topic for ${siteName}...`);
    let topic = `Research and expand company information for ${siteName} (${siteUrl})`;
    // Enfoque específico en los campos que realmente tienen datos
    const researchAreas = [];
    // Información básica del sitio
    if (site?.description) {
        researchAreas.push(`expand company description beyond: "${site.description}"`);
        console.log(`✅ Adding site description to research areas`);
    }
    else if (siteSettings?.about) {
        researchAreas.push(`expand company description beyond: "${siteSettings.about}"`);
        console.log(`✅ Adding settings about to research areas`);
    }
    // Configuración del sitio
    if (siteSettings?.industry) {
        researchAreas.push(`industry analysis for ${siteSettings.industry} sector`);
        console.log(`✅ Adding industry to research areas: ${siteSettings.industry}`);
    }
    if (siteSettings?.company_size) {
        researchAreas.push(`company context for ${siteSettings.company_size} organization`);
        console.log(`✅ Adding company size to research areas: ${siteSettings.company_size}`);
    }
    // Productos y servicios
    const products = filterValidData(siteSettings?.products);
    if (products && products.length > 0) {
        const productNames = products.map((p) => p.name || p.title || p).filter(Boolean).slice(0, 3);
        if (productNames.length > 0) {
            researchAreas.push(`product research for: ${productNames.join(', ')}`);
            console.log(`✅ Adding products to research areas: ${productNames.join(', ')}`);
        }
    }
    else {
        console.log(`⚠️ No valid products found in settings`);
    }
    const services = filterValidData(siteSettings?.services);
    if (services && services.length > 0) {
        const serviceNames = services.map((s) => s.name || s.title || s).filter(Boolean).slice(0, 3);
        if (serviceNames.length > 0) {
            researchAreas.push(`service research for: ${serviceNames.join(', ')}`);
            console.log(`✅ Adding services to research areas: ${serviceNames.join(', ')}`);
        }
    }
    else {
        console.log(`⚠️ No valid services found in settings`);
    }
    // Objetivos de negocio
    const goals = filterValidData(siteSettings?.goals);
    if (goals && goals.length > 0) {
        const goalTexts = goals.map((g) => g.quarterly || g.objective || g.description || g).filter(Boolean).slice(0, 2);
        if (goalTexts.length > 0) {
            researchAreas.push(`business goals context: ${goalTexts.join(', ')}`);
            console.log(`✅ Adding goals to research areas: ${goalTexts.join(', ')}`);
        }
    }
    else {
        console.log(`⚠️ No valid goals found in settings`);
    }
    // Análisis SWOT
    const swot = filterValidData(siteSettings?.swot);
    if (swot && Object.keys(swot).length > 0) {
        researchAreas.push(`SWOT analysis expansion`);
        console.log(`✅ Adding SWOT to research areas: ${Object.keys(swot).join(', ')}`);
    }
    else {
        console.log(`⚠️ No valid SWOT found in settings`);
    }
    // Competidores
    const competitors = filterValidData(siteSettings?.competitors);
    if (competitors && competitors.length > 0) {
        const competitorNames = competitors.map((c) => c.name || c.url || c).filter(Boolean).slice(0, 2);
        if (competitorNames.length > 0) {
            researchAreas.push(`competitive analysis vs ${competitorNames.join(', ')}`);
            console.log(`✅ Adding competitors to research areas: ${competitorNames.join(', ')}`);
        }
    }
    else {
        console.log(`⚠️ No valid competitors found in settings`);
    }
    // Equipo y organización
    const teamMembers = filterValidData(siteSettings?.team_members);
    const teamRoles = filterValidData(siteSettings?.team_roles);
    if ((teamMembers && teamMembers.length > 0) || (teamRoles && teamRoles.length > 0)) {
        researchAreas.push(`team and organizational structure research`);
        console.log(`✅ Adding team organization to research areas`);
    }
    else {
        console.log(`⚠️ No valid team data found in settings`);
    }
    // Ubicaciones
    const locations = filterValidData(siteSettings?.locations);
    if (locations && locations.length > 0) {
        researchAreas.push(`location and market presence analysis`);
        console.log(`✅ Adding locations to research areas: ${locations.length} locations`);
    }
    else {
        console.log(`⚠️ No valid locations found in settings`);
    }
    // Canales de marketing
    const marketingChannels = filterValidData(siteSettings?.marketing_channels);
    if (marketingChannels && marketingChannels.length > 0) {
        researchAreas.push(`marketing channels analysis: ${marketingChannels.slice(0, 3).join(', ')}`);
        console.log(`✅ Adding marketing channels to research areas: ${marketingChannels.slice(0, 3).join(', ')}`);
    }
    else {
        console.log(`⚠️ No valid marketing channels found in settings`);
    }
    // Branding
    const branding = filterValidData(siteSettings?.branding);
    if (branding && branding.brand_archetype) {
        researchAreas.push(`brand archetype research: ${branding.brand_archetype}`);
        console.log(`✅ Adding branding to research areas: ${branding.brand_archetype}`);
    }
    else {
        console.log(`⚠️ No valid branding found in settings`);
    }
    // Construir el topic final
    if (researchAreas.length > 0) {
        topic += `. Focus on: ${researchAreas.join(', ')}`;
        console.log(`🎯 Research areas included: ${researchAreas.length}`);
    }
    else {
        console.log(`⚠️ No research areas found - using basic topic only`);
    }
    // Agregar contexto específico de expansión
    topic += `. Expand and enhance existing company information, fill gaps, and provide comprehensive business context`;
    // Agregar información conocida directamente al topic
    let knownData = "\n\nKnown company information:";
    let knownDataCount = 0;
    // Información básica del sitio
    if (site?.name) {
        knownData += `\nCompany Name: ${site.name}`;
        knownDataCount++;
    }
    if (site?.url) {
        knownData += `\nWebsite: ${site.url}`;
        knownDataCount++;
    }
    if (site?.description) {
        knownData += `\nCompany Description: ${site.description}`;
        knownDataCount++;
    }
    if (siteSettings?.about) {
        knownData += `\nCompany About: ${siteSettings.about}`;
        knownDataCount++;
    }
    // Configuración del sitio - solo datos con contenido
    if (siteSettings?.industry) {
        knownData += `\nIndustry: ${siteSettings.industry}`;
        knownDataCount++;
    }
    if (siteSettings?.company_size) {
        knownData += `\nCompany Size: ${siteSettings.company_size}`;
        knownDataCount++;
    }
    // Productos y servicios
    if (products && products.length > 0) {
        knownData += `\nProducts: ${JSON.stringify(products, null, 2)}`;
        knownDataCount++;
    }
    if (services && services.length > 0) {
        knownData += `\nServices: ${JSON.stringify(services, null, 2)}`;
        knownDataCount++;
    }
    // Objetivos de negocio
    if (goals && goals.length > 0) {
        knownData += `\nBusiness Goals: ${JSON.stringify(goals, null, 2)}`;
        knownDataCount++;
    }
    // SWOT
    if (swot && Object.keys(swot).length > 0) {
        knownData += `\nSWOT Analysis: ${JSON.stringify(swot, null, 2)}`;
        knownDataCount++;
    }
    // Competidores
    if (competitors && competitors.length > 0) {
        knownData += `\nCompetitors: ${JSON.stringify(competitors, null, 2)}`;
        knownDataCount++;
    }
    // Equipo
    if (teamMembers && teamMembers.length > 0) {
        knownData += `\nTeam Members: ${JSON.stringify(teamMembers, null, 2)}`;
        knownDataCount++;
    }
    if (teamRoles && teamRoles.length > 0) {
        knownData += `\nTeam Roles: ${JSON.stringify(teamRoles, null, 2)}`;
        knownDataCount++;
    }
    const orgStructure = filterValidData(siteSettings?.org_structure);
    if (orgStructure && Object.keys(orgStructure).length > 0) {
        knownData += `\nOrganizational Structure: ${JSON.stringify(orgStructure, null, 2)}`;
        knownDataCount++;
    }
    // Ubicaciones y horarios
    if (locations && locations.length > 0) {
        knownData += `\nLocations: ${JSON.stringify(locations, null, 2)}`;
        knownDataCount++;
    }
    const businessHours = filterValidData(siteSettings?.business_hours);
    if (businessHours && businessHours.length > 0) {
        knownData += `\nBusiness Hours: ${JSON.stringify(businessHours, null, 2)}`;
        knownDataCount++;
    }
    // Marketing y comunicación
    if (marketingChannels && marketingChannels.length > 0) {
        knownData += `\nMarketing Channels: ${JSON.stringify(marketingChannels, null, 2)}`;
        knownDataCount++;
    }
    const socialMedia = filterValidData(siteSettings?.social_media);
    if (socialMedia && socialMedia.length > 0) {
        knownData += `\nSocial Media: ${JSON.stringify(socialMedia, null, 2)}`;
        knownDataCount++;
    }
    const channels = filterValidData(siteSettings?.channels);
    if (channels && Object.keys(channels).length > 0) {
        knownData += `\nCommunication Channels: ${JSON.stringify(channels, null, 2)}`;
        knownDataCount++;
    }
    // Branding
    if (branding && Object.keys(branding).length > 0) {
        knownData += `\nBranding: ${JSON.stringify(branding, null, 2)}`;
        knownDataCount++;
    }
    // Solo agregar la sección si hay datos conocidos
    if (knownDataCount > 0) {
        topic += knownData;
        console.log(`📊 Added ${knownDataCount} known data fields to research topic`);
    }
    else {
        console.log(`⚠️ No known data fields found to add to research topic`);
    }
    console.log(`🎯 Final research topic length: ${topic.length} characters`);
    return topic;
}
/**
 * Workflow to analyze a site using deep research for company and project research
 *
 * Este workflow ejecuta deep research con información completa de settings
 * para hacer un research integral de la empresa y proyecto
 *
 * @param options - Configuration options for site analysis
 */
async function analyzeSiteWorkflow(options) {
    const { site_id } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    const workflowId = `analyze-site-${site_id}`;
    const startTime = Date.now();
    console.log(`🔍 Starting company and project research workflow for site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'analyzeSiteWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `analyze-site-${site_id}`,
        activityName: 'analyzeSiteWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    let deepResearchResult = null;
    let siteName = '';
    let siteUrl = '';
    try {
        console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
        // Get site information
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
        console.log(`📊 Site data available:`, {
            name: !!site.name,
            url: !!site.url,
            description: !!site.description,
            user_id: !!site.user_id
        });
        console.log(`⚙️ Step 2: Getting settings information for ${site_id}...`);
        // Get settings information
        const settingsResult = await getSettingsActivity(site_id);
        let siteSettings = {};
        if (settingsResult.success && settingsResult.settings) {
            siteSettings = settingsResult.settings;
            console.log(`✅ Retrieved settings information for ${siteName}`);
            // Filtrar settings para mostrar solo lo que tiene contenido
            const filteredSettings = filterValidData(siteSettings);
            console.log(`📊 Settings with actual content:`, {
                about: !!filteredSettings?.about,
                industry: !!filteredSettings?.industry,
                company_size: !!filteredSettings?.company_size,
                products: filteredSettings?.products ? filteredSettings.products.length : 0,
                services: filteredSettings?.services ? filteredSettings.services.length : 0,
                goals: filteredSettings?.goals ? filteredSettings.goals.length : 0,
                swot: filteredSettings?.swot ? Object.keys(filteredSettings.swot).length : 0,
                competitors: filteredSettings?.competitors ? filteredSettings.competitors.length : 0,
                team_members: filteredSettings?.team_members ? filteredSettings.team_members.length : 0,
                team_roles: filteredSettings?.team_roles ? filteredSettings.team_roles.length : 0,
                org_structure: filteredSettings?.org_structure ? Object.keys(filteredSettings.org_structure).length : 0,
                locations: filteredSettings?.locations ? filteredSettings.locations.length : 0,
                business_hours: filteredSettings?.business_hours ? filteredSettings.business_hours.length : 0,
                marketing_channels: filteredSettings?.marketing_channels ? filteredSettings.marketing_channels.length : 0,
                social_media: filteredSettings?.social_media ? filteredSettings.social_media.length : 0,
                channels: filteredSettings?.channels ? Object.keys(filteredSettings.channels).length : 0,
                branding: filteredSettings?.branding ? Object.keys(filteredSettings.branding).length : 0
            });
        }
        else {
            console.log(`⚠️ No settings found for ${siteName}, using empty settings`);
        }
        console.log(`🔬 Step 3: Executing deep research workflow for company and project research...`);
        // Generar deliverables específicos para company and project research - solo con datos reales
        const companyProjectDeliverables = generateCompanyProjectResearchDeliverables(site, siteSettings);
        console.log(`📋 Generated company and project research deliverables with actual data`);
        const hasDeliverables = companyProjectDeliverables && Object.keys(companyProjectDeliverables).length > 0;
        if (hasDeliverables) {
            console.log(`🎯 Company research will cover:`, Object.keys(companyProjectDeliverables));
        }
        else {
            console.log(`⚠️ No meaningful data found for research deliverables`);
        }
        // Research topic enfocado en company and project research - solo con datos reales
        const researchTopic = generateIntelligentResearchTopic(siteName, siteUrl, site, siteSettings);
        console.log(`🎯 Generated intelligent research topic based on available data`);
        console.log(`📝 Research topic: ${researchTopic.split('\n')[0]}...`);
        // Llamar al deep research workflow como workflow hijo
        // Usar estructura separada para evitar duplicación de company information
        const deepResearchHandle = await (0, workflow_1.startChild)(deepResearchWorkflow_1.deepResearchWorkflow, {
            args: [{
                    site_id: site_id,
                    research_topic: researchTopic,
                    userId: options.userId || site.user_id,
                    deliverables: {
                        // Enviar la información de company en la estructura correcta
                        company: companyProjectDeliverables,
                        // Lead vacío ya que esto es research de company, no de lead
                        lead: {}
                    }
                }],
            workflowId: `deep-research-company-${site_id}-${Date.now()}`,
        });
        deepResearchResult = await deepResearchHandle.result();
        console.log(`🔍 Deep research workflow completed`);
        console.log(`📊 Deep research result:`, {
            success: deepResearchResult.success,
            hasData: !!deepResearchResult.data,
            operationsCount: deepResearchResult.data?.operations?.length || 0,
            insightsCount: deepResearchResult.data?.insights?.length || 0,
            recommendationsCount: deepResearchResult.data?.recommendations?.length || 0
        });
        if (!deepResearchResult.success) {
            const warningMsg = `Deep research workflow failed: ${deepResearchResult.error}`;
            console.warn(`⚠️ ${warningMsg}`);
            errors.push(warningMsg);
        }
        else {
            console.log(`✅ Deep research completed successfully for company and project research`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId: site_id,
            siteName,
            siteUrl,
            deepResearchResult,
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 Company and project research workflow completed successfully!`);
        console.log(`📊 Summary: Company research for ${siteName} completed in ${executionTime}`);
        console.log(`   - Site: ${siteName} (${siteUrl})`);
        console.log(`   - Deep research success: ${deepResearchResult?.success || false}`);
        console.log(`   - Errors: ${errors.length}`);
        console.log(`   - Company research deliverables processed: ${!!deepResearchResult?.data?.deliverables}`);
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `analyze-site-${site_id}`,
            activityName: 'analyzeSiteWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'analyzeSiteWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Company and project research workflow failed: ${errorMessage}`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `analyze-site-${site_id}`,
            activityName: 'analyzeSiteWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'analyzeSiteWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Return failed result instead of throwing to provide more information
        const result = {
            success: false,
            siteId: site_id,
            siteName,
            siteUrl,
            deepResearchResult,
            errors: [...errors, errorMessage],
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
    }
}
