/**
 * Activities specific for Lead Generation Workflow
 * 
 * This file contains activities for:
 * - Calling the lead generation API
 * - Creating/validating leads from research results
 * - Managing lead generation processes
 */

import { logger } from '../../lib/logger';
import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services/supabaseService';

export interface LeadGenerationApiResult {
  success: boolean;
  searchTopic?: string;
  targetCity?: string;
  targetRegion?: string;
  prompt?: string;
  data?: any;
  error?: string;
}

export interface LeadData {
  name: string;
  telephone?: string;
  email?: string; // Made optional since not always available from research
  company_name?: string;
  address?: string;
  web?: string;
  position?: string;
}

export interface CreateLeadsResult {
  success: boolean;
  leadsCreated?: number;
  leadsValidated?: number;
  leads?: any[];
  errors?: string[];
  validationResults?: any[];
  error?: string;
}

export interface LeadGenerationApiOptions {
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface RegionSearchApiOptions {
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface BusinessType {
  business_type_name: string;
  description: string;
  relevance: string;
  market_potential: string;
}

export interface RegionSearchApiResult {
  success: boolean;
  business_types?: BusinessType[];
  targetCity?: string;
  targetRegion?: string;
  target_segment_id?: string;
  data?: any;
  error?: string;
}

export interface CreateLeadsOptions {
  site_id: string;
  leads: LeadData[];
  create?: boolean; // Default false for validation only
  userId?: string;
  segment_id?: string; // Add segment_id to options
  additionalData?: any;
}

export interface RegionVenuesApiOptions {
  site_id: string;
  userId?: string;
  searchTerm: string;
  city: string;
  region: string;
  maxVenues?: number;
  priority?: string;
  excludeNames?: string[]; // Add exclude names parameter
  additionalData?: any;
}

export interface VenueData {
  id: string;
  name: string;
  address: string;
  phone?: string;
  international_phone?: string;
  website?: string;
  google_maps_url?: string;
  business_status?: string;
  rating?: string;
  total_ratings?: number;
  types?: string[];
  location?: {
    lat: number;
    lng: number;
  };
  opening_hours?: any;
  amenities?: string[];
  description?: string;
  reviews?: any[];
  photos?: any[];
}

export interface RegionVenuesApiResult {
  success: boolean;
  data?: {
    searchTerm: string;
    city: string;
    region: string;
    venueCount: number;
    venues: VenueData[];
    timestamp: string;
  };
  error?: string;
}

/**
 * Activity to call the region search API
 */
export async function callRegionSearchApiActivity(
  options: RegionSearchApiOptions
): Promise<RegionSearchApiResult> {
  try {
    logger.info('🌍 Starting region search API call', {
      site_id: options.site_id,
      userId: options.userId
    });

    const requestBody = {
      site_id: options.site_id,
      userId: options.userId,
      ...options.additionalData
    };

    console.log('📤 Sending region search request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/sales/regionSearch', requestBody);

    if (!response.success) {
      logger.error('❌ Region search API call failed', {
        error: response.error,
        site_id: options.site_id
      });
      
      return {
        success: false,
        error: response.error?.message || 'Failed to call region search API'
      };
    }

    const data = response.data;
    
    // Extract business_types, location data, and target_segment_id
    const businessTypes = data?.data?.business_types || data?.business_types || data?.businessTypes;
    const targetCity = data?.data?.target_city || data?.target_city || data?.targetCity;
    const targetRegion = data?.data?.target_region || data?.target_region || data?.targetRegion;
    const targetSegmentId = data?.data?.target_segment_id || data?.target_segment_id || data?.targetSegmentId;
    
    logger.info('✅ Region search API call successful', {
      site_id: options.site_id,
      hasBusinessTypes: !!businessTypes,
      businessTypesCount: Array.isArray(businessTypes) ? businessTypes.length : 0,
      hasTargetCity: !!targetCity,
      hasTargetRegion: !!targetRegion,
      hasTargetSegmentId: !!targetSegmentId
    });

    const result = {
      success: true,
      business_types: businessTypes,
      targetCity,
      targetRegion,
      target_segment_id: targetSegmentId,
      data: data?.data || data,
    };

    // Debug: Log the exact result being returned
    console.log('🔍 Region search API returning:', JSON.stringify(result, null, 2));

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Region search API call exception', {
      error: errorMessage,
      site_id: options.site_id
    });

    return {
      success: false,
      error: `API call exception: ${errorMessage}`
    };
  }
}

/**
 * Activity to search leads by company city
 * Returns company names of leads whose company address contains the specified city
 * Uses exact Google Maps address data without parsing or guessing
 */
