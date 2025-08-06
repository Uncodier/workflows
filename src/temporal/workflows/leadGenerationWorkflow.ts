import { proxyActivities, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { deepResearchWorkflow, type DeepResearchOptions } from './deepResearchWorkflow';
import type { 
  LeadGenerationApiOptions,
  LeadData,
  RegionSearchApiOptions,
  RegionVenuesMultipleSearchOptions,
  VenueData,
  BusinessType
} from '../activities/leadGenerationActivities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

// Import specific lead generation activities
const {
  callRegionSearchApiActivity,
  callRegionVenuesWithMultipleSearchTermsActivity,
  callLeadGenerationApiActivity,
  createCompaniesFromVenuesActivity,
  saveLeadsFromDeepResearchActivity,
  searchLeadsByCompanyCityActivity,
  updateMemoryActivity,
  upsertVenueFailedActivity,
  determineMaxVenuesActivity,
  notifyNewLeadsActivity,
} = proxyActivities<{
  callRegionSearchApiActivity: (options: RegionSearchApiOptions) => Promise<any>;
  callRegionVenuesWithMultipleSearchTermsActivity: (options: RegionVenuesMultipleSearchOptions) => Promise<any>;
  callLeadGenerationApiActivity: (options: LeadGenerationApiOptions) => Promise<any>;
  createCompaniesFromVenuesActivity: (options: any) => Promise<any>;
  saveLeadsFromDeepResearchActivity: (options: any) => Promise<any>;
  searchLeadsByCompanyCityActivity: (options: { site_id: string; city: string; region?: string; userId?: string }) => Promise<{ success: boolean; companyNames?: string[]; error?: string }>;
  updateMemoryActivity: (options: { siteId: string; city: string; region: string; segmentId?: string; leadsCount: number }) => Promise<{ success: boolean; error?: string }>;
  upsertVenueFailedActivity: (options: { site_id: string; city: string; region?: string; venueName: string; userId?: string }) => Promise<{ success: boolean; error?: string }>;
  determineMaxVenuesActivity: (options: { site_id: string; userId?: string }) => Promise<{ success: boolean; maxVenues?: number; plan?: string; hasChannels?: boolean; error?: string }>;
  notifyNewLeadsActivity: (options: { site_id: string; leadNames: string[]; userId?: string; additionalData?: any }) => Promise<{ success: boolean; error?: string }>;
}>({
  startToCloseTimeout: '10 minutes', // Longer timeout for lead generation processes
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadGenerationOptions {
  site_id: string;                    // Required: Site ID
  userId?: string;
  create?: boolean;                   // Default true to create leads, set false for validation only
  region?: string;                    // Optional: Override region for regionSearch (e.g., "world" for strategic accounts)
  keywords?: string | string[];       // Optional: Override keywords for regionSearch (e.g., "key accounts" or ["key", "accounts"])
  additionalData?: any;
}

export interface CompanyData {
  name: string;
  website?: string;
  industry?: string;
  description?: string;
  location?: string;
  size?: string;
  employees_count?: number;
  [key: string]: any;
}

export interface LeadGenerationResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  regionSearchResult?: any;          // Result from region search API
  businessTypes?: BusinessType[];    // Business types from region search
  enhancedSearchTopic?: string;      // Combined search topic with geographic info
  targetCity?: string;               // Target city from region search
  targetRegion?: string;             // Target region from region search
  venuesResult?: any;                // Result from region venues API
  venuesFound?: VenueData[];         // Venues found from region venues API
  companiesCreated?: CompanyData[];  // Companies created from venues
  companyResults?: Array<{           // Results per company
    company: CompanyData;
    leadGenerationResult?: any;
    employeeResearchResult?: any;
    leadsGenerated?: LeadData[];
    errors?: string[];
  }>;
  totalLeadsGenerated?: number;
  leadCreationResults?: any[];       // Results from lead creation/validation
  retryWorkflowStarted?: boolean;    // Whether a retry workflow was started
  retryWorkflowId?: string;          // ID of the retry workflow if started
  errors: string[];
  executionTime: string;
  completedAt: string;
}

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
function cleanCompanyForDeepResearch(company: CompanyData): any {
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
 * Generate deliverables structure for employee research
 * Returns structure with employee leads including company information
 */
function generateEmployeeDeliverables(_company: CompanyData): any {
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
 * Normalize name for duplicate detection
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Validate if telephone is obfuscated with asterisks
 */
function isPhoneObfuscated(phone: string | null): boolean {
  if (!phone) return false;
  // Check if phone contains asterisks or is mostly asterisks
  return phone.includes('*') || phone.includes('***') || /^\*+$/.test(phone.trim());
}

/**
 * Validate if email is obfuscated with asterisks
 */
function isEmailObfuscated(email: string | null): boolean {
  if (!email) return false;
  // Check if email contains asterisks in the local part (before @)
  // Examples: c******@domain.com, john***@example.com, ***@domain.com
  return email.includes('*') && email.includes('@');
}

/**
 * Extract employees from deep research deliverables with validation
 */
function extractEmployeesFromDeliverables(deliverables: any): LeadData[] {
  const employees: LeadData[] = [];
  const seenNames = new Set<string>(); // Track processed names to avoid duplicates
  let duplicatesSkipped = 0;
  let obfuscatedPhonesSkipped = 0;
  let obfuscatedEmailsSkipped = 0;
  
  /**
   * Validate and add employee if valid
   */
  function validateAndAddEmployee(leadData: any, businessData?: any): void {
    if (!leadData || typeof leadData !== 'object' || !leadData.name) {
      return;
    }

    const normalizedName = normalizeName(leadData.name);
    
    // Validation 1: Check for duplicate names
    if (seenNames.has(normalizedName)) {
      console.log(`🔄 Skipping duplicate lead: ${leadData.name}`);
      duplicatesSkipped++;
      return;
    }

    const telephone = leadData.telephone || leadData.phone || null;
    const email = leadData.email || null;
    
    // Validation 2: Check for obfuscated phone numbers
    if (telephone && isPhoneObfuscated(telephone)) {
      console.log(`📞 Skipping lead with obfuscated phone: ${leadData.name} (${telephone})`);
      obfuscatedPhonesSkipped++;
      return;
    }

    // Validation 3: Check for obfuscated email addresses
    if (email && isEmailObfuscated(email)) {
      console.log(`📧 Skipping lead with obfuscated email: ${leadData.name} (${email})`);
      obfuscatedEmailsSkipped++;
      return;
    }

    // All validations passed, add the lead
    seenNames.add(normalizedName);
    employees.push({
      name: leadData.name,
      telephone: telephone,
      email: email,
      company_name: businessData?.name || leadData.company?.name || leadData.company_name || undefined,
      address: leadData.address || businessData?.location || businessData?.address || null,
      web: businessData?.website || leadData.company?.website || leadData.web || null,
      position: leadData.position || leadData.job_title || null
    });
  }
  
  try {
    // Try direct array structure first (new ultra-simplified format)
    if (deliverables && Array.isArray(deliverables)) {
      console.log(`🔍 Found leads in direct array structure (ultra-simplified format)`);
      for (const leadData of deliverables) {
        validateAndAddEmployee(leadData);
      }
    }
    // Try simplified leads structure (backup)
    else if (deliverables && deliverables.leads && Array.isArray(deliverables.leads)) {
      console.log(`🔍 Found leads in deliverables.leads structure (backup format)`);
      for (const leadData of deliverables.leads) {
        validateAndAddEmployee(leadData);
      }
    }
    // Try business.employees structure (legacy support)
    else if (deliverables && deliverables.business && deliverables.business.employees && Array.isArray(deliverables.business.employees)) {
      console.log(`🔍 Found employees in deliverables.business.employees structure (legacy)`);
      const business = deliverables.business;
      for (const employeeData of deliverables.business.employees) {
        validateAndAddEmployee(employeeData, business);
      }
    }
    // Try lead.employees structure (legacy support)
    else if (deliverables && deliverables.lead && deliverables.lead.employees && Array.isArray(deliverables.lead.employees)) {
      console.log(`🔍 Found employees in deliverables.lead.employees structure (legacy)`);
      for (const employeeData of deliverables.lead.employees) {
        validateAndAddEmployee(employeeData);
      }
    }
    // Try direct employees structure
    else if (deliverables && deliverables.employees && Array.isArray(deliverables.employees)) {
      console.log(`🔍 Found employees in deliverables.employees structure`);
      for (const employeeData of deliverables.employees) {
        validateAndAddEmployee(employeeData);
      }
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
          for (const item of possibleArray) {
            validateAndAddEmployee(item);
          }
          break; // Use first valid array found
        }
      }
    }
  } catch (error) {
    console.error('⚠️ Error extracting employees from deliverables:', error);
  }
  
  console.log(`📊 Extracted ${employees.length} valid employees from deliverables`);
  if (duplicatesSkipped > 0) {
    console.log(`🔄 Skipped ${duplicatesSkipped} duplicate leads by name`);
  }
  if (obfuscatedPhonesSkipped > 0) {
    console.log(`📞 Skipped ${obfuscatedPhonesSkipped} leads with obfuscated phone numbers`);
  }
  if (obfuscatedEmailsSkipped > 0) {
    console.log(`📧 Skipped ${obfuscatedEmailsSkipped} leads with obfuscated email addresses`);
  }
  
  return employees;
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
export async function leadGenerationWorkflow(
  options: LeadGenerationOptions
): Promise<LeadGenerationResult> {
  const { site_id } = options;
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `lead-generation-${site_id}`;
  const startTime = Date.now();
  
  // Extract scheduleId from additionalData.scheduleType (passed by scheduling activities)
  // Fallback to generic format if not provided
  const scheduleId = options.additionalData?.scheduleType || `lead-generation-${site_id}`;
  
  console.log(`🔥 Starting NEW lead generation workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));
  console.log(`📋 Schedule ID: ${scheduleId} (from ${options.additionalData?.scheduleType ? 'scheduleType' : 'fallback'})`);

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

  const errors: string[] = [];
  let regionSearchResult: any = null;
  let businessTypes: BusinessType[] = [];
  let enhancedSearchTopic = '';
  let targetCity = '';
  let targetRegion = '';
  let targetCountry = '';
  let segmentId = '';
  let venuesResult: any = null;
  let venuesFound: VenueData[] = [];
  let companiesCreated: CompanyData[] = [];
  const companyResults: any[] = [];
  let totalLeadsGenerated = 0;
  const leadCreationResults: any[] = [];
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
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    console.log(`🌍 Step 2: Calling region search API...`);
    
    // Call region search API to get business_types array
    const regionSearchOptions: RegionSearchApiOptions = {
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
      const warningMsg = `Region search API call failed: ${regionSearchResult.error}, proceeding with generic search`;
      console.warn(`⚠️ ${warningMsg}`);
      errors.push(warningMsg);
      // Don't throw error, continue with generic search
    } else {
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
    let excludeNames: string[] = [];
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
      } else {
        const warningMsg = `Failed to search existing leads by city: ${searchLeadsResult.error}`;
        console.warn(`⚠️ ${warningMsg}`);
        errors.push(warningMsg);
      }
    } else {
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
    } else {
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

    let maxVenues = 1; // Default fallback
    if (maxVenuesResult.success && maxVenuesResult.maxVenues) {
      maxVenues = maxVenuesResult.maxVenues;
      console.log(`✅ Venue limits determined: ${maxVenues} venues (Plan: ${maxVenuesResult.plan}, Channels: ${maxVenuesResult.hasChannels ? 'Yes' : 'No'})`);
    } else {
      console.log(`⚠️ Failed to determine venue limits, using default: ${maxVenues} venues. Error: ${maxVenuesResult.error}`);
    }
    
    // Call region venues API with multiple search terms strategy
    try {
      console.log(`🌍 Using geographic location: ${targetCity || 'No city'}, ${targetRegion || 'No region'}, ${targetCountry || 'No country'}`);

      console.log(`🐛 Debug workflow businessTypes before passing:`, JSON.stringify(businessTypes, null, 2));
      console.log(`🐛 Debug workflow targetCity: "${targetCity}"`);
      console.log(`🐛 Debug workflow targetRegion: "${targetRegion}"`);
      console.log(`🐛 Debug workflow targetCountry: "${targetCountry}"`);

      const regionVenuesMultipleOptions: RegionVenuesMultipleSearchOptions = {
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
            
            // Step 4: For each company, generate leads
            if (companiesCreated.length > 0) {
              console.log(`👥 Step 4: Processing ${companiesCreated.length} companies for lead generation...`);
              
              for (let i = 0; i < companiesCreated.length; i++) {
                const company = companiesCreated[i];
                console.log(`🏢 Processing company ${i + 1}/${companiesCreated.length}: ${company.name}`);
                
                const companyResult: any = {
                  company: company,
                  errors: []
                };
                
                try {
                  // Step 4a: Call lead generation API for this specific company
                  console.log(`🔥 Step 4a: Calling lead generation API for company: ${company.name}`);
                  
                  const companyLeadGenOptions: LeadGenerationApiOptions = {
                    site_id: site_id,
                    userId: options.userId || site.user_id,
                    additionalData: {
                      ...options.additionalData,
                      company: company,
                      businessTypes: businessTypes,
                      targetCompany: company.name,
                      targetIndustry: company.industry,
                      targetLocation: company.location,
                      siteName: siteName,
                      siteUrl: siteUrl
                    }
                  };
                  
                  const companyLeadGenResult = await callLeadGenerationApiActivity(companyLeadGenOptions);
                  companyResult.leadGenerationResult = companyLeadGenResult;
                  
                  console.log(`🔍 Lead generation result for ${company.name}:`, {
                    success: companyLeadGenResult.success,
                    hasSearchTopic: !!companyLeadGenResult.searchTopic,
                    searchTopicLength: companyLeadGenResult.searchTopic?.length || 0,
                    hasError: !!companyLeadGenResult.error,
                    error: companyLeadGenResult.error
                  });
                  
                  if (companyLeadGenResult.success && companyLeadGenResult.searchTopic) {
                    console.log(`✅ Lead generation for ${company.name} successful`);
                    console.log(`🔍 Search topic received: "${companyLeadGenResult.searchTopic}"`);
                    
                    // Step 4b: Call deep research for employees of this company
                    console.log(`👥 Step 4b: Researching employees for company: ${company.name}`);
                    
                    const employeeDeliverables = generateEmployeeDeliverables(company);
                    
                    // Create search topic for employees with specific venue address and regional context
                    const locationInfo = [];
                    
                    try {
                      // Add specific venue address
                      if (company.address) {
                        // Handle both string and object address formats
                        const addressString = typeof company.address === 'string' 
                          ? company.address 
                          : `${company.address.street || ''} ${company.address.city || ''} ${company.address.state || ''}`.trim();
                        
                        if (addressString) {
                          locationInfo.push(addressString);
                        }
                      }
                      
                      // Add regional context if different from venue address
                      if (targetCity) {
                        const companyAddressString = typeof company.address === 'string' 
                          ? company.address 
                          : (company.address?.city || company.address?.street || '');
                        
                        if (!companyAddressString || !companyAddressString.toLowerCase().includes(targetCity.toLowerCase())) {
                          locationInfo.push(targetCity);
                        }
                      }
                      
                      if (targetRegion) {
                        const companyAddressString = typeof company.address === 'string' 
                          ? company.address 
                          : (company.address?.state || company.address?.city || company.address?.street || '');
                        
                        if (!companyAddressString || !companyAddressString.toLowerCase().includes(targetRegion.toLowerCase())) {
                          locationInfo.push(targetRegion);
                        }
                      }
                    } catch (addressError) {
                      const addressErrorMessage = addressError instanceof Error ? addressError.message : String(addressError);
                      console.error(`❌ Error processing company address for ${company.name}: ${addressErrorMessage}`);
                      console.error(`🔍 Company address data:`, JSON.stringify(company.address, null, 2));
                      
                      // Continue with basic location info
                      if (targetCity) locationInfo.push(targetCity);
                      if (targetRegion) locationInfo.push(targetRegion);
                    }
                    
                    // Build contact information context
                    const contactInfo = [];
                    if (company.phone) {
                      contactInfo.push(`phone: ${company.phone}`);
                    }
                    if (company.email) {
                      contactInfo.push(`email: ${company.email}`);
                    }
                    if (company.website) {
                      contactInfo.push(`website: ${company.website}`);
                    }
                    
                    const locationContext = locationInfo.length > 0 ? ` located at ${locationInfo.join(', ')}` : '';
                    const contactContext = contactInfo.length > 0 ? ` (Contact info: ${contactInfo.join(', ')})` : '';
                    
                    const employeeSearchTopic = `Find individual employees, staff members, key contacts, and decision makers who work at ${company.name}${locationContext}${contactContext}. ONLY find personal information about the employees themselves: their names, email addresses, phone numbers, job titles, and LinkedIn profiles. DO NOT research or provide any company information since we already have that data.`;
                    
                    console.log(`🎯 Enhanced research topic for ${company.name}:`);
                    console.log(`   "${employeeSearchTopic}"`);
                    if (locationInfo.length > 0) {
                      console.log(`📍 Specific location context: ${locationInfo.join(' → ')}`);
                    }
                    if (contactInfo.length > 0) {
                      console.log(`📞 Available contact info: ${contactInfo.join(' | ')}`);
                    }
                    
                    console.log(`🚀 Starting deep research workflow for ${company.name}...`);
                    
                    const employeeResearchOptions: DeepResearchOptions = {
                      site_id: site_id,
                      research_topic: employeeSearchTopic,
                      userId: options.userId || site.user_id,
                      deliverables: employeeDeliverables,
                      additionalData: {
                        ...options.additionalData,
                        company: cleanCompanyForDeepResearch(company),
                        businessTypes: businessTypes,
                        leadGenerationResult: companyLeadGenResult,
                        researchContext: 'employee_research_workflow',
                        siteName: siteName,
                        siteUrl: siteUrl
                      }
                    };
                    
                    const employeeResearchHandle = await startChild(deepResearchWorkflow, {
                      args: [employeeResearchOptions],
                      workflowId: `employee-research-${company.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`,
                    });
                    
                    const employeeResearchResult = await employeeResearchHandle.result();
                    companyResult.employeeResearchResult = employeeResearchResult;
                    
                    if (employeeResearchResult.success) {
                      console.log(`✅ Employee research for ${company.name} successful`);
                      
                      // Extract employees as leads
                      let empDeliverables = null;
                      if (employeeResearchResult.data && employeeResearchResult.data.deliverables) {
                        empDeliverables = employeeResearchResult.data.deliverables;
                      }
                      
                      if (empDeliverables) {
                        const employeeLeads = extractEmployeesFromDeliverables(empDeliverables);
                        companyResult.leadsGenerated = employeeLeads;
                        
                        console.log(`👥 Extracted ${employeeLeads.length} potential leads for ${company.name}`);
                        
                        // Step 4b.4: If no leads generated, save venue as failed in system_memories
                        if (employeeLeads.length === 0) {
                          console.log(`📝 Step 4b.4: No leads generated for ${company.name}, saving venue as failed...`);
                          
                          const upsertResult = await upsertVenueFailedActivity({
                            site_id: site_id,
                            city: targetCity,
                            region: targetRegion,
                            venueName: company.name,
                            userId: options.userId || site.user_id
                          });
                          
                          if (upsertResult.success) {
                            console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                          } else {
                            const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                            console.warn(`⚠️ ${warningMsg}`);
                            // Don't add to errors since this is not critical for the main workflow
                          }
                        }
                        
                        // Step 4b.5: Save leads from deep research (visible workflow step)
                        console.log(`💾 Step 4b.5: Saving ${employeeLeads.length} leads from deep research for ${company.name}...`);
                        
                        const saveLeadsResult = await saveLeadsFromDeepResearchActivity({
                          site_id: site_id,
                          leads: employeeLeads,
                          company: cleanCompanyForDeepResearch(company),
                          create: options.create !== false, // Default to true unless explicitly set to false
                          userId: options.userId || site.user_id,
                          segment_id: segmentId, // Add segment_id from regionSearch (extracted from target_segment_id)
                          additionalData: {
                            ...options.additionalData,
                            businessTypes: businessTypes,
                            targetCity: targetCity,
                            targetRegion: targetRegion,
                            workflowId: workflowId,
                            deepResearchCompleted: true
                          }
                        });
                        
                        leadCreationResults.push(saveLeadsResult);
                        
                        if (saveLeadsResult.success) {
                          console.log(`✅ Successfully saved ${saveLeadsResult.leadsCreated || 0} leads from deep research for ${company.name}`);
                          console.log(`📊 Leads processed: ${saveLeadsResult.leadsValidated || 0} validated, ${saveLeadsResult.leadsCreated || 0} created`);
                          
                          // Update total leads generated counter with successfully created leads
                          if (saveLeadsResult.leadsCreated && saveLeadsResult.leadsCreated > 0) {
                            totalLeadsGenerated += saveLeadsResult.leadsCreated;
                            console.log(`✅ Successfully created ${saveLeadsResult.leadsCreated} valid leads for ${company.name}`);
                          }
                          
                          // Check if no leads were actually created due to validation failures
                          if (saveLeadsResult.leadsCreated === 0) {
                            console.log(`📝 Step 4b.4.1: No valid leads created for ${company.name} (validation failures), saving venue as failed...`);
                            
                            const upsertResult = await upsertVenueFailedActivity({
                              site_id: site_id,
                              city: targetCity,
                              region: targetRegion,
                              venueName: company.name,
                              userId: options.userId || site.user_id
                            });
                            
                            if (upsertResult.success) {
                              console.log(`✅ Successfully saved failed venue ${company.name} to system_memories (validation failures)`);
                            } else {
                              const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                              console.warn(`⚠️ ${warningMsg}`);
                              // Don't add to errors since this is not critical for the main workflow
                            }
                          } else {
                            // Step 4b.6: Update agent memory with lead statistics (visible workflow step)
                            if (targetCity && targetRegion) {
                              console.log(`🧠 Step 4b.6: Updating agent memory with ${saveLeadsResult.leadsCreated} leads...`);
                              
                              const updateMemoryResult = await updateMemoryActivity({
                                siteId: site_id,
                                city: targetCity,
                                region: targetRegion,
                                segmentId: segmentId,
                                leadsCount: saveLeadsResult.leadsCreated
                              });
                              
                              if (updateMemoryResult.success) {
                                console.log(`✅ Agent memory successfully updated for ${company.name}`);
                              } else {
                                const warningMsg = `Failed to update agent memory for ${company.name}: ${updateMemoryResult.error}`;
                                console.warn(`⚠️ ${warningMsg}`);
                                // Don't add to errors since this is not critical for the main workflow
                              }
                            } else {
                              console.log(`ℹ️ Skipping memory update: missing location data`);
                            }
                          }
                        } else {
                          const errorMsg = `Failed to save leads from deep research for ${company.name}: ${saveLeadsResult.error}`;
                          console.error(`❌ ${errorMsg}`);
                          companyResult.errors.push(errorMsg);
                          
                          // Step 4b.4.2: Save leads processing failed, save venue as failed in system_memories
                          console.log(`📝 Step 4b.4.2: Save leads processing failed for ${company.name}, saving venue as failed...`);
                          
                          const upsertResult = await upsertVenueFailedActivity({
                            site_id: site_id,
                            city: targetCity,
                            region: targetRegion,
                            venueName: company.name,
                            userId: options.userId || site.user_id
                          });
                          
                          if (upsertResult.success) {
                            console.log(`✅ Successfully saved failed venue ${company.name} to system_memories (save processing failed)`);
                          } else {
                            const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                            console.warn(`⚠️ ${warningMsg}`);
                            // Don't add to errors since this is not critical for the main workflow
                          }
                        }
                      } else {
                        console.log(`⚠️ No employee deliverables found for ${company.name}`);
                        
                        // Step 4b.4: No deliverables found, save venue as failed in system_memories
                        console.log(`📝 Step 4b.4: No deliverables found for ${company.name}, saving venue as failed...`);
                        
                        const upsertResult = await upsertVenueFailedActivity({
                          site_id: site_id,
                          city: targetCity,
                          region: targetRegion,
                          venueName: company.name,
                          userId: options.userId || site.user_id
                        });
                        
                        if (upsertResult.success) {
                          console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                        } else {
                          const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                          console.warn(`⚠️ ${warningMsg}`);
                          // Don't add to errors since this is not critical for the main workflow
                        }
                      }
                    } else {
                      const errorMsg = `Employee research for ${company.name} failed: ${employeeResearchResult.error}`;
                      console.error(`❌ ${errorMsg}`);
                      companyResult.errors.push(errorMsg);
                      
                      // Step 4b.4: Employee research failed, save venue as failed in system_memories
                      console.log(`📝 Step 4b.4: Employee research failed for ${company.name}, saving venue as failed...`);
                      
                      const upsertResult = await upsertVenueFailedActivity({
                        site_id: site_id,
                        city: targetCity,
                        region: targetRegion,
                        venueName: company.name,
                        userId: options.userId || site.user_id
                      });
                      
                      if (upsertResult.success) {
                        console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                      } else {
                        const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                        console.warn(`⚠️ ${warningMsg}`);
                        // Don't add to errors since this is not critical for the main workflow
                      }
                    }
                  } else if (companyLeadGenResult.success && !companyLeadGenResult.searchTopic) {
                    const errorMsg = `Lead generation for ${company.name} succeeded but no search topic received`;
                    console.error(`❌ ${errorMsg}`);
                    console.error(`🔍 Lead generation result:`, JSON.stringify(companyLeadGenResult, null, 2));
                    companyResult.errors.push(errorMsg);
                    
                    // Step 4b.4: Lead generation succeeded but no search topic, save venue as failed
                    console.log(`📝 Step 4b.4: No search topic received for ${company.name}, saving venue as failed...`);
                    
                    const upsertResult = await upsertVenueFailedActivity({
                      site_id: site_id,
                      city: targetCity,
                      region: targetRegion,
                      venueName: company.name,
                      userId: options.userId || site.user_id
                    });
                    
                    if (upsertResult.success) {
                      console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                    } else {
                      const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                      console.warn(`⚠️ ${warningMsg}`);
                      // Don't add to errors since this is not critical for the main workflow
                    }
                  } else {
                    const errorMsg = `Lead generation for ${company.name} failed: ${companyLeadGenResult.error}`;
                    console.error(`❌ ${errorMsg}`);
                    companyResult.errors.push(errorMsg);
                    
                    // Step 4b.4: Lead generation failed, save venue as failed in system_memories
                    console.log(`📝 Step 4b.4: Lead generation failed for ${company.name}, saving venue as failed...`);
                    
                    const upsertResult = await upsertVenueFailedActivity({
                      site_id: site_id,
                      city: targetCity,
                      region: targetRegion,
                      venueName: company.name,
                      userId: options.userId || site.user_id
                    });
                    
                    if (upsertResult.success) {
                      console.log(`✅ Successfully saved failed venue ${company.name} to system_memories`);
                    } else {
                      const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                      console.warn(`⚠️ ${warningMsg}`);
                      // Don't add to errors since this is not critical for the main workflow
                    }
                  }
                } catch (companyError) {
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
                  } else {
                    const warningMsg = `Failed to save failed venue ${company.name}: ${upsertResult.error}`;
                    console.warn(`⚠️ ${warningMsg}`);
                    // Don't add to errors since this is not critical for the main workflow
                  }
                }
                
                companyResults.push(companyResult);
                console.log(`📊 Completed processing company ${i + 1}/${companiesCreated.length}: ${company.name}`);
              }
            } else {
              console.log(`⚠️ No companies processed for lead generation`);
            }
          } else {
            const errorMsg = `Companies creation failed: ${companiesCreateResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
          }
        } else {
          console.log(`⚠️ No venues found from region venues API`);
        }
      } else {
        const errorMsg = `Region venues API call failed: ${venuesResult.error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    } catch (venuesError) {
      const errorMessage = venuesError instanceof Error ? venuesError.message : String(venuesError);
      console.error(`❌ Exception in region venues processing: ${errorMessage}`);
      errors.push(`Region venues API error: ${errorMessage}`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    const result: LeadGenerationResult = {
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
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 NEW Lead generation workflow completed successfully!`);
    console.log(`📊 Summary: Lead generation for site ${siteName} completed in ${executionTime}`);
    console.log(`   - Site: ${siteName} (${siteUrl})`);
    console.log(`   - Business types received: ${businessTypes.length}`);
    console.log(`   - Enhanced search topic: ${enhancedSearchTopic}`);
    console.log(`   - Target location: ${targetCity && targetRegion ? `${targetCity}, ${targetRegion}` : targetCity || targetRegion || 'Not specified'}`);
    
    console.log(`   - Companies created: ${companiesCreated.length}`);
    console.log(`   - Companies processed: ${companyResults.length}`);
    console.log(`   - Total leads generated: ${totalLeadsGenerated}`);
    console.log(`   - Lead creation results: ${leadCreationResults.length}`);
    
    if (retryWorkflowStarted) {
      console.log(`   - Retry workflow started: ${retryWorkflowId} (reason: no leads found)`);
    }

    // Step Final: Send notification for all leads generated in this workflow
    if (totalLeadsGenerated > 0) {
      console.log(`📢 Step Final: Sending notification for ${totalLeadsGenerated} leads generated...`);
      
      // Collect all successfully created lead names from company results
      const allLeadNames: string[] = [];
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
          } else {
            console.error(`❌ Failed to send notification: ${notificationResult.error}`);
            errors.push(`Notification failed: ${notificationResult.error}`);
          }
        } catch (notificationError) {
          const errorMessage = notificationError instanceof Error ? notificationError.message : String(notificationError);
          console.error(`❌ Exception sending notification: ${errorMessage}`);
          errors.push(`Notification exception: ${errorMessage}`);
        }
      } else {
        console.log(`⚠️ No lead names found for notification despite ${totalLeadsGenerated} leads generated`);
      }
    } else {
      console.log(`ℹ️ No leads generated, starting retry workflow...`);
      
      // Step Retry: If no valid leads found, automatically start a new workflow execution
      try {
        console.log(`🔄 Step Retry: Starting new lead generation workflow for site ${site_id} (no leads found)...`);
        
        const retryOptions: LeadGenerationOptions = {
          ...options,
          additionalData: {
            ...options.additionalData,
            retryReason: 'no_leads_found',
            originalWorkflowId: workflowId,
            originalExecutionTime: executionTime,
            retriedAt: new Date().toISOString()
          }
        };
        
        const retryWorkflowHandle = await startChild(leadGenerationWorkflow, {
          args: [retryOptions],
          workflowId: `lead-generation-retry-${site_id}-${Date.now()}`,
        });
        
        retryWorkflowStarted = true;
        retryWorkflowId = retryWorkflowHandle.workflowId;
        
        console.log(`✅ Successfully started retry workflow: ${retryWorkflowHandle.workflowId}`);
        
        // Don't await the result to avoid blocking this workflow completion
        // The retry workflow will run independently
        
      } catch (retryError) {
        const errorMessage = retryError instanceof Error ? retryError.message : String(retryError);
        console.error(`❌ Failed to start retry workflow: ${errorMessage}`);
        errors.push(`Retry workflow failed: ${errorMessage}`);
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

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ NEW Lead generation workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: scheduleId,
      activityName: 'leadGenerationWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadGenerationWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: LeadGenerationResult = {
      success: false,
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
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 