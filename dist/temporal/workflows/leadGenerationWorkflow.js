"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadGenerationWorkflow = leadGenerationWorkflow;
const workflow_1 = require("@temporalio/workflow");
const deepResearchWorkflow_1 = require("./deepResearchWorkflow");
const leadGenerationDomainSearchWorkflow_1 = require("./leadGenerationDomainSearchWorkflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, validateAndCleanStuckCronStatusActivity, getSiteActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
// Import specific lead generation activities
const { callRegionSearchApiActivity, callRegionVenuesWithMultipleSearchTermsActivity, createCompaniesFromVenuesActivity, saveLeadsFromDeepResearchActivity, searchLeadsByCompanyCityActivity, updateMemoryActivity, upsertVenueFailedActivity, determineMaxVenuesActivity, notifyNewLeadsActivity, validateAndGenerateEmployeeContactsActivity, companyGenericContactGenerationActivity, createSingleLead, validateContactInformation, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes', // Longer timeout for lead generation processes
    retry: {
        maximumAttempts: 3,
    },
});
// BusinessType interface now imported from activities
/**
 * Generate deliverables structure for companies research
 * Returns structure with companies information
 */
/* COMMENTED OUT - UNUSED FUNCTION
function generateCompaniesDeliverables(): any {
  return {
    companies: [
      {
        name: null,
        website: null,
        industry: null,
        description: null,
        location: null,
        size: null,
        employees_count: null,
        founded: null,
        address: null,
        phone: null,
        email: null,
        linkedin_url: null,
        annual_revenue: null,
        business_model: null,
        products_services: [],
        key_people: [],
        social_media: {},
        _research_timestamp: new Date().toISOString(),
        _research_source: "companies_research_workflow"
      }
    ]
  };
}
*/
/**
 * Clean company data by removing noisy fields like reviews, photos, etc.
 * to avoid generating noise in deep research
 */
function cleanCompanyForDeepResearch(company) {
    // Create a new object with only the essential fields for deep research
    return {
        id: company.id, // ✅ PRESERVE company ID for lead linking
        name: company.name,
        website: company.website,
        industry: company.industry,
        description: company.description,
        location: company.location,
        address: company.address,
        phone: company.phone,
        email: company.email,
        size: company.size,
        employees_count: company.employees_count,
        google_maps_url: company.google_maps_url,
        rating: company.rating,
        total_ratings: company.total_ratings,
        business_status: company.business_status,
        coordinates: company.coordinates,
        // Exclude: reviews, photos, amenities, opening_hours, types, venue_id, _research_timestamp, _research_source
    };
}
/**
 * Extract domain from company data
 * Checks website, domain field, or constructs from company name
 * Returns null if no domain can be extracted
 */