export async function searchLeadsByCompanyCityActivity(
  options: {
    site_id: string;
    city: string;
    region?: string;
    userId?: string;
  }
): Promise<{ success: boolean; companyNames?: string[]; error?: string }> {
  try {
    logger.info('🔍 Starting search for leads by company city and region', {
      site_id: options.site_id,
      city: options.city,
      region: options.region
    });

    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      return {
        success: false,
        error: 'Database not connected'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Search for leads where company address contains the search city
    // First, try to find leads through their company_id relationship
    const { data: leadsWithCompanyId, error: leadsError } = await supabaseServiceRole
      .from('leads')
      .select(`
        id,
        company,
        company_id,
        company:company_id (
          id,
          name,
          address
        )
      `)
      .eq('site_id', options.site_id)
      .not('company_id', 'is', null);

    if (leadsError) {
      logger.error('❌ Error searching leads by company city', {
        error: leadsError.message,
        site_id: options.site_id,
        city: options.city
      });
      return {
        success: false,
        error: leadsError.message
      };
    }

    // Also search leads that have company info in the company jsonb field
    const { data: leadsWithCompanyJson, error: jsonError } = await supabaseServiceRole
      .from('leads')
      .select('id, company, company_id')
      .eq('site_id', options.site_id)
      .is('company_id', null)
      .not('company', 'is', null);

    if (jsonError) {
      logger.error('❌ Error searching leads with company JSON', {
        error: jsonError.message,
        site_id: options.site_id
      });
      // Continue with company_id results only
    }

    const companyNames = new Set<string>();
    
    // Process leads with company_id relationship
    if (leadsWithCompanyId && leadsWithCompanyId.length > 0) {
      for (const lead of leadsWithCompanyId) {
        if (lead.company && lead.company.address) {
          const companyAddress = lead.company.address;
          
          // ✅ Only check against the full address from Google Maps
          // Don't try to extract city/state - just check if target city appears in the address
          const fullAddress = companyAddress.full_address || companyAddress.address || '';
          
          // Check if city appears in the full address (case insensitive)
          const cityMatches = fullAddress && 
            fullAddress.toLowerCase().includes(options.city.toLowerCase());
          
          if (cityMatches) {
            companyNames.add(lead.company.name);
            console.log(`🔍 Found match: ${lead.company.name} in address: ${fullAddress}`);
          }
        }
      }
    }

    // Process leads with company JSON data
    if (leadsWithCompanyJson && leadsWithCompanyJson.length > 0) {
      for (const lead of leadsWithCompanyJson) {
        if (lead.company && typeof lead.company === 'object') {
          const companyData = lead.company;
          
          // ✅ Only check against the full address from Google Maps
          // Don't try to parse or guess city/state
          const fullAddress = companyData.full_address || companyData.address || '';
          
          // Check if city appears in the full address (case insensitive)
          const cityMatches = fullAddress && 
            fullAddress.toLowerCase().includes(options.city.toLowerCase());
          
          if (cityMatches && companyData.name) {
            companyNames.add(companyData.name);
            console.log(`🔍 Found match: ${companyData.name} in address: ${fullAddress}`);
          }
        }
      }
    }

    const companyNamesArray = Array.from(companyNames);
    
    logger.info('✅ Successfully searched leads by company city', {
      site_id: options.site_id,
      city: options.city,
      companyNamesFound: companyNamesArray.length,
      companyNames: companyNamesArray,
      searchMethod: 'contains_city_in_full_address'
    });

    console.log(`🔍 Found ${companyNamesArray.length} companies with leads containing city "${options.city}" in their address`);
    if (companyNamesArray.length > 0) {
      console.log(`📋 Company names to exclude: ${companyNamesArray.join(', ')}`);
    }

    return {
      success: true,
      companyNames: companyNamesArray
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception searching leads by company city', {
      error: errorMessage,
      site_id: options.site_id,
      city: options.city
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to call the region venues API
 */
export async function callRegionVenuesApiActivity(
  options: RegionVenuesApiOptions
): Promise<RegionVenuesApiResult> {
  try {
    logger.info('🏢 Starting region venues API call', {
      site_id: options.site_id,
      userId: options.userId,
      searchTerm: options.searchTerm,
      city: options.city,
      region: options.region,
      maxVenues: options.maxVenues,
      excludeNamesCount: options.excludeNames?.length || 0
    });

    const requestBody = {
      siteId: options.site_id,
      userId: options.userId,
      searchTerm: options.searchTerm,
      city: options.city,
      region: options.region,
      maxVenues: options.maxVenues || 10,
      priority: options.priority || 'high',
      excludeNames: options.excludeNames || [], // Pass excludeNames to API
      targetAudience: {
        demographics: 'Business professionals',
        interests: ['business development', 'lead generation'],
        budget: 'premium'
      },
      eventInfo: {
        eventType: 'lead generation',
        requirements: ['business information', 'contact details']
      },
      contactPreferences: {
        contactMethod: 'email',
        bestTimeToContact: 'business_hours',
        contactPerson: 'business_owner'
      },
      ...options.additionalData
    };

    console.log('📤 Sending region venues request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/sales/regionVenues', requestBody);

    if (!response.success) {
      logger.error('❌ Region venues API call failed', {
        error: response.error,
        site_id: options.site_id
      });
      return {
        success: false,
        error: response.error?.message || 'Failed to call region venues API'
      };
    }

    const data = response.data;
    
    logger.info('✅ Region venues API call successful', {
      site_id: options.site_id,
      hasData: !!data,
      hasVenues: !!(data?.venues),
      venuesCount: data?.venues?.length || 0
    });

    return {
      success: true,
      data: data,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Region venues API call exception', {
      error: errorMessage,
      site_id: options.site_id
    });
    return {
      success: false,
      error: `API call exception: ${errorMessage}`
    };
  }
}

/**
 * Activity to call the lead generation API
 */
export async function callLeadGenerationApiActivity(
  options: LeadGenerationApiOptions
): Promise<LeadGenerationApiResult> {
  try {
    logger.info('🔥 Starting lead generation API call', {
      site_id: options.site_id,
      userId: options.userId
    });

    const requestBody = {
      site_id: options.site_id,
      userId: options.userId,
      ...options.additionalData
    };

    console.log('📤 Sending lead generation request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/sales/leadGeneration', requestBody);

    if (!response.success) {
      logger.error('❌ Lead generation API call failed', {
        error: response.error,
        site_id: options.site_id
      });
      
      return {
        success: false,
        error: response.error?.message || 'Failed to call lead generation API'
      };
    }

    const data = response.data;
    
    // Handle different response structures from API
    let responseData = data;
    
    // If it's an array, extract the first element
    if (Array.isArray(data)) {
      responseData = data[0];
    }
    
    console.log('🔍 Lead generation API response structure:', {
      isArray: Array.isArray(data),
      dataLength: Array.isArray(data) ? data.length : 'not array',
      hasResponseData: !!responseData,
      responseSuccess: responseData?.success,
      hasSearchTopic: !!responseData?.searchTopic,
      hasData: !!responseData?.data,
      fullResponse: JSON.stringify(data, null, 2)
    });
    
    // Extract search_topic, target_city, and target_region from data
    const searchTopic = responseData?.data?.search_topic || responseData?.search_topic || responseData?.searchTopic;
    const targetCity = responseData?.data?.target_city || responseData?.target_city || responseData?.targetCity;
    const targetRegion = responseData?.data?.target_region || responseData?.target_region || responseData?.targetRegion;
    
    logger.info('✅ Lead generation API call successful', {
      site_id: options.site_id,
      hasSearchTopic: !!searchTopic,
      hasTargetCity: !!targetCity,
      hasTargetRegion: !!targetRegion,
      hasPrompt: !!responseData?.prompt,
      hasData: !!responseData?.data
    });

    // Validate that we have the essential data
    if (!searchTopic) {
      logger.error('❌ Lead generation API response missing searchTopic', {
        site_id: options.site_id,
        responseData: JSON.stringify(responseData, null, 2)
      });
      return {
        success: false,
        error: 'API response missing required searchTopic field'
      };
    }

    return {
      success: true,
      searchTopic,
      targetCity,
      targetRegion,
      prompt: responseData?.prompt,
      data: responseData?.data || responseData,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Lead generation API call exception', {
      error: errorMessage,
      site_id: options.site_id
    });

    return {
      success: false,
      error: `API call exception: ${errorMessage}`
    };
  }
}

/**
 * Activity to save leads generated from deep research
 * This is a visible workflow step that occurs after deep research and before moving to next venue
 */
export async function saveLeadsFromDeepResearchActivity(
  options: {
    site_id: string;
    leads: LeadData[];
    company: any;
    create?: boolean;
    userId?: string;
    segment_id?: string;
    additionalData?: any;
  }
): Promise<CreateLeadsResult> {
  try {
    logger.info('💾 Starting to save leads from deep research', {
      site_id: options.site_id,
      leadsCount: options.leads.length,
      companyName: options.company?.name,
      createMode: options.create || false
    });

    if (options.leads.length === 0) {
      logger.info('⚠️ No leads to save from deep research', {
        site_id: options.site_id,
        companyName: options.company?.name
      });
      return {
        success: true,
        leadsCreated: 0,
        leadsValidated: 0,
        leads: [],
        validationResults: []
      };
    }

    console.log(`💾 Saving ${options.leads.length} leads from deep research for company: ${options.company?.name}`);
    console.log(`🔗 Company ID for leads: ${options.company?.id || 'NOT PROVIDED'}`);

    // Use the existing createLeadsFromResearchActivity to do the actual work
    const createLeadsOptions: CreateLeadsOptions = {
      site_id: options.site_id,
      leads: options.leads,
      create: options.create || false,
      userId: options.userId,
      segment_id: options.segment_id,
      additionalData: {
        ...options.additionalData,
        company: options.company,
        workflowStep: 'save_leads_from_deep_research'
      }
    };

    const result = await createLeadsFromResearchActivity(createLeadsOptions);

    if (result.success) {
      logger.info('✅ Successfully saved leads from deep research', {
        site_id: options.site_id,
        companyName: options.company?.name,
        leadsCreated: result.leadsCreated,
        leadsValidated: result.leadsValidated
      });

      console.log(`✅ Successfully saved ${result.leadsCreated || 0} leads from deep research for company: ${options.company?.name}`);
      console.log(`📊 Validation results: ${result.leadsValidated || 0} leads validated`);
    } else {
      logger.error('❌ Failed to save leads from deep research', {
        site_id: options.site_id,
        companyName: options.company?.name,
        error: result.error,
        errorsCount: result.errors?.length || 0
      });
    }

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception saving leads from deep research', {
      error: errorMessage,
      site_id: options.site_id,
      companyName: options.company?.name
    });

    return {
      success: false,
      error: `Exception saving leads from deep research: ${errorMessage}`
    };
  }
}

