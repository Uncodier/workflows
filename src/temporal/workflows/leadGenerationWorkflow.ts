import { proxyActivities, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { deepResearchWorkflow, type DeepResearchOptions } from './deepResearchWorkflow';
import type { 
  LeadGenerationApiOptions,
  CreateLeadsOptions,
  LeadData,
  RegionSearchApiOptions,
  RegionVenuesApiOptions,
  VenueData
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
  callRegionVenuesApiActivity,
  callLeadGenerationApiActivity,
  createLeadsFromResearchActivity,
  createCompaniesFromVenuesActivity,
} = proxyActivities<{
  callRegionSearchApiActivity: (options: RegionSearchApiOptions) => Promise<any>;
  callRegionVenuesApiActivity: (options: any) => Promise<any>;
  callLeadGenerationApiActivity: (options: LeadGenerationApiOptions) => Promise<any>;
  createLeadsFromResearchActivity: (options: CreateLeadsOptions) => Promise<any>;
  createCompaniesFromVenuesActivity: (options: any) => Promise<any>;
}>({
  startToCloseTimeout: '10 minutes', // Longer timeout for lead generation processes
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadGenerationOptions {
  site_id: string;                    // Required: Site ID
  userId?: string;
  create?: boolean;                   // Default false for validation only
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
  errors: string[];
  executionTime: string;
  completedAt: string;
}

// Define BusinessType interface to match actual API response
export interface BusinessType {
  name: string;                      // Business type name from API
  description: string;               // Description of the business type
  relevance: string;                 // Why this type is relevant for the region
  market_potential: string;          // Market potential assessment
}

/**
 * Generate deliverables structure for companies research
 * Returns structure with companies information
 */
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

/**
 * Generate deliverables structure for employee research
 * Returns structure with employee leads including company information
 */
function generateEmployeeDeliverables(company: CompanyData): any {
  return {
    business: {
      // Company information (already known from previous research)
      ...company,
      
      // Employee list for this business
      employees: [
        {
          // Employee personal information
          name: null,
          telephone: null,
          email: null,
          position: null,
          department: null,
          seniority_level: null,
          linkedin_url: null,
          
          _research_timestamp: new Date().toISOString(),
          _research_source: "employee_research_workflow"
        }
      ]
    }
  };
}

/**
 * Extract companies from deep research deliverables
 */
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

/**
 * Extract employees from deep research deliverables
 */
function extractEmployeesFromDeliverables(deliverables: any): LeadData[] {
  const employees: LeadData[] = [];
  
  try {
    // Try business.employees structure first (most common from deep research)
    if (deliverables && deliverables.business && deliverables.business.employees && Array.isArray(deliverables.business.employees)) {
      console.log(`🔍 Found employees in deliverables.business.employees structure`);
      const business = deliverables.business;
      for (const employeeData of deliverables.business.employees) {
        if (employeeData && typeof employeeData === 'object' && employeeData.name) {
          // Only require name, email can be null
          employees.push({
            name: employeeData.name,
            telephone: employeeData.telephone || employeeData.phone || null,
            email: employeeData.email || null, // Allow null emails
            company_name: business.name || null,
            address: employeeData.address || business.location || business.address || null,
            web: business.website || null,
            position: employeeData.position || employeeData.job_title || null
          });
        }
      }
    }
    // Try lead.employees structure (legacy support)
    else if (deliverables && deliverables.lead && deliverables.lead.employees && Array.isArray(deliverables.lead.employees)) {
      console.log(`🔍 Found employees in deliverables.lead.employees structure (legacy)`);
      for (const employeeData of deliverables.lead.employees) {
        if (employeeData && typeof employeeData === 'object' && employeeData.name) {
          // Only require name, email can be null
          employees.push({
            name: employeeData.name,
            telephone: employeeData.telephone || employeeData.phone || null,
            email: employeeData.email || null, // Allow null emails
            company_name: employeeData.company?.name || null,
            address: employeeData.address || employeeData.company?.location || null,
            web: employeeData.company?.website || null,
            position: employeeData.position || employeeData.job_title || null
          });
        }
      }
    }
    // Try direct employees structure
    else if (deliverables && deliverables.employees && Array.isArray(deliverables.employees)) {
      console.log(`🔍 Found employees in deliverables.employees structure`);
      for (const employeeData of deliverables.employees) {
        if (employeeData && typeof employeeData === 'object' && employeeData.name) {
          // Only require name, email can be null
          employees.push({
            name: employeeData.name,
            telephone: employeeData.telephone || employeeData.phone || null,
            email: employeeData.email || null, // Allow null emails
            company_name: employeeData.company?.name || null,
            address: employeeData.address || employeeData.company?.location || null,
            web: employeeData.company?.website || null,
            position: employeeData.position || employeeData.job_title || null
          });
        }
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
            if (item && item.name) {
              // Only require name, email can be null
              employees.push({
                name: item.name,
                telephone: item.telephone || item.phone || null,
                email: item.email || null, // Allow null emails
                company_name: item.company?.name || item.company_name || null,
                address: item.address || null,
                web: item.company?.website || item.web || null,
                position: item.position || item.job_title || null
              });
            }
          }
          break; // Use first valid array found
        }
      }
    }
  } catch (error) {
    console.error('⚠️ Error extracting employees from deliverables:', error);
  }
  
  console.log(`📊 Extracted ${employees.length} employees from deliverables`);
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
  
  console.log(`🔥 Starting NEW lead generation workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

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
    scheduleId: `lead-generation-${site_id}`,
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
  let venuesResult: any = null;
  let venuesFound: VenueData[] = [];
  let companiesCreated: CompanyData[] = [];
  const companyResults: any[] = [];
  let totalLeadsGenerated = 0;
  const leadCreationResults: any[] = [];
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
        siteUrl: siteUrl
      }
    };
    
    regionSearchResult = await callRegionSearchApiActivity(regionSearchOptions);
    
    if (!regionSearchResult.success) {
      const warningMsg = `Region search API call failed: ${regionSearchResult.error}, proceeding with generic search`;
      console.warn(`⚠️ ${warningMsg}`);
      errors.push(warningMsg);
      // Don't throw error, continue with generic search
    } else {
      businessTypes = regionSearchResult.business_types || [];
      targetCity = regionSearchResult.targetCity || '';
      targetRegion = regionSearchResult.targetRegion || '';
      
      console.log(`✅ Region search API call successful`);
      console.log(`🔍 Business types received: ${businessTypes.length}`);
      console.log(`🏙️ Target city: "${targetCity || 'Not specified'}"`);
      console.log(`🌍 Target region: "${targetRegion || 'Not specified'}"`);
    }

    console.log(`🏢 Step 3: Calling region venues API to find businesses...`);
    
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
    
    enhancedSearchTopic = geographicInfo.length > 0 
      ? `${businessTypeNames.join(', ')} in ${geographicInfo.join(', ')}`
      : businessTypeNames.join(', ');
    
    console.log(`🔍 Enhanced search topic: "${enhancedSearchTopic}"`);
    
    // Call region venues API to find businesses
    try {
      const regionVenuesOptions: RegionVenuesApiOptions = {
        site_id: site_id,
        userId: options.userId || site.user_id,
        searchTerm: enhancedSearchTopic,
        city: targetCity || '',
        region: targetRegion || '',
        maxVenues: 15,
        priority: 'high',
        additionalData: {
          ...options.additionalData,
          regionSearchResult: regionSearchResult,
          businessTypes: businessTypes,
          enhancedSearchTopic: enhancedSearchTopic,
          siteName: siteName,
          siteUrl: siteUrl
        }
      };
      
      venuesResult = await callRegionVenuesApiActivity(regionVenuesOptions);
      
      if (venuesResult.success && venuesResult.data && venuesResult.data.venues) {
        venuesFound = venuesResult.data.venues;
        console.log(`✅ Region venues API call successful - Found ${venuesFound.length} venues`);
        
        // Step 3a: Create companies from venues
        if (venuesFound.length > 0) {
          console.log(`🏢 Step 3a: Creating companies from ${venuesFound.length} venues...`);
          
          const companiesCreateResult = await createCompaniesFromVenuesActivity({
            site_id: site_id,
            venues: venuesFound,
            userId: options.userId || site.user_id,
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
                  
                  if (companyLeadGenResult.success) {
                    console.log(`✅ Lead generation for ${company.name} successful`);
                    
                    // Step 4b: Call deep research for employees of this company
                    console.log(`👥 Step 4b: Researching employees for company: ${company.name}`);
                    
                    const employeeDeliverables = generateEmployeeDeliverables(company);
                    
                    // Create search topic for employees
                    const employeeSearchTopic = `employees and key contacts at ${company.name}${company.location ? ` in ${company.location}` : ''}`;
                    
                    const employeeResearchOptions: DeepResearchOptions = {
                      site_id: site_id,
                      research_topic: employeeSearchTopic,
                      userId: options.userId || site.user_id,
                      deliverables: employeeDeliverables,
                      additionalData: {
                        ...options.additionalData,
                        company: company,
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
                        totalLeadsGenerated += employeeLeads.length;
                        
                        console.log(`👥 Generated ${employeeLeads.length} leads for ${company.name}`);
                        
                        // Step 4c: Create/validate leads for this company
                        if (employeeLeads.length > 0) {
                          console.log(`🔄 Step 4c: Creating/validating ${employeeLeads.length} leads for ${company.name}...`);
                          
                          const createLeadsOptions: CreateLeadsOptions = {
                            site_id: site_id,
                            leads: employeeLeads,
                            create: options.create || false,
                            userId: options.userId || site.user_id,
                            additionalData: {
                              ...options.additionalData,
                              company: company,
                              businessTypes: businessTypes,
                              workflowId: workflowId
                            }
                          };
                          
                          const leadCreationResult = await createLeadsFromResearchActivity(createLeadsOptions);
                          leadCreationResults.push(leadCreationResult);
                          
                          if (leadCreationResult.success) {
                            console.log(`✅ Lead creation for ${company.name} successful`);
                          } else {
                            const errorMsg = `Lead creation for ${company.name} failed: ${leadCreationResult.error}`;
                            console.error(`❌ ${errorMsg}`);
                            companyResult.errors.push(errorMsg);
                          }
                        }
                      } else {
                        console.log(`⚠️ No employee deliverables found for ${company.name}`);
                      }
                    } else {
                      const errorMsg = `Employee research for ${company.name} failed: ${employeeResearchResult.error}`;
                      console.error(`❌ ${errorMsg}`);
                      companyResult.errors.push(errorMsg);
                    }
                  } else {
                    const errorMsg = `Lead generation for ${company.name} failed: ${companyLeadGenResult.error}`;
                    console.error(`❌ ${errorMsg}`);
                    companyResult.errors.push(errorMsg);
                  }
                } catch (companyError) {
                  const errorMessage = companyError instanceof Error ? companyError.message : String(companyError);
                  console.error(`❌ Error processing company ${company.name}: ${errorMessage}`);
                  companyResult.errors.push(errorMessage);
                }
                
                companyResults.push(companyResult);
                console.log(`📊 Completed processing company ${i + 1}/${companiesCreated.length}: ${company.name}`);
              }
            } else {
              console.log(`⚠️ No companies created from venues`);
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
      console.error(`❌ Region venues API call failed: ${errorMessage}`);
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
    console.log(`   - Venues found: ${venuesFound.length}`);
    console.log(`   - Companies created: ${companiesCreated.length}`);
    console.log(`   - Companies processed: ${companyResults.length}`);
    console.log(`   - Total leads generated: ${totalLeadsGenerated}`);
    console.log(`   - Lead creation results: ${leadCreationResults.length}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-generation-${site_id}`,
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
      scheduleId: `lead-generation-${site_id}`,
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
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 