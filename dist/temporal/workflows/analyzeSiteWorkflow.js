"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSiteWorkflow = analyzeSiteWorkflow;
const workflow_1 = require("@temporalio/workflow");
const deepResearchWorkflow_1 = require("./deepResearchWorkflow");
// Define the activity interface with common activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, getSettingsActivity, updateSettingsActivity, uxAnalysisActivity, sendProjectAnalysisNotificationActivity, } = (0, workflow_1.proxyActivities)({
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
 * SIEMPRE incluye todas las secciones importantes para que deep research las complete
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
        swot: siteSettings?.swot ? Object.keys(siteSettings.swot) : null,
        competitors: Array.isArray(siteSettings?.competitors) ? siteSettings.competitors.length : null,
        team_members: Array.isArray(siteSettings?.team_members) ? siteSettings.team_members.length : null,
        team_roles: Array.isArray(siteSettings?.team_roles) ? siteSettings.team_roles.length : null,
        marketing_channels: Array.isArray(siteSettings?.marketing_channels) ? siteSettings.marketing_channels.length : null,
    });
    const deliverables = {
        // Campos exactos que necesitamos para settings
        about: siteSettings?.about || "A comprehensive description of the company, its mission, vision, and what the business does. Should be 2-3 sentences that clearly explain the company's purpose and value proposition.",
        industry: siteSettings?.industry || "The specific industry sector the company operates in (e.g., 'Technology', 'Healthcare', 'E-commerce', 'Financial Services', 'Manufacturing', etc.)",
        company_size: siteSettings?.company_size || "The size of the company in terms of employees (e.g., '1-10', '11-50', '51-200', '201-500', '500+', 'Startup', 'SME', 'Enterprise')",
        // Productos - estructura exacta para settings.products
        products: filterValidData(siteSettings?.products) || [
            {
                name: "Name of the specific product or software offering",
                description: "Detailed description of what the product does and its main benefits",
                category: "Product category (e.g., 'Software', 'Hardware', 'Service', 'Platform')",
                price: "Pricing information or pricing model (e.g., '$99/month', 'Contact for pricing', 'Free with premium options')",
                features: ["List of key features", "Main capabilities", "Important functionalities"],
                target_audience: "Who this product is designed for (e.g., 'Small businesses', 'Enterprise clients', 'Developers')"
            }
        ],
        // Servicios - estructura exacta para settings.services
        services: filterValidData(siteSettings?.services) || [
            {
                name: "Name of the service offered",
                description: "Detailed description of the service and what it includes",
                category: "Service category (e.g., 'Consulting', 'Support', 'Training', 'Development')",
                price: "Service pricing or pricing structure",
                duration: "How long the service takes or is delivered (e.g., '2-3 weeks', 'Ongoing', '1-day workshop')",
                target_audience: "Who this service is intended for"
            }
        ],
        // SWOT - estructura exacta para settings.swot
        swot: filterValidData(siteSettings?.swot) || {
            strengths: ["Internal positive factors", "Competitive advantages", "Unique capabilities", "Strong assets"],
            weaknesses: ["Internal areas for improvement", "Limitations", "Challenges", "Gaps"],
            opportunities: ["External positive possibilities", "Market opportunities", "Growth potential", "Emerging trends"],
            threats: ["External challenges", "Market risks", "Competitive threats", "Potential obstacles"]
        },
        // Competidores - estructura exacta para settings.competitors
        competitors: filterValidData(siteSettings?.competitors) || [
            {
                name: "Name of competing company",
                url: "Competitor's website URL",
                description: "Brief description of what the competitor does",
                market_position: "Their position in the market (e.g., 'Market leader', 'Niche player', 'Emerging competitor')",
                key_differentiators: ["What makes them different", "Their main advantages", "Unique selling points"],
                strengths: ["Their main strengths", "What they do well"],
                weaknesses: ["Their limitations", "Areas where they struggle"]
            }
        ],
        // Team members - estructura exacta para settings.team_members
        team_members: filterValidData(siteSettings?.team_members) || [
            {
                name: "Full name of team member",
                position: "Job title or position",
                role: "Their role in the company (e.g., 'Founder', 'Lead Developer', 'Sales Manager')",
                email: "Professional email address",
                responsibilities: ["Main responsibilities", "Key duties", "Areas of focus"],
                experience: "Brief description of their background and experience"
            }
        ],
        // Team roles - estructura exacta para settings.team_roles
        team_roles: filterValidData(siteSettings?.team_roles) || [
            {
                title: "Job title or role name",
                department: "Department or team (e.g., 'Engineering', 'Sales', 'Marketing')",
                responsibilities: ["Key responsibilities", "Main duties", "Areas of ownership"],
                requirements: ["Required skills", "Experience needed", "Qualifications"],
                seniority_level: "Level of seniority (e.g., 'Junior', 'Senior', 'Manager', 'Director')"
            }
        ],
        // Org structure - estructura exacta para settings.org_structure
        org_structure: filterValidData(siteSettings?.org_structure) || {
            departments: ["List of main departments", "Organizational units", "Teams"],
            hierarchy: "Organizational hierarchy structure with reporting relationships",
            reporting_structure: "Who reports to whom, management structure",
            decision_making_process: "How decisions are made in the organization"
        },
        // Locations - estructura exacta para settings.locations
        locations: filterValidData(siteSettings?.locations) || [
            {
                name: "Location name or office name",
                address: "Full physical address",
                city: "City name",
                country: "Country name",
                timezone: "Timezone (e.g., 'America/New_York', 'Europe/London')",
                type: "Type of location (e.g., 'headquarters', 'office', 'branch', 'remote')",
                contact_info: "Contact information specific to this location"
            }
        ],
        // Business hours - estructura exacta para settings.business_hours
        business_hours: filterValidData(siteSettings?.business_hours) || [
            {
                name: "Name of business hours schedule (e.g., 'Main Office Hours', 'Support Hours')",
                timezone: "Timezone for these hours",
                days: {
                    monday: { enabled: true, start: "09:00", end: "17:00" },
                    tuesday: { enabled: true, start: "09:00", end: "17:00" },
                    wednesday: { enabled: true, start: "09:00", end: "17:00" },
                    thursday: { enabled: true, start: "09:00", end: "17:00" },
                    friday: { enabled: true, start: "09:00", end: "17:00" },
                    saturday: { enabled: false, start: null, end: null },
                    sunday: { enabled: false, start: null, end: null }
                },
                respectHolidays: true
            }
        ],
        // Marketing channels - estructura exacta para settings.marketing_channels
        marketing_channels: filterValidData(siteSettings?.marketing_channels) || [
            {
                channel: "Marketing channel type (e.g., 'social_media', 'email', 'content', 'paid_ads', 'seo')",
                platform: "Specific platform if applicable (e.g., 'LinkedIn', 'Google Ads', 'Newsletter')",
                strategy: "Marketing strategy or approach for this channel",
                target_audience: "Target audience for this channel",
                budget_allocation: "Budget or investment level for this channel",
                performance_metrics: ["Key metrics tracked", "Success indicators", "KPIs"]
            }
        ],
        // Social media - estructura exacta para settings.social_media
        social_media: filterValidData(siteSettings?.social_media) || [
            {
                platform: "Social media platform name (e.g., 'LinkedIn', 'Twitter', 'Facebook', 'Instagram')",
                url: "Profile URL on the platform",
                followers: "Number of followers or 'Not specified'",
                engagement_rate: "Engagement rate percentage or description",
                content_strategy: "Type of content shared and strategy",
                posting_frequency: "How often content is posted (e.g., 'Daily', '3x per week')"
            }
        ],
        // Channels - estructura exacta para settings.channels
        channels: filterValidData(siteSettings?.channels) || [
            {
                type: 'customer_support',
                email: "Support email address",
                phone: "Support phone number",
                chat: "Chat platform or availability",
                hours: "Support hours description"
            },
            {
                type: 'sales',
                email: "Sales email address",
                phone: "Sales phone number",
                contact_form: "URL to contact form or availability description"
            },
            {
                type: 'partnerships',
                email: "Partnerships email address",
                contact_person: "Name of partnerships contact person"
            }
        ]
    };
    console.log(`🔍 DEBUG: Deliverables structure (will ALWAYS include all sections):`, {
        about: deliverables.about ? 'Has content' : 'Requested for completion',
        industry: deliverables.industry ? 'Has content' : 'Requested for completion',
        company_size: deliverables.company_size ? 'Has content' : 'Requested for completion',
        products: `Array with ${Array.isArray(deliverables.products) ? deliverables.products.length : 0} items`,
        services: `Array with ${Array.isArray(deliverables.services) ? deliverables.services.length : 0} items`,
        swot: deliverables.swot ? Object.keys(deliverables.swot) : [],
        competitors: `Array with ${Array.isArray(deliverables.competitors) ? deliverables.competitors.length : 0} items`,
        team_members: `Array with ${Array.isArray(deliverables.team_members) ? deliverables.team_members.length : 0} items`,
        team_roles: `Array with ${Array.isArray(deliverables.team_roles) ? deliverables.team_roles.length : 0} items`,
        org_structure: deliverables.org_structure ? Object.keys(deliverables.org_structure) : [],
        locations: `Array with ${Array.isArray(deliverables.locations) ? deliverables.locations.length : 0} items`,
        business_hours: `Array with ${Array.isArray(deliverables.business_hours) ? deliverables.business_hours.length : 0} items`,
        marketing_channels: `Array with ${Array.isArray(deliverables.marketing_channels) ? deliverables.marketing_channels.length : 0} items`,
        social_media: `Array with ${Array.isArray(deliverables.social_media) ? deliverables.social_media.length : 0} items`,
        channels: `Array with ${Array.isArray(deliverables.channels) ? deliverables.channels.length : 0} items`
    });
    console.log(`✅ All sections included in deliverables for deep research to complete`);
    // NO filtrar la estructura final - queremos enviar TODAS las secciones
    return deliverables;
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
    if (channels && Array.isArray(channels) && channels.length > 0) {
        knownData += `\nCommunication Channels: ${JSON.stringify(channels, null, 2)}`;
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
 * Extrae datos del deep research para actualizar settings
 * Solo incluye campos que tienen datos reales y no están vacíos
 */
function extractSettingsUpdateFromDeepResearch(deepResearchResult, existingSettings) {
    console.log(`🔍 Extracting settings updates from deep research...`);
    if (!deepResearchResult || !deepResearchResult.success || !deepResearchResult.data) {
        console.log(`⚠️ No valid deep research data to extract settings from`);
        return null;
    }
    const researchData = deepResearchResult.data;
    const deliverables = researchData.deliverables;
    if (!deliverables || !deliverables.company) {
        console.log(`⚠️ No company deliverables found in deep research data`);
        return null;
    }
    const company = deliverables.company;
    const settingsUpdate = {};
    let updateCount = 0;
    // Función helper para verificar si un campo está vacío
    const isEmptyField = (field) => {
        if (!field)
            return true;
        if (typeof field === 'string')
            return field.trim() === '';
        if (Array.isArray(field))
            return field.length === 0;
        if (typeof field === 'object')
            return Object.keys(field).length === 0;
        return false;
    };
    // About - extraer directamente del campo about del deep research
    if (company.about && typeof company.about === 'string' && company.about.trim() !== '') {
        if (isEmptyField(existingSettings.about)) {
            settingsUpdate.about = company.about.trim();
            updateCount++;
            console.log(`   ✅ About: ${company.about.substring(0, 100)}...`);
        }
    }
    // Industry - extraer directamente del campo industry del deep research
    if (company.industry && typeof company.industry === 'string' && company.industry.trim() !== '') {
        if (isEmptyField(existingSettings.industry)) {
            settingsUpdate.industry = company.industry.trim();
            updateCount++;
            console.log(`   ✅ Industry: ${company.industry}`);
        }
    }
    // Company size - extraer directamente del campo company_size del deep research
    if (company.company_size && typeof company.company_size === 'string' && company.company_size.trim() !== '') {
        if (isEmptyField(existingSettings.company_size)) {
            settingsUpdate.company_size = company.company_size.trim();
            updateCount++;
            console.log(`   ✅ Company size: ${company.company_size}`);
        }
    }
    // Products - extraer directamente del campo products del deep research
    if (company.products && Array.isArray(company.products) && company.products.length > 0) {
        const mappedProducts = company.products
            .filter((p) => p && p.name && p.name.trim() !== '')
            .map((p) => ({
            name: p.name?.trim() || '',
            description: p.description?.trim() || null,
            category: p.category?.trim() || null,
            price: p.price || null,
            features: Array.isArray(p.features)
                ? p.features.filter((f) => f && typeof f === 'string' && f.trim() !== '').map((f) => f.trim())
                : [],
            target_audience: p.target_audience?.trim() || null
        }));
        if (mappedProducts.length > 0 && isEmptyField(existingSettings.products)) {
            settingsUpdate.products = mappedProducts;
            updateCount++;
            console.log(`   ✅ Products: ${mappedProducts.length} items - ${mappedProducts.map((p) => p.name).join(', ')}`);
        }
    }
    // Services - extraer directamente del campo services del deep research
    if (company.services && Array.isArray(company.services) && company.services.length > 0) {
        const mappedServices = company.services
            .filter((s) => s && s.name && s.name.trim() !== '')
            .map((s) => ({
            name: s.name?.trim() || '',
            description: s.description?.trim() || null,
            category: s.category?.trim() || null,
            price: s.price || null,
            duration: s.duration?.trim() || null,
            target_audience: s.target_audience?.trim() || null
        }));
        if (mappedServices.length > 0 && isEmptyField(existingSettings.services)) {
            settingsUpdate.services = mappedServices;
            updateCount++;
            console.log(`   ✅ Services: ${mappedServices.length} items - ${mappedServices.map((s) => s.name).join(', ')}`);
        }
    }
    // SWOT - extraer directamente del campo swot del deep research
    if (company.swot && typeof company.swot === 'object' && Object.keys(company.swot).length > 0) {
        const swot = company.swot;
        const mappedSWOT = {
            strengths: Array.isArray(swot.strengths)
                ? swot.strengths.filter((s) => s && typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
                : [],
            weaknesses: Array.isArray(swot.weaknesses)
                ? swot.weaknesses.filter((w) => w && typeof w === 'string' && w.trim() !== '').map((w) => w.trim())
                : [],
            opportunities: Array.isArray(swot.opportunities)
                ? swot.opportunities.filter((o) => o && typeof o === 'string' && o.trim() !== '').map((o) => o.trim())
                : [],
            threats: Array.isArray(swot.threats)
                ? swot.threats.filter((t) => t && typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
                : []
        };
        const hasValidSWOT = mappedSWOT.strengths.length > 0 ||
            mappedSWOT.weaknesses.length > 0 ||
            mappedSWOT.opportunities.length > 0 ||
            mappedSWOT.threats.length > 0;
        if (hasValidSWOT && isEmptyField(existingSettings.swot)) {
            settingsUpdate.swot = mappedSWOT;
            updateCount++;
            console.log(`   ✅ SWOT: S:${mappedSWOT.strengths.length}, W:${mappedSWOT.weaknesses.length}, O:${mappedSWOT.opportunities.length}, T:${mappedSWOT.threats.length}`);
        }
    }
    // Competitors - extraer directamente del campo competitors del deep research
    if (company.competitors && Array.isArray(company.competitors) && company.competitors.length > 0) {
        const mappedCompetitors = company.competitors
            .filter((c) => c && c.name && c.name.trim() !== '')
            .map((c) => ({
            name: c.name?.trim() || '',
            url: c.url || null,
            description: c.description?.trim() || null,
            market_position: c.market_position?.trim() || null,
            key_differentiators: Array.isArray(c.key_differentiators)
                ? c.key_differentiators.filter((d) => d && typeof d === 'string' && d.trim() !== '').map((d) => d.trim())
                : [],
            strengths: Array.isArray(c.strengths)
                ? c.strengths.filter((s) => s && typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
                : [],
            weaknesses: Array.isArray(c.weaknesses)
                ? c.weaknesses.filter((w) => w && typeof w === 'string' && w.trim() !== '').map((w) => w.trim())
                : []
        }));
        if (mappedCompetitors.length > 0 && isEmptyField(existingSettings.competitors)) {
            settingsUpdate.competitors = mappedCompetitors;
            updateCount++;
            console.log(`   ✅ Competitors: ${mappedCompetitors.length} items - ${mappedCompetitors.map((c) => c.name).join(', ')}`);
        }
    }
    // Team members - extraer directamente del campo team_members del deep research
    if (company.team_members && Array.isArray(company.team_members) && company.team_members.length > 0) {
        const mappedMembers = company.team_members
            .filter((m) => m && m.name && m.name.trim() !== '')
            .map((m) => ({
            name: m.name?.trim() || '',
            position: m.position?.trim() || null,
            role: m.role?.trim() || null,
            email: m.email?.trim() || null,
            responsibilities: Array.isArray(m.responsibilities)
                ? m.responsibilities.filter((r) => r && typeof r === 'string' && r.trim() !== '').map((r) => r.trim())
                : [],
            experience: m.experience?.trim() || null
        }));
        if (mappedMembers.length > 0 && isEmptyField(existingSettings.team_members)) {
            settingsUpdate.team_members = mappedMembers;
            updateCount++;
            console.log(`   ✅ Team members: ${mappedMembers.length} items - ${mappedMembers.map((m) => m.name).join(', ')}`);
        }
    }
    // Team roles - extraer directamente del campo team_roles del deep research
    if (company.team_roles && Array.isArray(company.team_roles) && company.team_roles.length > 0) {
        const mappedRoles = company.team_roles
            .filter((r) => r && r.title && r.title.trim() !== '')
            .map((r) => ({
            title: r.title?.trim() || '',
            department: r.department?.trim() || null,
            responsibilities: Array.isArray(r.responsibilities)
                ? r.responsibilities.filter((resp) => resp && typeof resp === 'string' && resp.trim() !== '').map((resp) => resp.trim())
                : [],
            requirements: Array.isArray(r.requirements)
                ? r.requirements.filter((req) => req && typeof req === 'string' && req.trim() !== '').map((req) => req.trim())
                : [],
            seniority_level: r.seniority_level?.trim() || null
        }));
        if (mappedRoles.length > 0 && isEmptyField(existingSettings.team_roles)) {
            settingsUpdate.team_roles = mappedRoles;
            updateCount++;
            console.log(`   ✅ Team roles: ${mappedRoles.length} items - ${mappedRoles.map((r) => r.title).join(', ')}`);
        }
    }
    // Org structure - extraer directamente del campo org_structure del deep research
    if (company.org_structure && typeof company.org_structure === 'object' && Object.keys(company.org_structure).length > 0) {
        const orgStructure = company.org_structure;
        const mappedOrgStructure = {
            departments: Array.isArray(orgStructure.departments)
                ? orgStructure.departments.filter((d) => d && typeof d === 'string' && d.trim() !== '').map((d) => d.trim())
                : [],
            hierarchy: orgStructure.hierarchy || {},
            reporting_structure: orgStructure.reporting_structure || {},
            decision_making_process: orgStructure.decision_making_process?.trim() || null
        };
        if (!isEmptyField(existingSettings.org_structure)) {
            settingsUpdate.org_structure = mappedOrgStructure;
            updateCount++;
            console.log(`   ✅ Organizational structure: ${Object.keys(mappedOrgStructure).join(', ')}`);
        }
    }
    // Locations - extraer directamente del campo locations del deep research
    if (company.locations && Array.isArray(company.locations) && company.locations.length > 0) {
        const mappedLocations = company.locations
            .filter((l) => l && l.name && l.name.trim() !== '')
            .map((l) => ({
            name: l.name?.trim() || '',
            address: l.address?.trim() || null,
            city: l.city?.trim() || null,
            country: l.country?.trim() || null,
            timezone: l.timezone?.trim() || null,
            type: l.type?.trim() || null,
            contact_info: l.contact_info || {}
        }));
        if (mappedLocations.length > 0 && isEmptyField(existingSettings.locations)) {
            settingsUpdate.locations = mappedLocations;
            updateCount++;
            console.log(`   ✅ Locations: ${mappedLocations.length} items`);
        }
    }
    // Business hours - extraer directamente del campo business_hours del deep research
    if (company.business_hours && Array.isArray(company.business_hours) && company.business_hours.length > 0) {
        const mappedHours = company.business_hours
            .filter((h) => h && h.name && h.timezone)
            .map((h) => ({
            name: h.name?.trim() || '',
            timezone: h.timezone?.trim() || '',
            days: h.days || {
                monday: { enabled: false, start: null, end: null },
                tuesday: { enabled: false, start: null, end: null },
                wednesday: { enabled: false, start: null, end: null },
                thursday: { enabled: false, start: null, end: null },
                friday: { enabled: false, start: null, end: null },
                saturday: { enabled: false, start: null, end: null },
                sunday: { enabled: false, start: null, end: null }
            },
            respectHolidays: h.respectHolidays || false
        }));
        if (mappedHours.length > 0 && isEmptyField(existingSettings.business_hours)) {
            settingsUpdate.business_hours = mappedHours;
            updateCount++;
            console.log(`   ✅ Business hours: ${mappedHours.length} items`);
        }
    }
    // Marketing channels - extraer directamente del campo marketing_channels del deep research
    if (company.marketing_channels && Array.isArray(company.marketing_channels) && company.marketing_channels.length > 0) {
        const mappedChannels = company.marketing_channels
            .filter((c) => c && c.channel && c.channel.trim() !== '')
            .map((c) => ({
            channel: c.channel?.trim() || '',
            platform: c.platform?.trim() || null,
            strategy: c.strategy?.trim() || null,
            target_audience: c.target_audience?.trim() || null,
            budget_allocation: c.budget_allocation || null,
            performance_metrics: Array.isArray(c.performance_metrics)
                ? c.performance_metrics.filter((m) => m && typeof m === 'string' && m.trim() !== '').map((m) => m.trim())
                : []
        }));
        if (mappedChannels.length > 0 && isEmptyField(existingSettings.marketing_channels)) {
            settingsUpdate.marketing_channels = mappedChannels;
            updateCount++;
            console.log(`   ✅ Marketing channels: ${mappedChannels.length} items`);
        }
    }
    // Social media - extraer directamente del campo social_media del deep research
    if (company.social_media && Array.isArray(company.social_media) && company.social_media.length > 0) {
        const mappedSocial = company.social_media
            .filter((s) => s && s.platform && s.platform.trim() !== '')
            .map((s) => ({
            platform: s.platform?.trim() || '',
            url: s.url?.trim() || null,
            followers: s.followers || null,
            engagement_rate: s.engagement_rate || null,
            content_strategy: s.content_strategy?.trim() || null,
            posting_frequency: s.posting_frequency?.trim() || null
        }));
        if (mappedSocial.length > 0 && isEmptyField(existingSettings.social_media)) {
            settingsUpdate.social_media = mappedSocial;
            updateCount++;
            console.log(`   ✅ Social media: ${mappedSocial.length} items`);
        }
    }
    // Channels - extraer directamente del campo channels del deep research
    if (company.channels && Array.isArray(company.channels) && company.channels.length > 0) {
        const mappedChannels = company.channels
            .filter((c) => c && c.type && c.type.trim() !== '')
            .map((c) => ({
            type: c.type?.trim() || '',
            email: c.email?.trim() || null,
            phone: c.phone?.trim() || null,
            chat: c.chat?.trim() || null,
            hours: c.hours?.trim() || null,
            contact_form: c.contact_form?.trim() || null,
            contact_person: c.contact_person?.trim() || null
        }));
        if (mappedChannels.length > 0 && isEmptyField(existingSettings.channels)) {
            settingsUpdate.channels = mappedChannels;
            updateCount++;
            console.log(`   ✅ Communication channels: ${mappedChannels.length} items`);
        }
    }
    console.log(`📊 Settings update summary: ${updateCount} fields to update`);
    if (updateCount === 0) {
        console.log(`⚠️ No settings updates needed - all fields already have data`);
        return null;
    }
    return settingsUpdate;
}
/**
 * Extract the real schedule ID from workflow info
 * This looks for evidence of schedule execution in search attributes or memo
 */
function extractScheduleId(info) {
    // Check if workflow was triggered by a schedule
    // Temporal schedules typically set search attributes or memo data
    const searchAttributes = info.searchAttributes || {};
    const memo = info.memo || {};
    // Look for common schedule-related attributes
    const scheduleId = searchAttributes['TemporalScheduledById'] ||
        searchAttributes['ScheduleId'] ||
        memo['TemporalScheduledById'] ||
        memo['scheduleId'] ||
        memo['scheduleName'];
    if (scheduleId) {
        console.log(`✅ Analyze Site - Real schedule ID found: ${scheduleId}`);
        return scheduleId;
    }
    // If no schedule ID found, it might be a manual execution or child workflow
    console.log(`⚠️ Analyze Site - No schedule ID found in workflow info - likely manual execution`);
    return 'manual-execution';
}
/**
 * Workflow to analyze a site using deep research for company and project research
 *
 * Este workflow ejecuta el siguiente flujo:
 * 1. Obtiene información del site y settings
 * 2. Ejecuta deep research con información completa de settings
 * 3. Actualiza settings con datos del deep research (solo campos vacíos)
 * 4. Llama a la API de UX analysis
 * 5. Envía notificación de project analysis (si todo sale bien)
 *
 * @param options - Configuration options for site analysis
 */
async function analyzeSiteWorkflow(options) {
    const { site_id } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    const searchAttributes = {
        site_id: [site_id],
    };
    if (options.userId) {
        searchAttributes.user_id = [options.userId];
    }
    (0, workflow_1.upsertSearchAttributes)(searchAttributes);
    // Get workflow information from Temporal to extract schedule ID
    const workflowInfo_real = (0, workflow_1.workflowInfo)();
    const realWorkflowId = workflowInfo_real.workflowId;
    const realScheduleId = extractScheduleId(workflowInfo_real);
    const workflowId = `analyze-site-${site_id}`;
    const startTime = Date.now();
    console.log(`🔍 Starting company and project research workflow for site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    console.log(`📋 REAL Workflow ID: ${realWorkflowId} (from Temporal)`);
    console.log(`📋 REAL Schedule ID: ${realScheduleId} (from ${realScheduleId === 'manual-execution' ? 'manual execution' : 'schedule'})`);
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
    let uxAnalysisResult = null;
    let settingsUpdates = null;
    let notificationResult = null;
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
                swot: filteredSettings?.swot ? Object.keys(filteredSettings.swot).length : 0,
                competitors: filteredSettings?.competitors ? filteredSettings.competitors.length : 0,
                team_members: filteredSettings?.team_members ? filteredSettings.team_members.length : 0,
                team_roles: filteredSettings?.team_roles ? filteredSettings.team_roles.length : 0,
                org_structure: filteredSettings?.org_structure ? Object.keys(filteredSettings.org_structure).length : 0,
                locations: filteredSettings?.locations ? filteredSettings.locations.length : 0,
                business_hours: filteredSettings?.business_hours ? filteredSettings.business_hours.length : 0,
                marketing_channels: filteredSettings?.marketing_channels ? filteredSettings.marketing_channels.length : 0,
                social_media: filteredSettings?.social_media ? filteredSettings.social_media.length : 0,
                channels: filteredSettings?.channels ? filteredSettings.channels.length : 0,
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
                    scheduleId: realScheduleId, // Pass the schedule ID from parent workflow
                    parentWorkflowType: 'analyzeSiteWorkflow', // Identify the parent workflow type
                    deliverables: {
                        // Enviar la información de company en la estructura correcta
                        company: companyProjectDeliverables,
                        // Lead vacío ya que esto es research de company, no de lead
                        lead: {}
                    }
                }],
            workflowId: `deep-research-company-${site_id}-${Date.now()}`,
            parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON, // ✅ Child continues independently
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
        console.log(`🔄 Step 4: Updating settings with deep research data...`);
        // Extract settings updates from deep research data
        settingsUpdates = extractSettingsUpdateFromDeepResearch(deepResearchResult, siteSettings);
        const settingsInsights = [];
        if (settingsUpdates) {
            console.log(`📝 Updating settings with ${Object.keys(settingsUpdates).length} new fields...`);
            const updateSettingsResult = await updateSettingsActivity(site_id, settingsUpdates);
            if (updateSettingsResult.success) {
                console.log(`✅ Settings updated successfully with deep research data`);
                // Generar insights basados en lo que se actualizó
                if (settingsUpdates.about) {
                    settingsInsights.push(`Company description updated with comprehensive project summary`);
                }
                if (settingsUpdates.industry) {
                    settingsInsights.push(`Industry classification updated to: ${settingsUpdates.industry}`);
                }
                if (settingsUpdates.company_size) {
                    settingsInsights.push(`Company size defined as: ${settingsUpdates.company_size}`);
                }
                if (settingsUpdates.products && settingsUpdates.products.length > 0) {
                    settingsInsights.push(`${settingsUpdates.products.length} products identified and catalogued: ${settingsUpdates.products.map((p) => p.name).join(', ')}`);
                }
                if (settingsUpdates.services && settingsUpdates.services.length > 0) {
                    settingsInsights.push(`${settingsUpdates.services.length} services identified and catalogued: ${settingsUpdates.services.map((s) => s.name).join(', ')}`);
                }
                if (settingsUpdates.swot) {
                    const swotCounts = {
                        strengths: settingsUpdates.swot.strengths?.length || 0,
                        weaknesses: settingsUpdates.swot.weaknesses?.length || 0,
                        opportunities: settingsUpdates.swot.opportunities?.length || 0,
                        threats: settingsUpdates.swot.threats?.length || 0
                    };
                    settingsInsights.push(`SWOT analysis completed with ${swotCounts.strengths} strengths, ${swotCounts.weaknesses} weaknesses, ${swotCounts.opportunities} opportunities, and ${swotCounts.threats} threats identified`);
                }
                if (settingsUpdates.competitors && settingsUpdates.competitors.length > 0) {
                    settingsInsights.push(`${settingsUpdates.competitors.length} key competitors identified: ${settingsUpdates.competitors.map((c) => c.name).join(', ')}`);
                }
                if (settingsUpdates.team_members && settingsUpdates.team_members.length > 0) {
                    settingsInsights.push(`${settingsUpdates.team_members.length} team members profiled: ${settingsUpdates.team_members.map((m) => m.name).join(', ')}`);
                }
                if (settingsUpdates.team_roles && settingsUpdates.team_roles.length > 0) {
                    settingsInsights.push(`${settingsUpdates.team_roles.length} organizational roles defined: ${settingsUpdates.team_roles.map((r) => r.title).join(', ')}`);
                }
                if (settingsUpdates.org_structure) {
                    settingsInsights.push(`Organizational structure mapped with departments and hierarchy defined`);
                }
                if (settingsUpdates.locations && settingsUpdates.locations.length > 0) {
                    settingsInsights.push(`${settingsUpdates.locations.length} business locations documented`);
                }
                if (settingsUpdates.business_hours && settingsUpdates.business_hours.length > 0) {
                    settingsInsights.push(`Business hours and operating schedules configured`);
                }
                if (settingsUpdates.marketing_channels && settingsUpdates.marketing_channels.length > 0) {
                    settingsInsights.push(`${settingsUpdates.marketing_channels.length} marketing channels strategy documented`);
                }
                if (settingsUpdates.social_media && settingsUpdates.social_media.length > 0) {
                    settingsInsights.push(`Social media presence documented across ${settingsUpdates.social_media.length} platforms`);
                }
                if (settingsUpdates.channels && settingsUpdates.channels.length > 0) {
                    settingsInsights.push(`${settingsUpdates.channels.length} communication channels configured`);
                }
            }
            else {
                const errorMsg = `Failed to update settings: ${updateSettingsResult.error}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        else {
            console.log(`ℹ️ No settings updates needed - all fields already populated`);
            settingsInsights.push(`All critical business information already documented - no updates required`);
        }
        console.log(`🎨 Step 5: Calling UX analysis API...`);
        // Call UX analysis API
        uxAnalysisResult = await uxAnalysisActivity({
            site_id: site_id,
            userId: options.userId || site.user_id,
            additionalData: {
                deepResearchResult: deepResearchResult,
                updatedSettings: settingsUpdates || {}
            }
        });
        const uxInsights = [];
        if (uxAnalysisResult.success) {
            console.log(`✅ UX analysis completed successfully`);
            // Verificar si UX analysis actualizó branding u otros campos
            if (uxAnalysisResult.data?.branding_updated || uxAnalysisResult.branding_updated) {
                uxInsights.push(`Brand identity and visual guidelines updated based on UX analysis`);
            }
            if (uxAnalysisResult.data?.recommendations && Array.isArray(uxAnalysisResult.data.recommendations)) {
                uxInsights.push(`${uxAnalysisResult.data.recommendations.length} UX recommendations generated for site optimization`);
            }
            if (uxAnalysisResult.data?.usability_score || uxAnalysisResult.usability_score) {
                const score = uxAnalysisResult.data?.usability_score || uxAnalysisResult.usability_score;
                uxInsights.push(`Site usability analysis completed with score: ${score}`);
            }
            if (uxAnalysisResult.data?.accessibility_improvements || uxAnalysisResult.accessibility_improvements) {
                uxInsights.push(`Accessibility improvements identified and documented`);
            }
            if (uxAnalysisResult.data?.design_system_updates || uxAnalysisResult.design_system_updates) {
                uxInsights.push(`Design system and component library recommendations generated`);
            }
            // Si no hay insights específicos, agregar uno general
            if (uxInsights.length === 0) {
                uxInsights.push(`Comprehensive UX analysis completed with actionable recommendations`);
            }
        }
        else {
            const errorMsg = `UX analysis failed: ${uxAnalysisResult.error?.message || 'Unknown error'}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            uxInsights.push(`UX analysis encountered issues but deep research insights remain valuable`);
        }
        // Send project analysis notification only if everything went well
        const criticalErrorsExist = errors.some(error => error.includes('Failed to get site information') ||
            error.includes('Deep research workflow failed'));
        if (!criticalErrorsExist) {
            console.log(`🔔 Step 6: Sending project analysis notification...`);
            // Combinar todos los insights como strings
            const allInsightStrings = [
                ...settingsInsights,
                ...uxInsights,
                `Deep research analysis completed with comprehensive company intelligence`,
                `Project analysis workflow executed successfully with ${settingsInsights.length + uxInsights.length} key insights generated`
            ];
            // Convertir strings a objetos que espera la API
            const allInsights = allInsightStrings.map((insight, index) => {
                // Determinar el tipo basado en el contenido - solo usar tipos permitidos por la API
                let type = 'finding';
                let category = 'analysis';
                if (insight.includes('updated') || insight.includes('identified') || insight.includes('catalogued')) {
                    type = 'change'; // Cambios realizados en settings
                    category = 'business_intelligence';
                }
                else if (insight.includes('recommendations') || insight.includes('UX analysis')) {
                    type = 'recommendation'; // Recomendaciones de UX o mejoras
                    category = 'user_experience';
                }
                else if (insight.includes('completed') || insight.includes('analysis')) {
                    type = 'finding'; // Hallazgos y análisis completados
                    category = 'analysis';
                }
                else if (insight.includes('workflow executed') || insight.includes('insights generated')) {
                    type = 'finding'; // Resultados del workflow
                    category = 'process';
                }
                else {
                    type = 'finding'; // Default para cualquier otro caso
                    category = 'general';
                }
                return {
                    title: insight.length > 50 ? insight.substring(0, 50) + '...' : insight,
                    description: insight,
                    type: type,
                    category: category,
                    order: index + 1
                };
            });
            console.log(`📊 Sending ${allInsights.length} insights to project analysis notification`);
            // Send project analysis notification
            notificationResult = await sendProjectAnalysisNotificationActivity({
                site_id: site_id,
                insights: allInsights,
                deepResearchResult: deepResearchResult,
                uxAnalysisResult: uxAnalysisResult,
                settingsUpdates: settingsUpdates || {}
            });
            if (notificationResult.success) {
                console.log(`✅ Project analysis notification sent successfully with ${allInsights.length} insights`);
            }
            else {
                const errorMsg = `Failed to send project analysis notification: ${notificationResult.error || 'Unknown error'}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        else {
            console.log(`⚠️ Skipping project analysis notification due to critical errors`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId: site_id,
            siteName,
            siteUrl,
            deepResearchResult,
            uxAnalysisResult,
            settingsUpdates,
            notificationResult,
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
        // Throw error to properly fail the workflow
        throw new Error(`Analyze site workflow failed: ${errorMessage}`);
    }
}