function extractDomainFromCompany(company) {
    const getDomainFromUrl = (input) => {
        try {
            const sanitized = String(input).trim();
            return sanitized
                .replace(/^https?:\/\//i, '')
                .replace(/^www\./i, '')
                .split('/')[0]
                .split('?')[0]
                .split('#')[0];
        }
        catch {
            return '';
        }
    };
    // Priority 1: Check company.domain field
    if (company.domain && typeof company.domain === 'string' && company.domain.trim() !== '') {
        const domain = getDomainFromUrl(company.domain);
        if (domain)
            return domain;
    }
    // Priority 2: Check company.website field
    if (company.website && typeof company.website === 'string' && company.website.trim() !== '') {
        const domain = getDomainFromUrl(company.website);
        if (domain)
            return domain;
    }
    // Priority 3: Check for domain in company data (any field that might contain domain)
    if (company.web && typeof company.web === 'string' && company.web.trim() !== '') {
        const domain = getDomainFromUrl(company.web);
        if (domain)
            return domain;
    }
    // No domain found
    return null;
}
/**
 * Generate deliverables structure for employee research
 * Returns structure with employee leads including company information
 */
function generateEmployeeDeliverables(_company) {
    return {
        leads: [
            {
                // Only employee/lead personal information - NO company data
                name: "full name of the employee or decision maker",
                telephone: "direct phone number or mobile contact",
                email: "professional email address",
                position: "job title or role in the company",
                linkedin_url: "LinkedIn profile URL if available"
            },
            {
                // Second lead per company (doubled from original 1 lead)
                name: "full name of another employee or decision maker",
                telephone: "direct phone number or mobile contact",
                email: "professional email address",
                position: "job title or role in the company",
                linkedin_url: "LinkedIn profile URL if available"
            }
        ]
    };
}
/**
 * Extract companies from deep research deliverables
 */
/* COMMENTED OUT - UNUSED FUNCTION
function extractCompaniesFromDeliverables(deliverables: any): CompanyData[] {
  const companies: CompanyData[] = [];
  
  try {
    // Try companies structure first
    if (deliverables && deliverables.companies && Array.isArray(deliverables.companies)) {
      console.log(`🔍 Found companies in deliverables.companies structure`);
      for (const companyData of deliverables.companies) {
        if (companyData && typeof companyData === 'object' && companyData.name) {
          companies.push({
            name: companyData.name,
            website: companyData.website || null,
            industry: companyData.industry || null,
            description: companyData.description || null,
            location: companyData.location || companyData.address || null,
            size: companyData.size || null,
            employees_count: companyData.employees_count || null,
            ...companyData // Include all other fields
          });
        }
      }
    }
    
    // Try lead.companies structure (new structure from deep research)
    if (companies.length === 0 && deliverables && deliverables.lead && deliverables.lead.companies && Array.isArray(deliverables.lead.companies)) {
      console.log(`🔍 Found companies in deliverables.lead.companies structure`);
      for (const companyData of deliverables.lead.companies) {
        if (companyData && typeof companyData === 'object' && companyData.name) {
          companies.push({
            name: companyData.name,
            website: companyData.website || null,
            industry: companyData.industry || null,
            description: companyData.description || null,
            location: companyData.location || companyData.address || null,
            size: companyData.size || null,
            employees_count: companyData.employees_count || null,
            ...companyData // Include all other fields
          });
        }
      }
    }
    
    // Alternative structure fallbacks
    if (companies.length === 0 && deliverables && typeof deliverables === 'object') {
      console.log(`🔍 Trying alternative structures for company extraction`);
      const possibleCompanyArrays = [
        deliverables.results,
        deliverables.businesses,
        deliverables.organizations
      ];
      
      for (const possibleArray of possibleCompanyArrays) {
        if (Array.isArray(possibleArray)) {
          for (const item of possibleArray) {
            if (item && item.name) {
              companies.push({
                name: item.name,
                website: item.website || null,
                industry: item.industry || null,
                description: item.description || null,
                location: item.location || item.address || null,
                size: item.size || null,
                employees_count: item.employees_count || null,
                ...item
              });
            }
          }
          break; // Use first valid array found
        }
      }
    }
  } catch (error) {
    console.error('⚠️ Error extracting companies from deliverables:', error);
  }
  
  console.log(`📊 Extracted ${companies.length} companies from deliverables`);
  return companies;
}
*/
/**
 * Extract raw employees from deep research deliverables (no validation)
 */
function extractEmployeesFromDeliverablesRaw(deliverables) {
    const employees = [];
    try {
        // Try direct array structure first (new ultra-simplified format)
        if (deliverables && Array.isArray(deliverables)) {
            console.log(`🔍 Found leads in direct array structure (ultra-simplified format)`);
            employees.push(...deliverables);
        }
        // Try simplified leads structure (backup)
        else if (deliverables && deliverables.leads && Array.isArray(deliverables.leads)) {
            console.log(`🔍 Found leads in deliverables.leads structure (backup format)`);
            employees.push(...deliverables.leads);
        }
        // Try business.employees structure (legacy support)
        else if (deliverables && deliverables.business && deliverables.business.employees && Array.isArray(deliverables.business.employees)) {
            console.log(`🔍 Found employees in deliverables.business.employees structure (legacy)`);
            employees.push(...deliverables.business.employees);
        }
        // Try lead.employees structure (legacy support)
        else if (deliverables && deliverables.lead && deliverables.lead.employees && Array.isArray(deliverables.lead.employees)) {
            console.log(`🔍 Found employees in deliverables.lead.employees structure (legacy)`);
            employees.push(...deliverables.lead.employees);
        }
        // Try direct employees structure
        else if (deliverables && deliverables.employees && Array.isArray(deliverables.employees)) {
            console.log(`🔍 Found employees in deliverables.employees structure`);
            employees.push(...deliverables.employees);
        }
        // Alternative structure fallbacks
        else if (deliverables && typeof deliverables === 'object') {
            console.log(`🔍 Trying alternative structures for employee extraction`);
            const possibleEmployeeArrays = [
                deliverables.leads,
                deliverables.people,
                deliverables.contacts,
                deliverables.results
            ];
            for (const possibleArray of possibleEmployeeArrays) {
                if (Array.isArray(possibleArray)) {
                    employees.push(...possibleArray);
                    break; // Use first valid array found
                }
            }
        }
    }
    catch (error) {
        console.error('⚠️ Error extracting employees from deliverables:', error);
    }
    console.log(`📊 Extracted ${employees.length} raw employees from deliverables`);
    return employees;
}
/**
 * Extract the real schedule ID from workflow info
 * This looks for evidence of schedule execution in search attributes or memo
 */
function extractScheduleId(info, options) {
    // First, check if a parent schedule ID was passed through additionalData
    // This is the case when launched by dailyOperationsWorkflow
    const parentScheduleId = options.additionalData?.parentScheduleId ||
        options.additionalData?.originalScheduleId ||
        options.additionalData?.dailyOperationsScheduleId;
    if (parentScheduleId) {
        console.log(`✅ Lead Generation - Using parent schedule ID: ${parentScheduleId} (from dailyOperations)`);
        return parentScheduleId;
    }
    // Fallback: Check if workflow was triggered by its own schedule
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
        console.log(`✅ Lead Generation - Real schedule ID found: ${scheduleId}`);
        return scheduleId;
    }
    // If no schedule ID found, it might be a manual execution or child workflow
    console.log(`⚠️ Lead Generation - No schedule ID found in workflow info - likely manual execution`);
    return 'manual-execution';
}
/**
 * Workflow to execute lead generation process with optimized flow
 *
 * Este workflow sigue el flujo optimizado:
 * 1. Llama a regionSearch API para obtener business_types array
 * 2. Combina todos los business types con información geográfica
 * 3. Ejecuta UN SOLO deepResearch para encontrar empresas de todos los tipos
 * 4. Para cada empresa encontrada:
 *    - Llama leadGeneration individual con parámetros específicos de la empresa
 *    - Llama deepResearch enfocado en empleados de esa empresa
 *    - Extrae y valida leads para esa empresa
 *
 * @param options - Configuration options for lead generation
 */