/**
 * Activity to create/validate leads from research results
 */
export async function createLeadsFromResearchActivity(
  options: CreateLeadsOptions
): Promise<CreateLeadsResult> {
  try {
    logger.info('👥 Starting lead creation/validation process', {
      site_id: options.site_id,
      leadsCount: options.leads.length,
      createMode: options.create || false
    });

    const validationResults: any[] = [];
    const errors: string[] = [];
    let leadsCreated = 0;
    let leadsValidated = 0;

    // Validate each lead structure
    for (const [index, lead] of options.leads.entries()) {
      try {
        // Validate required fields
        const validation = validateLeadData(lead);
        validationResults.push({
          index,
          lead,
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings
        });

        if (validation.valid) {
          leadsValidated++;
          
          // If create mode is enabled, create the lead
          if (options.create) {
            const createResult = await createSingleLead(lead, options.site_id, options.userId, options.additionalData?.company?.id, options.segment_id);
            if (createResult.success) {
              leadsCreated++;
              logger.info(`✅ Lead created successfully: ${lead.name || lead.email}`, {
                site_id: options.site_id,
                leadId: createResult.leadId
              });
            } else {
              errors.push(`Failed to create lead ${lead.name || lead.email}: ${createResult.error}`);
            }
          } else {
            logger.info(`✅ Lead validated successfully: ${lead.name || lead.email}`, {
              site_id: options.site_id,
              validationMode: true
            });
          }
        } else {
          errors.push(`Lead validation failed for ${lead.name || lead.email}: ${validation.errors.join(', ')}`);
        }
      } catch (leadError) {
        const leadErrorMessage = leadError instanceof Error ? leadError.message : String(leadError);
        errors.push(`Exception processing lead ${index}: ${leadErrorMessage}`);
      }
    }

    // Update agent memory with lead generation statistics if leads were created successfully
    if (options.create && leadsCreated > 0 && options.additionalData) {
      const { targetCity, targetRegion } = options.additionalData;
      
      if (targetCity && targetRegion) {
        try {
          const updateMemoryResult = await updateMemoryActivity({
            siteId: options.site_id,
            city: targetCity,
            region: targetRegion,
            segmentId: options.segment_id,
            leadsCount: leadsCreated
          });
          
          if (updateMemoryResult.success) {
            console.log(`✅ Agent memory updated with ${leadsCreated} leads`);
          } else {
            console.error(`❌ Failed to update agent memory: ${updateMemoryResult.error}`);
          }
        } catch (memoryError) {
          console.error(`❌ Exception updating agent memory:`, memoryError);
        }
      }
    }

    const result: CreateLeadsResult = {
      success: errors.length === 0 || leadsValidated > 0,
      leadsCreated,
      leadsValidated,
      leads: options.leads,
      errors: errors.length > 0 ? errors : undefined,
      validationResults
    };

    logger.info(`📊 Lead creation/validation completed`, {
      site_id: options.site_id,
      leadsValidated,
      leadsCreated,
      errorsCount: errors.length,
      createMode: options.create || false
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Lead creation/validation exception', {
      error: errorMessage,
      site_id: options.site_id
    });

    return {
      success: false,
      error: `Lead creation/validation exception: ${errorMessage}`
    };
  }
}