async function leadGenerationWorkflow(options) {
    const { site_id, retryCount = 0, maxRetries = 3 } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    // Get workflow information from Temporal to extract schedule ID
    const workflowInfo_real = (0, workflow_1.workflowInfo)();
    const realWorkflowId = workflowInfo_real.workflowId;
    const realScheduleId = extractScheduleId(workflowInfo_real, options);
    const workflowId = `lead-generation-${site_id}`;
    const startTime = Date.now();
    // Extract scheduleId from additionalData.scheduleType (passed by scheduling activities)
    // Fallback to generic format if not provided
    const scheduleId = options.additionalData?.scheduleType || `lead-generation-${site_id}`;
    console.log(`🔥 Starting ${retryCount > 0 ? 'RETRY' : 'NEW'} lead generation workflow for site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    console.log(`📋 REAL Workflow ID: ${realWorkflowId} (from Temporal)`);
    console.log(`📋 REAL Schedule ID: ${realScheduleId} (from ${realScheduleId === 'manual-execution' ? 'manual execution' : 'schedule'})`);
    console.log(`📋 Schedule ID: ${scheduleId} (from ${options.additionalData?.scheduleType ? 'scheduleType' : 'fallback'})`);
    console.log(`🔄 Retry Info: Attempt ${retryCount + 1}/${maxRetries + 1} (${retryCount === 0 ? 'First attempt' : `Retry ${retryCount}`})`);
    // Validate and clean any stuck cron status records before execution (skip for retries)
    if (retryCount === 0) {
        console.log('🔍 Validating cron status before lead generation execution...');
        const cronValidation = await validateAndCleanStuckCronStatusActivity('leadGenerationWorkflow', site_id, 18 // 18 hours threshold - lead generation should not be stuck longer than 18h
        );
        console.log(`📋 Cron validation result: ${cronValidation.reason}`);
        if (cronValidation.wasStuck) {
            console.log(`🧹 Cleaned stuck record that was ${cronValidation.hoursStuck?.toFixed(1)}h old`);
        }
        if (!cronValidation.canProceed) {
            console.log('⏳ Another lead generation is likely running for this site - terminating');
            // Log termination
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'leadGenerationWorkflow',
                status: 'BLOCKED',
                input: options,
                error: `Workflow blocked: ${cronValidation.reason}`,
            });
            throw new Error(`Workflow blocked: ${cronValidation.reason}`);
        }
    }
    else {
        console.log('⏩ Skipping cron validation for retry workflow');
    }
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadGenerationWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: scheduleId,
        activityName: 'leadGenerationWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    let regionSearchResult = null;
    let businessTypes = [];
    let enhancedSearchTopic = '';
    let targetCity = '';
    let targetRegion = '';
    let targetCountry = '';
    let segmentId = '';
    let venuesResult = null;
    let venuesFound = [];
    let companiesCreated = [];
    const companyResults = [];
    let totalLeadsGenerated = 0;
    const leadCreationResults = [];
    let retryWorkflowStarted = false;
    let retryWorkflowId = '';
    let siteName = '';
    let siteUrl = '';
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
        console.log(`🌍 Step 2: Calling region search API...`);
        // Call region search API to get business_types array
        const regionSearchOptions = {
            site_id: site_id,
            userId: options.userId || site.user_id,
            additionalData: {
                ...options.additionalData,
                siteName: siteName,
                siteUrl: siteUrl,
                ...(options.region && { region: options.region }),
                ...(options.keywords && {
                    keywords: Array.isArray(options.keywords) ? options.keywords : [options.keywords]
                })
            }
        };
        regionSearchResult = await callRegionSearchApiActivity(regionSearchOptions);
        // Debug: Log the complete regionSearchResult
        console.log('🔍 Region search result received:', JSON.stringify(regionSearchResult, null, 2));
        if (!regionSearchResult.success) {
            const errorMsg = String(regionSearchResult.error || 'Unknown error');
            // Check for critical 414 errors that should fail the entire workflow
            if (errorMsg.includes('414') ||
                errorMsg.includes('Request-URI Too Large') ||
                errorMsg.includes('<html>') ||
                errorMsg.includes('cloudflare') ||
                errorMsg.includes('HTTP_414') ||
                errorMsg.includes('Server returned HTML error page')) {
                const criticalError = `Critical API error (414 Request-URI Too Large) in Region Search API: ${errorMsg}`;
                console.error(`🚨 CRITICAL ERROR: ${criticalError}`);
                console.error(`🛑 This error requires immediate attention and workflow termination`);
                errors.push(criticalError);
                throw new Error(criticalError);
            }
            const warningMsg = `Region search API call failed: ${errorMsg}, proceeding with generic search`;
            console.warn(`⚠️ ${warningMsg}`);
            errors.push(warningMsg);
            // Don't throw error, continue with generic search
        }
        else {
            businessTypes = regionSearchResult.business_types || [];
            targetCity = regionSearchResult.targetCity || '';
            targetRegion = regionSearchResult.targetRegion || '';
            targetCountry = regionSearchResult.data?.target_country || regionSearchResult.target_country || '';
            segmentId = regionSearchResult.target_segment_id || '';
            console.log(`✅ Region search API call successful`);
            console.log(`🔍 Business types received: ${businessTypes.length}`);
            console.log(`🏙️ Target city: "${targetCity || 'Not specified'}"`);
            console.log(`🌍 Target region: "${targetRegion || 'Not specified'}"`);
            console.log(`🌎 Target country: "${targetCountry || 'Not specified'}"`);
            console.log(`🎯 Segment ID: "${segmentId || 'Not specified'}"`);
        }
        // Step 2.5: Search for existing leads by company city to exclude them
        let excludeNames = [];
        if (targetCity) {
            console.log(`🔍 Step 2.5: Searching for existing leads in city: ${targetCity}...`);
            const searchLeadsResult = await searchLeadsByCompanyCityActivity({
                site_id: site_id,
                city: targetCity,
                // Exclude region from search as it won't match database data
                userId: options.userId || site.user_id
            });
            if (searchLeadsResult.success && searchLeadsResult.companyNames) {
                excludeNames = searchLeadsResult.companyNames;
                console.log(`✅ Found ${excludeNames.length} existing companies to exclude in ${targetCity}`);
                if (excludeNames.length > 0) {
                    console.log(`📋 Companies to exclude: ${excludeNames.join(', ')}`);
                }
            }
            else {
                const warningMsg = `Failed to search existing leads by city: ${searchLeadsResult.error}`;
                console.warn(`⚠️ ${warningMsg}`);
                errors.push(warningMsg);
            }
        }
        else {
            console.log(`⚠️ No target city available, skipping existing leads search`);
        }
        // Validate and handle empty business types
        if (!businessTypes || businessTypes.length === 0) {
            const warningMsg = 'No business types available, proceeding with generic search';
            console.warn(`⚠️ ${warningMsg}`);
            errors.push(warningMsg);
            businessTypes = []; // Ensure it's an empty array
        }
        // Create enhanced search topic combining all business types with geographic info
        let businessTypeNames = [];
        if (businessTypes && businessTypes.length > 0) {
            businessTypeNames = businessTypes.map(bt => bt.name);
            console.log(`🔍 Business type names extracted: ${businessTypeNames.join(', ')}`);
        }
        else {
            // Use generic search if no business types available
            businessTypeNames = ['companies', 'businesses', 'enterprises'];
            console.log(`🔍 Using generic business type names: ${businessTypeNames.join(', ')}`);
        }
        const geographicInfo = [];
        if (targetCity) {
            geographicInfo.push(targetCity);
        }
        if (targetRegion) {
            geographicInfo.push(targetRegion);
        }
        if (targetCountry) {
            geographicInfo.push(targetCountry);
        }
        enhancedSearchTopic = geographicInfo.length > 0
            ? `${businessTypeNames.join(', ')} in ${geographicInfo.join(', ')}`
            : businessTypeNames.join(', ');
        console.log(`🔍 Enhanced search topic: "${enhancedSearchTopic}"`);
        // Step 2b: Determine maximum venues based on billing plan
        console.log(`🔢 Determining venue limits based on billing plan...`);
        const maxVenuesResult = await determineMaxVenuesActivity({
            site_id: site_id,
            userId: options.userId || site.user_id
        });
        // DEBUG: Force maxVenues to 1 for debugging purposes
        let maxVenues = 1; // Forced to 1 for debugging
        console.log(`🐛 DEBUG: Forcing maxVenues to 1 for debugging (API returned: ${maxVenuesResult.success && maxVenuesResult.maxVenues ? maxVenuesResult.maxVenues : 'N/A'})`);
        // Original logic (commented for debugging):
        // if (maxVenuesResult.success && maxVenuesResult.maxVenues) {
        //   maxVenues = maxVenuesResult.maxVenues;
        //   console.log(`✅ Venue limits determined: ${maxVenues} venues (Plan: ${maxVenuesResult.plan}, Channels: ${maxVenuesResult.hasChannels ? 'Yes' : 'No'})`);
        // } else {
        //   console.log(`⚠️ Failed to determine venue limits, using default: ${maxVenues} venues. Error: ${maxVenuesResult.error}`);
        // }
        // Call region venues API with multiple search terms strategy
        try {
            console.log(`🌍 Using geographic location: ${targetCity || 'No city'}, ${targetRegion || 'No region'}, ${targetCountry || 'No country'}`);
            console.log(`🐛 Debug workflow businessTypes before passing:`, JSON.stringify(businessTypes, null, 2));
            console.log(`🐛 Debug workflow targetCity: "${targetCity}"`);
            console.log(`🐛 Debug workflow targetRegion: "${targetRegion}"`);
            console.log(`🐛 Debug workflow targetCountry: "${targetCountry}"`);
            const regionVenuesMultipleOptions = {
                site_id: site_id,
                userId: options.userId || site.user_id,
                businessTypes: businessTypes, // Pasar array de business types para búsquedas individuales
                city: targetCity || '',
                region: targetRegion || '',
                country: targetCountry || undefined, // Usar el país del regionSearch
                maxVenues: maxVenues, // ✅ Use dynamically determined venue limit
                targetVenueGoal: maxVenues, // Objetivo de venues a alcanzar
                priority: 'high',
                excludeNames: excludeNames, // Exclude companies that already have leads
                additionalData: {
                    ...options.additionalData,
                    regionSearchResult: regionSearchResult,
                    businessTypes: businessTypes,
                    enhancedSearchTopic: enhancedSearchTopic,
                    siteName: siteName,
                    siteUrl: siteUrl,
                    billingPlan: maxVenuesResult.plan, // Include billing plan info
                    hasChannels: maxVenuesResult.hasChannels // Include channel info
                }
            };
            console.log(`🐛 Debug regionVenuesMultipleOptions:`, JSON.stringify(regionVenuesMultipleOptions, null, 2));
            console.log(`🔍 Using multiple search terms strategy with ${businessTypes.length} business types (city + region + country)`);
            venuesResult = await callRegionVenuesWithMultipleSearchTermsActivity(regionVenuesMultipleOptions);
            if (!venuesResult.success) {
                const errorMsg = String(venuesResult.error || 'Unknown error');
                // Check for critical 414 errors that should fail the entire workflow
                if (errorMsg.includes('414') ||
                    errorMsg.includes('Request-URI Too Large') ||
                    errorMsg.includes('<html>') ||
                    errorMsg.includes('cloudflare') ||
                    errorMsg.includes('HTTP_414') ||
                    errorMsg.includes('Server returned HTML error page')) {
                    const criticalError = `Critical API error (414 Request-URI Too Large) in Region Venues API: ${errorMsg}`;
                    console.error(`🚨 CRITICAL ERROR: ${criticalError}`);
                    console.error(`🛑 This error requires immediate attention and workflow termination`);
                    errors.push(criticalError);
                    throw new Error(criticalError);
                }
                const normalErrorMsg = `Region venues API call failed: ${errorMsg}`;
                console.error(`❌ ${normalErrorMsg}`);
                errors.push(normalErrorMsg);
                // Continue to handle this as a normal error
            }
            if (venuesResult.success && venuesResult.data && venuesResult.data.venues) {
                venuesFound = venuesResult.data.venues;
                // Step 3a: Create companies from venues
                if (venuesFound.length > 0) {
                    const companiesCreateResult = await createCompaniesFromVenuesActivity({
                        site_id: site_id,
                        venues: venuesFound,
                        userId: options.userId || site.user_id,
                        targetCity: targetCity, // ✅ Pass target_city for address parsing and company.city field
                        additionalData: {
                            ...options.additionalData,
                            venuesResult: venuesResult,
                            businessTypes: businessTypes,
                            workflowId: workflowId
                        }
                    });
                    if (companiesCreateResult.success) {
                        companiesCreated = companiesCreateResult.companies || [];
                        console.log(`✅ Companies created successfully - ${companiesCreated.length} companies`);
                        // DEBUG: Limit to only 1 company for debugging
                        const companiesToProcess = companiesCreated.slice(0, 1);
                        console.log(`🐛 DEBUG: Limiting iteration to 1 company for debugging (total companies: ${companiesCreated.length})`);
                        // Step 4: For each company, generate leads
                        if (companiesToProcess.length > 0) {
                            console.log(`👥 Step 4: Processing ${companiesToProcess.length} company(ies) for lead generation (DEBUG: limited to 1)...`);
                            for (let i = 0; i < companiesToProcess.length; i++) {
                                const company = companiesToProcess[i];
                                console.log(`🏢 Processing company ${i + 1}/${companiesToProcess.length}: ${company.name}`);
                                const companyResult = {
                                    company: company,
                                    errors: []
                                };
                                try {
                                    // Step 4: New flow - Check for domain and use Finder API or deep research
                                    console.log(`👥 Step 4: Processing company ${company.name} for lead generation...`);
                                    // Step 4b.1: Extract domain from company
                                    let companyDomain = extractDomainFromCompany(company);
                                    let domainFoundViaDeepResearch = false;
                                    if (companyDomain) {
                                        console.log(`✅ Company ${company.name} has domain: ${companyDomain}`);
                                    }
                                    else {
                                        console.log(`⚠️ Company ${company.name} has no domain, searching for domain using deep research...`);
                                        // Step 4b.1a: Use deep research to find domain
                                        const locationInfo = [];
                                        try {
                                            if (company.address) {
                                                const addressString = typeof company.address === 'string'
                                                    ? company.address
                                                    : `${company.address.street || ''} ${company.address.city || ''} ${company.address.state || ''}`.trim();
                                                if (addressString) {
                                                    locationInfo.push(addressString);
                                                }
                                            }
                                            if (targetCity)
                                                locationInfo.push(targetCity);
                                            if (targetRegion)
                                                locationInfo.push(targetRegion);
                                        }
                                        catch { }
                                        const locationContext = locationInfo.length > 0 ? ` located at ${locationInfo.join(', ')}` : '';
                                        const domainSearchTopic = `Find the official website domain for ${company.name}${locationContext}. Return only the website URL and domain name.`;
                                        const domainResearchDeliverables = {
                                            website: "official company website URL",
                                            domain: "extracted domain name (e.g., example.com)"
                                        };
                                        const domainResearchOptions = {
                                            site_id: site_id,
                                            research_topic: domainSearchTopic,
                                            userId: options.userId || site.user_id,
                                            deliverables: domainResearchDeliverables,
                                            scheduleId: realScheduleId,
                                            parentWorkflowType: 'leadGenerationWorkflow',
                                            additionalData: {
                                                ...options.additionalData,
                                                company: cleanCompanyForDeepResearch(company),
                                                businessTypes: businessTypes,
                                                researchContext: 'domain_discovery_workflow',
                                                siteName: siteName,
                                                siteUrl: siteUrl
                                            }
                                        };
                                        const domainResearchHandle = await (0, workflow_1.startChild)(deepResearchWorkflow_1.deepResearchWorkflow, {
                                            args: [domainResearchOptions],
                                            workflowId: `domain-research-${company.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`,
                                            parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                                        });
                                        const domainResearchResult = await domainResearchHandle.result();
                                        if (domainResearchResult.success && domainResearchResult.data?.deliverables) {
                                            const deliverables = domainResearchResult.data.deliverables;
                                            // Try to extract domain from deliverables
                                            if (deliverables.domain && typeof deliverables.domain === 'string') {
                                                companyDomain = deliverables.domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split('?')[0].split('#')[0];
                                            }
                                            else if (deliverables.website && typeof deliverables.website === 'string') {
                                                companyDomain = deliverables.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split('?')[0].split('#')[0];
                                            }
                                            if (companyDomain) {
                                                domainFoundViaDeepResearch = true;
                                                console.log(`✅ Domain found via deep research: ${companyDomain}`);
                                            }
                                            else {
                                                console.log(`⚠️ Deep research completed but no domain extracted from deliverables`);
                                            }
                                        }
                                        else {
                                            console.log(`⚠️ Deep research for domain failed: ${domainResearchResult.error || 'Unknown error'}`);
                                        }
                                    }
                                    // Step 4b.2: If we have a domain, use Finder API to search for persons
                                    if (companyDomain) {
                                        console.log(`🔍 Step 4b.2: Searching for persons using Finder API with domain: ${companyDomain}`);
                                        const domainSearchOptions = {
                                            domains: [companyDomain],
                                            page: 0,
                                            page_size: 10,
                                            site_id: site_id,
                                            userId: options.userId || site.user_id,
                                            company: cleanCompanyForDeepResearch(company),
                                            segmentId: segmentId,
                                        };
                                        const domainSearchHandle = await (0, workflow_1.startChild)(leadGenerationDomainSearchWorkflow_1.leadGenerationDomainSearchWorkflow, {
                                            args: [domainSearchOptions],
                                            workflowId: `domain-search-${company.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`,
                                            parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                                        });
                                        const domainSearchResult = await domainSearchHandle.result();
                                        companyResult.employeeResearchResult = domainSearchResult; // Keep for compatibility
                                        let companyLeadsGenerated = 0; // Track leads for this specific company
                                        if (domainSearchResult.success && domainSearchResult.foundMatches > 0) {
                                            console.log(`✅ Found ${domainSearchResult.foundMatches} persons via Finder API for ${company.name}`);
                                            console.log(`📊 Leads created: ${domainSearchResult.leadsCreated.length}`);
                                            companyLeadsGenerated = domainSearchResult.foundMatches;
                                            totalLeadsGenerated += domainSearchResult.foundMatches;
                                            // Update memory if leads were created
                                            if (domainSearchResult.foundMatches > 0 && targetCity && targetRegion) {
                                                console.log(`🧠 Updating agent memory with ${domainSearchResult.foundMatches} leads...`);
                                                const updateMemoryResult = await updateMemoryActivity({
                                                    siteId: site_id,
                                                    city: targetCity,
                                                    region: targetRegion,
                                                    segmentId: segmentId,
                                                    leadsCount: domainSearchResult.foundMatches
                                                });
                                                if (updateMemoryResult.success) {
                                                    console.log(`✅ Agent memory successfully updated for ${company.name}`);
                                                }
                                                else {
                                                    const warningMsg = `Failed to update agent memory for ${company.name}: ${updateMemoryResult.error}`;
                                                    console.warn(`⚠️ ${warningMsg}`);
                                                }
                                            }
                                        }
                                        else {
                                            console.log(`⚠️ No persons found via Finder API for ${company.name}, generating generic admin contact...`);
                                            // Step 4b.3: Generate generic admin contact when no persons found
                                            if (company.phone) {
                                                console.log(`📞 Step 4b.3: Generating generic admin contact with phone: ${company.phone}`);
                                                const context = `Company: ${company.name}\nPhone: ${company.phone}\nContext: Lead generation generic admin contact for local business without found employees`;
                                                const genericContactResult = await companyGenericContactGenerationActivity({
                                                    domain: companyDomain,
                                                    context: context,
                                                    site_id: site_id
                                                });
                                                if (genericContactResult.success && genericContactResult.emailAnalysisData) {
                                                    const adminName = genericContactResult.emailAnalysisData.contact_name || 'Admin';
                                                    const generatedEmails = genericContactResult.email_generation_analysis || [];
                                                    if (generatedEmails.length > 0) {
                                                        console.log(`📧 Validating ${generatedEmails.length} generated emails for generic admin contact...`);
                                                        // Validate emails - find first valid email
                                                        let validatedEmail = null;
                                                        for (const email of generatedEmails) {
                                                            const val = await validateContactInformation({
                                                                email,
                                                                hasEmailMessage: true,
                                                                hasWhatsAppMessage: false
                                                            });
                                                            if (val.success && val.isValid) {
                                                                validatedEmail = email;
                                                                console.log(`✅ Valid email found: ${email}`);
                                                                break;
                                                            }
                                                            else {
                                                                console.log(`❌ Email validation failed for ${email}: ${val.reason || 'Invalid'}`);
                                                            }
                                                        }
                                                        if (validatedEmail) {
                                                            console.log(`✅ Generated and validated generic admin contact: ${adminName} <${validatedEmail}>`);
                                                            // Create lead with generic admin contact
                                                            try {
                                                                const leadData = {
                                                                    name: adminName,
                                                                    email: validatedEmail,
                                                                    company_name: company.name,
                                                                    position: 'Admin',
                                                                    telephone: company.phone,
                                                                    web: company.website || null,
                                                                    address: company.address || (targetCity ? { city: targetCity, region: targetRegion } : {}),
                                                                    company: {
                                                                        name: company.name,
                                                                        website: company.website || null,
                                                                        domain: companyDomain,
                                                                        industry: company.industry || null,
                                                                        size: company.size || null,
                                                                        description: company.description || null,
                                                                    },
                                                                    notes: 'generic contact lead for initial conversation',
                                                                    metadata: {
                                                                        source: 'lead_generation_generic_admin_contact',
                                                                        generated_via: 'companyGenericContactGeneration',
                                                                        company_phone: company.phone,
                                                                        domain: companyDomain,
                                                                    },
                                                                };
                                                                const leadResult = await createSingleLead(leadData, site_id, options.userId || site.user_id, company.id, segmentId);
                                                                if (leadResult.success && leadResult.leadId) {
                                                                    console.log(`✅ Created generic admin lead: ${leadResult.leadId}`);
                                                                    companyLeadsGenerated = 1;
                                                                    totalLeadsGenerated += 1;
                                                                    // Update memory
                                                                    if (targetCity && targetRegion) {
                                                                        const updateMemoryResult = await updateMemoryActivity({
                                                                            siteId: site_id,
                                                                            city: targetCity,
                                                                            region: targetRegion,
                                                                            segmentId: segmentId,
                                                                            leadsCount: 1
                                                                        });
                                                                        if (updateMemoryResult.success) {
                                                                            console.log(`✅ Agent memory updated for generic admin contact`);
                                                                        }
                                                                    }
                                                                }
                                                                else {
                                                                    console.error(`❌ Failed to create generic admin lead: ${leadResult.error}`);
                                                                }
                                                            }
                                                            catch (leadError) {
                                                                const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
                                                                console.error(`❌ Exception creating generic admin lead: ${errorMessage}`);
                                                                companyResult.errors.push(`Generic admin lead creation failed: ${errorMessage}`);
                                                            }
                                                        }
                                                        else {
                                                            console.log(`⚠️ No valid emails found after validation for generic admin contact (${generatedEmails.length} emails generated, all invalid)`);
                                                        }
                                                    }
                                                    else {
                                                        console.log(`⚠️ No emails generated for generic admin contact`);
                                                    }
                                                }
                                                else {
                                                    console.error(`❌ Generic contact generation failed: ${genericContactResult.error}`);
                                                    companyResult.errors.push(`Generic contact generation failed: ${genericContactResult.error}`);
                                                }
                                            }
                                            else {
                                                console.log(`⚠️ No phone number available for generic admin contact generation`);
                                            }
                                            // Save venue as failed if no leads generated for this company
                                            if (companyLeadsGenerated === 0) {
                                                console.log(`📝 No leads generated for ${company.name}, saving venue as failed...`);
                                                const upsertResult = await upsertVenueFailedActivity({
                                                    site_id: site_id,
                                                    city: targetCity,
                                                    region: targetRegion,
                                                    venueName: company.name,
                                                    userId: options.userId || site.user_id
                                                });
                                                if (upsertResult.success) {
                                                    console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        // No domain found - skip this company
                                        console.log(`⚠️ No domain found for ${company.name} (neither existing nor via deep research), skipping company...`);
                                        const upsertResult = await upsertVenueFailedActivity({
                                            site_id: site_id,
                                            city: targetCity,
                                            region: targetRegion,
                                            venueName: company.name,
                                            userId: options.userId || site.user_id
                                        });
                                        if (upsertResult.success) {
                                            console.log(`✅ Successfully saved failed venue ${company.name} to system_memories (no domain)`);
                                        }
                                    }
                                }
                                catch (companyError) {
                                    const errorMessage = companyError instanceof Error ? companyError.message : String(companyError);
                                    console.error(`❌ Error processing company ${company.name}: ${errorMessage}`);
                                    companyResult.errors.push(errorMessage);
                                    // Step 4b.4: Company processing failed, save venue as failed in system_memories
                                    console.log(`📝 Step 4b.4: Company processing failed for ${company.name}, saving venue as failed...`);
                                    const upsertResult = await upsertVenueFailedActivity({
                                        site_id: site_id,
                                        city: targetCity,
                                        region: targetRegion,
                                        venueName: company.name,
                                        userId: options.userId || site.user_id
                                    });
                                    if (upsertResult.success) {
                                        console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                                    }
                                    else {
                                        const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                                        console.warn(`⚠️ ${warningMsg}`);
                                        // Don't add to errors since this is not critical for the main workflow
                                    }
                                }
                                companyResults.push(companyResult);
                                console.log(`📊 Completed processing company ${i + 1}/${companiesToProcess.length}: ${company.name}`);
                            }
                        }
                        else {
                            console.log(`⚠️ No companies processed for lead generation`);
                        }
                    }
                    else {
                        const errorMsg = `Companies creation failed: ${companiesCreateResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        errors.push(errorMsg);
                    }
                }
                else {
                    console.log(`⚠️ No venues found from region venues API`);
                }
            }
            else {
                const errorMsg = `Region venues API call failed: ${venuesResult.error}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        catch (venuesError) {
            const errorMessage = venuesError instanceof Error ? venuesError.message : String(venuesError);
            console.error(`❌ Exception in region venues processing: ${errorMessage}`);
            errors.push(`Region venues API error: ${errorMessage}`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId: site_id,
            siteName,
            siteUrl,
            regionSearchResult,
            businessTypes,
            enhancedSearchTopic,
            targetCity,
            targetRegion,
            venuesResult,
            venuesFound,
            companiesCreated,
            companyResults,
            totalLeadsGenerated,
            leadCreationResults,
            retryWorkflowStarted,
            retryWorkflowId: retryWorkflowStarted ? retryWorkflowId : undefined,
            retryInfo: {
                currentAttempt: retryCount + 1,
                maxRetries: maxRetries,
                isRetry: retryCount > 0,
                canRetry: retryCount < maxRetries
            },
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 ${retryCount > 0 ? 'RETRY' : 'NEW'} Lead generation workflow completed successfully!`);
        console.log(`📊 Summary: Lead generation for site ${siteName} completed in ${executionTime}`);
        console.log(`   - Site: ${siteName} (${siteUrl})`);
        console.log(`   - Retry Info: Attempt ${retryCount + 1}/${maxRetries + 1} (${retryCount === 0 ? 'First attempt' : `Retry ${retryCount}`})`);
        console.log(`   - Business types received: ${businessTypes.length}`);
        console.log(`   - Enhanced search topic: ${enhancedSearchTopic}`);
        console.log(`   - Target location: ${targetCity && targetRegion ? `${targetCity}, ${targetRegion}` : targetCity || targetRegion || 'Not specified'}`);
        console.log(`   - Companies created: ${companiesCreated.length}`);
        console.log(`   - Companies processed: ${companyResults.length}`);
        console.log(`   - Total leads generated: ${totalLeadsGenerated}`);
        console.log(`   - Lead creation results: ${leadCreationResults.length}`);
        if (retryWorkflowStarted) {
            console.log(`   - Next retry workflow started: ${retryWorkflowId} (attempt ${retryCount + 2}/${maxRetries + 1})`);
        }
        else if (totalLeadsGenerated === 0 && retryCount >= maxRetries) {
            console.log(`   - No more retries: Maximum attempts (${maxRetries + 1}) reached`);
        }
        // Step Final: Send notification for all leads generated in this workflow
        if (totalLeadsGenerated > 0) {
            console.log(`📢 Step Final: Sending notification for ${totalLeadsGenerated} leads generated...`);
            // Collect all successfully created lead names from company results
            const allLeadNames = [];
            for (const companyResult of companyResults) {
                if (companyResult.leadsGenerated && Array.isArray(companyResult.leadsGenerated)) {
                    for (const lead of companyResult.leadsGenerated) {
                        if (lead.name) {
                            allLeadNames.push(lead.name);
                        }
                    }
                }
            }
            if (allLeadNames.length > 0) {
                try {
                    const notificationResult = await notifyNewLeadsActivity({
                        site_id: site_id,
                        leadNames: allLeadNames,
                        userId: options.userId || site.user_id,
                        additionalData: {
                            source: 'lead_generation_workflow',
                            workflowStep: 'workflow_completion_notification',
                            siteName: siteName,
                            siteUrl: siteUrl,
                            targetCity: targetCity,
                            targetRegion: targetRegion,
                            businessTypes: businessTypes,
                            companiesProcessed: companyResults.length,
                            executionTime: executionTime,
                            workflowId: workflowId
                        }
                    });
                    if (notificationResult.success) {
                        console.log(`✅ Successfully sent notification for ${allLeadNames.length} leads: ${allLeadNames.join(', ')}`);
                    }
                    else {
                        console.error(`❌ Failed to send notification: ${notificationResult.error}`);
                        errors.push(`Notification failed: ${notificationResult.error}`);
                    }
                }
                catch (notificationError) {
                    const errorMessage = notificationError instanceof Error ? notificationError.message : String(notificationError);
                    console.error(`❌ Exception sending notification: ${errorMessage}`);
                    errors.push(`Notification exception: ${errorMessage}`);
                }
            }
            else {
                console.log(`⚠️ No lead names found for notification despite ${totalLeadsGenerated} leads generated`);
            }
        }
        else {
            console.log(`ℹ️ No leads generated, checking retry eligibility...`);
            // Check if we can retry (haven't exceeded max retries)
            if (retryCount < maxRetries) {
                console.log(`🔄 Step Retry: Starting retry ${retryCount + 1}/${maxRetries} for site ${site_id} (no leads found)...`);
                // Step Retry: If no valid leads found and retries available, start a new workflow execution
                try {
                    const retryOptions = {
                        ...options,
                        retryCount: retryCount + 1,
                        maxRetries: maxRetries,
                        additionalData: {
                            ...options.additionalData,
                            retryReason: 'no_leads_found',
                            originalWorkflowId: workflowId,
                            originalExecutionTime: executionTime,
                            retriedAt: new Date().toISOString(),
                            previousRetryCount: retryCount
                        }
                    };
                    const retryWorkflowHandle = await (0, workflow_1.startChild)(leadGenerationWorkflow, {
                        args: [retryOptions],
                        workflowId: `lead-generation-retry-${site_id}-${retryCount + 1}-${Date.now()}`,
                        parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON, // ✅ Child continues independently
                    });
                    retryWorkflowStarted = true;
                    retryWorkflowId = retryWorkflowHandle.workflowId;
                    console.log(`✅ Successfully started retry workflow ${retryCount + 1}/${maxRetries}: ${retryWorkflowHandle.workflowId}`);
                    // Don't await the result to avoid blocking this workflow completion
                    // The retry workflow will run independently
                }
                catch (retryError) {
                    const errorMessage = retryError instanceof Error ? retryError.message : String(retryError);
                    console.error(`❌ Failed to start retry workflow: ${errorMessage}`);
                    errors.push(`Retry workflow failed: ${errorMessage}`);
                }
            }
            else {
                console.log(`🛑 Maximum retries (${maxRetries}) reached for site ${site_id}. No more retry attempts will be made.`);
                console.log(`📊 Final result: No leads generated after ${retryCount + 1} attempts (1 initial + ${retryCount} retries)`);
                errors.push(`Maximum retries reached: ${retryCount + 1} attempts completed without generating leads`);
                // Update cron status to indicate retry limit reached
                await saveCronStatusActivity({
                    siteId: site_id,
                    workflowId,
                    scheduleId: scheduleId,
                    activityName: 'leadGenerationWorkflow',
                    status: 'FAILED',
                    lastRun: new Date().toISOString(),
                    errorMessage: `Maximum retries (${maxRetries}) reached - no leads generated after ${retryCount + 1} attempts`,
                    retryCount: retryCount + 1
                });
            }
        }
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: scheduleId,
            activityName: 'leadGenerationWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadGenerationWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ NEW Lead generation workflow failed: ${errorMessage}`);
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: scheduleId,
            activityName: 'leadGenerationWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: retryCount + 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadGenerationWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Throw error to properly fail the workflow
        throw new Error(`Lead generation workflow failed: ${errorMessage}`);
    }
}