/**
 * Validate lead data structure and required fields
 */
function validateLeadData(lead: LeadData): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields validation
  if (!lead.name || typeof lead.name !== 'string' || lead.name.trim() === '') {
    errors.push('Name is required and must be a non-empty string');
  }

  // At least email OR telephone is required
  const hasEmail = lead.email && lead.email !== null && typeof lead.email === 'string' && lead.email.trim() !== '';
  const hasPhone = lead.telephone && lead.telephone !== null && typeof lead.telephone === 'string' && lead.telephone.trim() !== '';
  
  if (!hasEmail && !hasPhone) {
    errors.push('Lead must have at least email or telephone contact information');
  }

  // Email validation if provided
  if (hasEmail) {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lead.email!)) {
      errors.push('Email must be a valid email address');
    }
  }

  // Optional fields validation
  if (lead.telephone && typeof lead.telephone !== 'string') {
    warnings.push('Telephone should be a string');
  }

  if (lead.company_name && typeof lead.company_name !== 'string') {
    warnings.push('Company name should be a string');
  }

  if (lead.address && typeof lead.address !== 'string') {
    warnings.push('Address should be a string');
  }

  if (lead.web && typeof lead.web !== 'string') {
    warnings.push('Web should be a string');
  } else if (lead.web && lead.web.trim() !== '') {
    // Basic URL validation
    try {
      new URL(lead.web);
    } catch {
      warnings.push('Web should be a valid URL');
    }
  }

  if (lead.position && typeof lead.position !== 'string') {
    warnings.push('Position should be a string');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Create a single lead in the database
 */
async function createSingleLead(
  lead: LeadData, 
  site_id: string, 
  userId?: string,
  companyId?: string, // Add company_id parameter
  segmentId?: string // Add segment_id parameter
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  try {
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Prepare lead data for database
    const leadData = {
      name: lead.name,
      email: lead.email,
      phone: lead.telephone || null,
      company: lead.company_name ? { 
        name: lead.company_name,
        website: lead.web || null 
      } : (lead.web ? { website: lead.web } : {}), // Store company info in company jsonb field
      company_id: companyId || null, // Add company_id to lead data
      segment_id: segmentId || null, // Add segment_id to lead data
      address: lead.address ? { full_address: lead.address } : {}, // Store address exactly as provided
      position: lead.position || null,
      site_id: site_id,
      user_id: userId || null,
      status: 'new',
      origin: 'lead_generation_workflow',
      metadata: {}, // Keep metadata empty for now
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Log company_id and segment_id assignment for debugging
    if (companyId) {
      console.log(`🔗 Assigning company_id ${companyId} to lead ${lead.name || lead.email}`);
    } else {
      console.log(`⚠️ No company_id provided for lead ${lead.name || lead.email}`);
    }
    
    if (segmentId) {
      console.log(`🎯 Assigning segment_id ${segmentId} to lead ${lead.name || lead.email}`);
    } else {
      console.log(`⚠️ No segment_id provided for lead ${lead.name || lead.email}`);
    }

    const { data, error } = await supabaseServiceRole
      .from('leads')
      .insert([leadData])
      .select()
      .single();

    if (error) {
      logger.error('❌ Failed to create lead in database', {
        error: error.message,
        site_id,
        leadEmail: lead.email,
        companyId
      });
      return {
        success: false,
        error: error.message
      };
    }

    logger.info('✅ Lead created successfully with company_id', {
      leadId: data.id,
      leadEmail: lead.email,
      companyId: companyId || 'none'
    });

    return {
      success: true,
      leadId: data.id
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception creating lead in database', {
      error: errorMessage,
      site_id,
      leadEmail: lead.email,
      companyId
    });
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Convert venues to companies format
 */
export function convertVenuesToCompanies(venues: VenueData[]): any[] {
  const companies: any[] = [];
  
  // Helper function to map venue types to allowed industry values
  const mapVenueTypeToIndustry = (types: string[]): string => {
    if (!types || types.length === 0) return 'other';
    
    const typeMap: { [key: string]: string } = {
      'restaurant': 'hospitality',
      'food': 'hospitality',
      'meal_takeaway': 'hospitality',
      'meal_delivery': 'hospitality',
      'cafe': 'hospitality',
      'bar': 'hospitality',
      'lodging': 'hospitality',
      'hotel': 'hospitality',
      'tourist_attraction': 'hospitality',
      'store': 'retail',
      'shopping_mall': 'retail',
      'clothing_store': 'retail',
      'electronics_store': 'retail',
      'grocery_or_supermarket': 'retail',
      'convenience_store': 'retail',
      'department_store': 'retail',
      'pharmacy': 'healthcare',
      'hospital': 'healthcare',
      'doctor': 'healthcare',
      'dentist': 'healthcare',
      'veterinary_care': 'healthcare',
      'health': 'healthcare',
      'gym': 'services',
      'beauty_salon': 'services',
      'spa': 'services',
      'lawyer': 'services',
      'accounting': 'finance',
      'bank': 'finance',
      'atm': 'finance',
      'insurance_agency': 'finance',
      'real_estate_agency': 'real_estate',
      'moving_company': 'logistics',
      'storage': 'logistics',
      'gas_station': 'logistics',
      'car_repair': 'services',
      'car_dealer': 'retail',
      'school': 'education',
      'university': 'education',
      'library': 'education',
      'church': 'nonprofit',
      'cemetery': 'nonprofit',
      'media': 'media',
      'news': 'media',
      'entertainment': 'media'
    };
    
    // Find the first matching type
    for (const type of types) {
      if (typeMap[type]) {
        return typeMap[type];
      }
    }
    
    return 'other';
  };
  
  // Helper function to map employee count to allowed size values
  const mapEmployeeCountToSize = (count: number | null): string => {
    if (!count) return '1-10'; // Default for small businesses
    
    if (count <= 10) return '1-10';
    else if (count <= 50) return '11-50';
    else if (count <= 200) return '51-200';
    else if (count <= 500) return '201-500';
    else if (count <= 1000) return '501-1000';
    else if (count <= 5000) return '1001-5000';
    else if (count <= 10000) return '5001-10000';
    else return '10001+';
  };
  
  for (const venue of venues) {
    try {
      // Map venue types to valid industry
      const industry = mapVenueTypeToIndustry(venue.types || []);
      
      // Calculate approximate employees count based on rating and reviews
      let employeesCount = null;
      if (venue.total_ratings && venue.total_ratings > 0) {
        // Simple estimation: more reviews = larger business
        if (venue.total_ratings >= 100) employeesCount = 50;
        else if (venue.total_ratings >= 50) employeesCount = 20;
        else if (venue.total_ratings >= 20) employeesCount = 10;
        else if (venue.total_ratings >= 10) employeesCount = 5;
        else employeesCount = 3;
      }
      
      // Map employee count to valid size
      const size = mapEmployeeCountToSize(employeesCount);
      
      const company = {
        name: venue.name,
        website: venue.website || null,
        industry: industry,
        description: venue.description || null,
        location: venue.address,
        address: venue.address,
        phone: venue.phone || venue.international_phone || null,
        email: null, // Will be populated later through research
        size: size,
        employees_count: employeesCount,
        google_maps_url: venue.google_maps_url || null,
        rating: venue.rating ? parseFloat(venue.rating) : null,
        total_ratings: venue.total_ratings || null,
        business_status: venue.business_status || null,
        types: venue.types || [],
        coordinates: venue.location ? {
          lat: venue.location.lat,
          lng: venue.location.lng
        } : null,
        opening_hours: venue.opening_hours || null,
        amenities: venue.amenities || [],
        reviews: venue.reviews || [],
        photos: venue.photos || [],
        venue_id: venue.id,
        _research_timestamp: new Date().toISOString(),
        _research_source: "region_venues_api"
      };
      
      companies.push(company);
    } catch {

    }
  }
  

  return companies;
}

/**
 * Activity to update agent memory with lead generation statistics
 * This is a visible workflow step that consolidates the entire memory update process
 */
export async function updateMemoryActivity(
  options: {
    siteId: string;
    city: string;
    region: string;
    segmentId?: string;
    leadsCount: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`🧠 Starting agent memory update for ${options.leadsCount} leads in ${options.city}, ${options.region}`);
    
    // Find Sales/CRM specialist agent for the site
    const agentResult = await findSalesCrmAgentActivity(options.siteId);
    
    if (!agentResult.success || !agentResult.agent) {
      const errorMsg = `No Sales/CRM specialist agent found: ${agentResult.error}`;
      console.error(`❌ ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }

    const agent = agentResult.agent;
    console.log(`✅ Found agent: ${agent.name} (${agent.role}) - ID: ${agent.id}`);
    
    // Update agent memory with lead statistics
    const updateMemoryResult = await updateAgentMemoryWithLeadStatsActivity({
      siteId: options.siteId,
      agentId: agent.id,
      city: options.city,
      region: options.region,
      segmentId: options.segmentId,
      leadsCount: options.leadsCount
    });
    
    if (updateMemoryResult.success) {
      console.log(`✅ Agent memory successfully updated with ${options.leadsCount} leads`);
      console.log(`📊 Memory updated for: ${options.city}, ${options.region}`);
      console.log(`🎯 Lead generation context: Generated ${options.leadsCount} employee leads for companies in ${options.city}, ${options.region}`);
      if (options.segmentId) {
        console.log(`🎯 Segment-specific data updated: ${options.segmentId}`);
      }
    } else {
      console.error(`❌ Failed to update agent memory: ${updateMemoryResult.error}`);
    }
    
    return updateMemoryResult;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception in updateMemoryActivity: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to find Sales/CRM specialist agent for a site
 */
export async function findSalesCrmAgentActivity(
  siteId: string
): Promise<{ success: boolean; agent?: any; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      return {
        success: false,
        error: 'Database not connected'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Try to find Sales/CRM specialist agent with multiple search strategies
    
    // First, try exact match for "Sales/CRM Specialist"
    let { data: agents, error } = await supabaseServiceRole
      .from('agents')
      .select('*')
      .eq('site_id', siteId)
      .eq('status', 'active')
      .eq('role', 'Sales/CRM Specialist')
      .limit(1);

    // If no exact match, try pattern searches
    if ((!agents || agents.length === 0) && !error) {
      const { data: patternAgents, error: patternError } = await supabaseServiceRole
        .from('agents')
        .select('*')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .or('role.ilike.%sales%,role.ilike.%crm%,role.ilike.%specialist%')
        .limit(1);

      if (patternError) {
        error = patternError;
      } else {
        agents = patternAgents;
      }
    }

    // If still no agents found, try broader search
    if ((!agents || agents.length === 0) && !error) {
      const { data: allAgents, error: allError } = await supabaseServiceRole
        .from('agents')
        .select('*')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .limit(5);

      if (allError) {
        error = allError;
      } else {
        agents = allAgents;
        
        // Use the first active agent if no specific Sales/CRM agent found
        if (agents && agents.length > 0) {
          agents = [agents[0]];
          console.log(`✅ Using first active agent: ${agents[0].name} (${agents[0].role})`);
        }
      }
    }

    if (error) {
      console.error(`❌ Error finding Sales/CRM agent:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!agents || agents.length === 0) {
      return {
        success: false,
        error: 'No Sales/CRM specialist agent found'
      };
    }

    const agent = agents[0];
    
    return {
      success: true,
      agent: agent
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception finding Sales/CRM agent:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to update agent memory with lead generation statistics
 */
export async function updateAgentMemoryWithLeadStatsActivity(
  options: {
    siteId: string;
    agentId: string;
    city: string;
    region: string;
    segmentId?: string;
    leadsCount: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      return {
        success: false,
        error: 'Database not connected'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // First, get the current agent memory
    const { data: currentMemory, error: getError } = await supabaseServiceRole
      .from('agent_memories')
      .select('*')
      .eq('agent_id', options.agentId)
      .eq('type', 'lead_generation')
      .eq('key', 'lead_generation')
      .order('created_at', { ascending: false })
      .limit(1);

    if (getError) {
      console.error(`❌ Error getting current agent memory:`, getError);
      return {
        success: false,
        error: getError.message
      };
    }

    // Initialize leads data structure
    let leadsData: any = {};
    
    if (currentMemory && currentMemory.length > 0) {
      // Use existing data structure
      leadsData = currentMemory[0].data || {};
    } else {
      // Initialize with default structure
      leadsData = {
        currentCityIndex: 0,
        targetCity: options.city,
        usedCities: [options.city],
        usedRegions: {},
        lastUpdated: new Date().toISOString(),
        totalCitiesAvailable: 30,
        leads: {}
      };
    }

    // Ensure leads structure exists
    if (!leadsData.leads) {
      leadsData.leads = {};
    }

    // Update city structure
    if (!leadsData.leads[options.city]) {
      leadsData.leads[options.city] = {};
    }

    // Update region structure
    if (!leadsData.leads[options.city][options.region]) {
      leadsData.leads[options.city][options.region] = {
        count: 0
      };
    }

    // Update counts
    leadsData.leads[options.city][options.region].count += options.leadsCount;

    // Update segment-specific counts if segment_id is provided
    if (options.segmentId) {
      if (!leadsData.leads[options.city][options.region][options.segmentId]) {
        leadsData.leads[options.city][options.region][options.segmentId] = {
          count: 0
        };
      }
      leadsData.leads[options.city][options.region][options.segmentId].count += options.leadsCount;
    }

    // Update used cities and regions
    if (!leadsData.usedCities.includes(options.city)) {
      leadsData.usedCities.push(options.city);
    }

    if (!leadsData.usedRegions[options.city]) {
      leadsData.usedRegions[options.city] = [];
    }

    if (!leadsData.usedRegions[options.city].includes(options.region)) {
      leadsData.usedRegions[options.city].push(options.region);
    }

    // Update lastUpdated
    leadsData.lastUpdated = new Date().toISOString();

    console.log(`💾 Saving leads data with structure:`, { 
      city: options.city, 
      region: options.region, 
      segmentId: options.segmentId, 
      leadsCount: options.leadsCount,
      hasLeadsObject: !!leadsData.leads
    });

    // Calculate total leads generated (existing + new)
    const existingTotalLeads = currentMemory?.[0]?.metadata?.total_leads_generated || 0;
    const newTotalLeads = existingTotalLeads + options.leadsCount;
    
    // Preserve existing metadata and merge with new information
    const existingMetadata = currentMemory?.[0]?.metadata || {};
    const generationHistory = existingMetadata.generation_history || [];
    
    // Add current generation to history
    generationHistory.push({
      timestamp: new Date().toISOString(),
      city: options.city,
      region: options.region,
      segment_id: options.segmentId,
      leads_generated: options.leadsCount,
      lead_type: 'employee_contacts',
      generation_method: 'deep_research_workflow',
      description: `Generated ${options.leadsCount} employee leads for companies in ${options.city}, ${options.region}${options.segmentId ? ` (segment: ${options.segmentId})` : ''}`
    });

    // Create the memory object to save
    const memoryData = {
      agent_id: options.agentId,
      user_id: options.siteId, // Use site_id as user_id for site-level memories
      type: 'lead_generation',
      key: 'lead_generation',
      data: leadsData,
      metadata: {
        ...existingMetadata, // Preserve existing metadata
        last_lead_generation: new Date().toISOString(),
        total_leads_generated: newTotalLeads, // ✅ Accumulate total instead of overwriting
        city: options.city,
        region: options.region,
        segment_id: options.segmentId,
        generation_history: generationHistory, // ✅ Track detailed history
        latest_generation: {
          timestamp: new Date().toISOString(),
          city: options.city,
          region: options.region,
          segment_id: options.segmentId,
          leads_generated: options.leadsCount,
          lead_type: 'employee_contacts',
          generation_method: 'deep_research_workflow',
          description: `Generated ${options.leadsCount} employee leads for companies in ${options.city}, ${options.region}${options.segmentId ? ` (segment: ${options.segmentId})` : ''}`
        }
      },
      updated_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(),
      access_count: (currentMemory?.[0]?.access_count || 0) + 1
    };

    let saveError = null;

    if (currentMemory && currentMemory.length > 0) {
      // Update existing memory
      const { error: updateError } = await supabaseServiceRole
        .from('agent_memories')
        .update(memoryData)
        .eq('id', currentMemory[0].id);

      if (updateError) {
        console.error(`❌ Error updating existing agent memory:`, updateError);
        saveError = updateError;
      } else {
        console.log(`✅ Updated existing agent memory record`);
      }
    } else {
      // Create new memory
      const { error: insertError } = await supabaseServiceRole
        .from('agent_memories')
        .insert([memoryData]);

      if (insertError) {
        console.error(`❌ Error creating new agent memory:`, insertError);
        saveError = insertError;
      } else {
        console.log(`✅ Created new agent memory record`);
      }
    }

    if (saveError) {
      return {
        success: false,
        error: saveError.message
      };
    }

    console.log(`✅ Successfully updated agent memory with lead statistics`);
    console.log(`📊 Updated counts - City: ${options.city}, Region: ${options.region}, Leads: +${options.leadsCount}`);
    console.log(`📈 Total leads accumulated: ${existingTotalLeads} → ${newTotalLeads} (+${options.leadsCount})`);
    console.log(`🎯 Lead generation context: Generated ${options.leadsCount} employee leads for companies in ${options.city}, ${options.region}`);
    if (options.segmentId) {
      console.log(`🎯 Segment-specific count updated for segment: ${options.segmentId}`);
    }

    return {
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating agent memory:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Helper function to safely store venue address data from Google Maps
 * Only saves data that comes clearly from Google Maps, no parsing or guessing
 */
function createVenueAddressObject(addressString: string, coordinates?: { lat: number; lng: number }): any {
  if (!addressString) return {};
  
  // ✅ Only save the exact address string from Google Maps
  // Don't try to parse or guess city, state, country, zipcode
  const addressObject: any = {
    full_address: addressString, // Store the complete address as received from Google Maps
  };
  
  // ✅ Only add coordinates if they come clearly from Google Maps
  if (coordinates && coordinates.lat && coordinates.lng) {
    addressObject.coordinates = {
      lat: coordinates.lat,
      lng: coordinates.lng
    };
  }
  
  return addressObject;
}

/**
 * Create companies with upsert functionality
 */
export async function createCompaniesFromVenuesActivity(
  options: {
    site_id: string;
    venues: VenueData[];
    userId?: string;
    additionalData?: any;
  }
): Promise<{ success: boolean; companies?: any[]; error?: string }> {
  try {
    // Convert venues to companies
    const companies = convertVenuesToCompanies(options.venues);
    
    if (companies.length === 0) {
      return {
        success: true,
        companies: [],
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    const createdCompanies = [];
    
    for (const company of companies) {
      try {
        // Create the address object using only Google Maps data
        const addressJson = createVenueAddressObject(company.address, company.coordinates);
        
        // Prepare company data for database (now using properly mapped values)
        const companyData = {
          name: company.name,
          website: company.website || null,
          industry: company.industry || null,
          description: company.description || null,
          address: addressJson, // ✅ Storing only Google Maps address data without parsing
          phone: company.phone || null,
          email: company.email || null,
          size: company.size || null,
          employees_count: company.employees_count || null,
          business_hours: company.opening_hours || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // First, check if company already exists (just by name since site_id doesn't exist)
        const { data: existingCompany, error: selectError } = await supabaseServiceRole
          .from('companies')
          .select('*')
          .eq('name', company.name)
          .maybeSingle();

        if (selectError) {
          logger.error('❌ Error checking existing company', {
            error: selectError.message,
            companyName: company.name
          });
        }

        let result;
        
        if (existingCompany) {
          // Update existing company
          const { data: updateData, error: updateError } = await supabaseServiceRole
            .from('companies')
            .update({
              ...companyData,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingCompany.id)
            .select()
            .single();

          if (updateError) {
            logger.error('❌ Failed to update existing company', {
              error: updateError.message,
              companyName: company.name
            });
            continue;
          }

          result = updateData;
          logger.info(`✅ Company updated: ${company.name}`, {
            companyId: result.id,
            hasAddressJson: !!addressJson && Object.keys(addressJson).length > 0
          });
        } else {
          // Create new company
          const { data: insertData, error: insertError } = await supabaseServiceRole
            .from('companies')
            .insert(companyData)
            .select()
            .single();

          if (insertError) {
            logger.error('❌ Failed to create new company', {
              error: insertError.message,
              companyName: company.name
            });
            continue;
          }

          result = insertData;
          logger.info(`✅ Company created: ${company.name}`, {
            companyId: result.id,
            hasAddressJson: !!addressJson && Object.keys(addressJson).length > 0
          });
        }

        createdCompanies.push(result);

      } catch (companyError) {
        const errorMessage = companyError instanceof Error ? companyError.message : String(companyError);
        logger.error('❌ Exception creating company', {
          error: errorMessage,
          companyName: company.name
        });
        continue;
      }
    }

    logger.info('✅ Companies creation completed', {
      totalVenues: options.venues.length,
      companiesCreated: createdCompanies.length
    });

    return {
      success: true,
      companies: createdCompanies,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage
    };
  }
} 

/**
 * Activity to upsert failed venue names in system_memories
 * This is used when deep research doesn't produce results to track venues that failed
 */
export async function upsertVenueFailedActivity(options: {
  site_id: string;
  city: string;
  region?: string;
  venueName: string;
  userId?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { site_id, city, region, venueName, userId } = options;

    logger.info('🔄 Starting venue failed upsert', {
      siteId: site_id,
      city,
      region,
      venueName,
      userId
    });

    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      return {
        success: false,
        error: 'Database not connected'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Create the key in format 'city:region' or just 'city' if no region
    const key = region ? `${city}:${region}` : city;

    // First, get existing data to append the new venue name
    const { data: existingData } = await supabaseServiceRole
      .from('system_memories')
      .select('data')
      .eq('site_id', site_id)
      .eq('system_type', 'venue_failed_names')
      .eq('key', key)
      .single();

    let excludedNames: string[] = [];
    
    if (existingData && existingData.data && existingData.data.excludedNames) {
      excludedNames = existingData.data.excludedNames;
    }

    // Add the new venue name if it's not already in the list
    if (!excludedNames.includes(venueName)) {
      excludedNames.push(venueName);
    }

    // Prepare the data object
    const dataObject = {
      excludedNames: excludedNames
    };

    // Prepare the metadata object
    const metadataObject = {
      source: 'venue_search',
      auto_generated: true
    };

    // Execute the upsert using direct SQL as per the provided query
    const { error: upsertError } = await supabaseServiceRole
      .from('system_memories')
      .upsert({
        site_id: site_id,
        system_type: 'venue_failed_names',
        key: key,
        data: dataObject,
        metadata: metadataObject,
        updated_at: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        access_count: 0,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days from now
      }, {
        onConflict: 'site_id,system_type,key'
      });

    if (upsertError) {
      logger.error('❌ Failed to upsert venue failed memory', {
        error: upsertError.message,
        siteId: site_id,
        key,
        venueName
      });
      return {
        success: false,
        error: `Failed to upsert venue failed memory: ${upsertError.message}`
      };
    }

    logger.info('✅ Venue failed memory upserted successfully', {
      siteId: site_id,
      key,
      venueName,
      totalExcludedNames: excludedNames.length
    });

    return {
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error in upsertVenueFailedActivity', {
      error: errorMessage,
      options
    });
    return {
      success: false,
      error: errorMessage
    };
  }
} 