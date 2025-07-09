"use strict";
/**
 * Activities specific for Lead Generation Workflow
 *
 * This file contains activities for:
 * - Calling the lead generation API
 * - Creating/validating leads from research results
 * - Managing lead generation processes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.callRegionSearchApiActivity = callRegionSearchApiActivity;
exports.callRegionVenuesApiActivity = callRegionVenuesApiActivity;
exports.callLeadGenerationApiActivity = callLeadGenerationApiActivity;
exports.createLeadsFromResearchActivity = createLeadsFromResearchActivity;
exports.convertVenuesToCompanies = convertVenuesToCompanies;
exports.createCompaniesFromVenuesActivity = createCompaniesFromVenuesActivity;
const logger_1 = require("../../lib/logger");
const apiService_1 = require("../services/apiService");
/**
 * Activity to call the region search API
 */
async function callRegionSearchApiActivity(options) {
    try {
        logger_1.logger.info('🌍 Starting region search API call', {
            site_id: options.site_id,
            userId: options.userId
        });
        const requestBody = {
            site_id: options.site_id,
            userId: options.userId,
            ...options.additionalData
        };
        console.log('📤 Sending region search request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/sales/regionSearch', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ Region search API call failed', {
                error: response.error,
                site_id: options.site_id
            });
            return {
                success: false,
                error: response.error?.message || 'Failed to call region search API'
            };
        }
        const data = response.data;
        // Extract business_types and location data
        const businessTypes = data?.data?.business_types || data?.business_types || data?.businessTypes;
        const targetCity = data?.data?.target_city || data?.target_city || data?.targetCity;
        const targetRegion = data?.data?.target_region || data?.target_region || data?.targetRegion;
        logger_1.logger.info('✅ Region search API call successful', {
            site_id: options.site_id,
            hasBusinessTypes: !!businessTypes,
            businessTypesCount: Array.isArray(businessTypes) ? businessTypes.length : 0,
            hasTargetCity: !!targetCity,
            hasTargetRegion: !!targetRegion
        });
        return {
            success: true,
            business_types: businessTypes,
            targetCity,
            targetRegion,
            data: data?.data || data,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Region search API call exception', {
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
 * Activity to call the region venues API
 */
async function callRegionVenuesApiActivity(options) {
    try {
        logger_1.logger.info('🏢 Starting region venues API call', {
            site_id: options.site_id,
            userId: options.userId,
            searchTerm: options.searchTerm,
            city: options.city,
            region: options.region
        });
        const requestBody = {
            siteId: options.site_id,
            userId: options.userId,
            searchTerm: options.searchTerm,
            city: options.city,
            region: options.region,
            maxVenues: options.maxVenues || 15,
            priority: options.priority || 'high',
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
        const response = await apiService_1.apiService.post('/api/agents/sales/regionVenues', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ Region venues API call failed', {
                error: response.error,
                site_id: options.site_id
            });
            return {
                success: false,
                error: response.error?.message || 'Failed to call region venues API'
            };
        }
        const data = response.data;
        logger_1.logger.info('✅ Region venues API call successful', {
            site_id: options.site_id,
            venueCount: data?.venueCount || 0,
            city: data?.city,
            region: data?.region
        });
        return {
            success: true,
            data: data,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Region venues API call exception', {
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
async function callLeadGenerationApiActivity(options) {
    try {
        logger_1.logger.info('🔥 Starting lead generation API call', {
            site_id: options.site_id,
            userId: options.userId
        });
        const requestBody = {
            site_id: options.site_id,
            userId: options.userId,
            ...options.additionalData
        };
        console.log('📤 Sending lead generation request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/sales/leadGeneration', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ Lead generation API call failed', {
                error: response.error,
                site_id: options.site_id
            });
            return {
                success: false,
                error: response.error?.message || 'Failed to call lead generation API'
            };
        }
        const data = response.data;
        // Extract search_topic, target_city, and target_region from data
        const searchTopic = data?.data?.search_topic || data?.search_topic || data?.searchTopic;
        const targetCity = data?.data?.target_city || data?.target_city || data?.targetCity;
        const targetRegion = data?.data?.target_region || data?.target_region || data?.targetRegion;
        logger_1.logger.info('✅ Lead generation API call successful', {
            site_id: options.site_id,
            hasSearchTopic: !!searchTopic,
            hasTargetCity: !!targetCity,
            hasTargetRegion: !!targetRegion,
            hasPrompt: !!data?.prompt,
            hasData: !!data?.data
        });
        return {
            success: true,
            searchTopic,
            targetCity,
            targetRegion,
            prompt: data?.prompt,
            data: data?.data || data,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Lead generation API call exception', {
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
 * Activity to create/validate leads from research results
 */
async function createLeadsFromResearchActivity(options) {
    try {
        logger_1.logger.info('👥 Starting lead creation/validation process', {
            site_id: options.site_id,
            leadsCount: options.leads.length,
            createMode: options.create || false
        });
        const validationResults = [];
        const errors = [];
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
                        const createResult = await createSingleLead(lead, options.site_id, options.userId);
                        if (createResult.success) {
                            leadsCreated++;
                            logger_1.logger.info(`✅ Lead created successfully: ${lead.name || lead.email}`, {
                                site_id: options.site_id,
                                leadId: createResult.leadId
                            });
                        }
                        else {
                            errors.push(`Failed to create lead ${lead.name || lead.email}: ${createResult.error}`);
                        }
                    }
                    else {
                        logger_1.logger.info(`✅ Lead validated successfully: ${lead.name || lead.email}`, {
                            site_id: options.site_id,
                            validationMode: true
                        });
                    }
                }
                else {
                    errors.push(`Lead validation failed for ${lead.name || lead.email}: ${validation.errors.join(', ')}`);
                }
            }
            catch (leadError) {
                const leadErrorMessage = leadError instanceof Error ? leadError.message : String(leadError);
                errors.push(`Exception processing lead ${index}: ${leadErrorMessage}`);
            }
        }
        const result = {
            success: errors.length === 0 || leadsValidated > 0,
            leadsCreated,
            leadsValidated,
            leads: options.leads,
            errors: errors.length > 0 ? errors : undefined,
            validationResults
        };
        logger_1.logger.info(`📊 Lead creation/validation completed`, {
            site_id: options.site_id,
            leadsValidated,
            leadsCreated,
            errorsCount: errors.length,
            createMode: options.create || false
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Lead creation/validation exception', {
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
function validateLeadData(lead) {
    const errors = [];
    const warnings = [];
    // Required fields validation
    if (!lead.name || typeof lead.name !== 'string' || lead.name.trim() === '') {
        errors.push('Name is required and must be a non-empty string');
    }
    if (!lead.email || typeof lead.email !== 'string' || lead.email.trim() === '') {
        errors.push('Email is required and must be a non-empty string');
    }
    else {
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(lead.email)) {
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
    }
    else if (lead.web && lead.web.trim() !== '') {
        // Basic URL validation
        try {
            new URL(lead.web);
        }
        catch {
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
async function createSingleLead(lead, site_id, userId) {
    try {
        // Import supabase client
        const supabase = (await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')))).default;
        // Prepare lead data for database
        const leadData = {
            name: lead.name,
            email: lead.email,
            phone: lead.telephone || null,
            company_name: lead.company_name || null,
            address: lead.address || null,
            website: lead.web || null,
            position: lead.position || null,
            site_id: site_id,
            user_id: userId || null,
            status: 'new',
            origin: 'lead_generation_workflow',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase
            .from('leads')
            .insert([leadData])
            .select()
            .single();
        if (error) {
            logger_1.logger.error('❌ Failed to create lead in database', {
                error: error.message,
                site_id,
                leadEmail: lead.email
            });
            return {
                success: false,
                error: error.message
            };
        }
        return {
            success: true,
            leadId: data.id
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception creating lead in database', {
            error: errorMessage,
            site_id,
            leadEmail: lead.email
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
function convertVenuesToCompanies(venues) {
    const companies = [];
    for (const venue of venues) {
        try {
            // Extract industry from types
            const industry = venue.types && venue.types.length > 0
                ? venue.types.filter(type => type !== 'point_of_interest' && type !== 'establishment')[0] || 'Business'
                : 'Business';
            // Calculate approximate employees count based on rating and reviews
            let employeesCount = null;
            if (venue.total_ratings && venue.total_ratings > 0) {
                // Simple estimation: more reviews = larger business
                if (venue.total_ratings >= 100)
                    employeesCount = 50;
                else if (venue.total_ratings >= 50)
                    employeesCount = 20;
                else if (venue.total_ratings >= 20)
                    employeesCount = 10;
                else if (venue.total_ratings >= 10)
                    employeesCount = 5;
                else
                    employeesCount = 3;
            }
            const company = {
                name: venue.name,
                website: venue.website || null,
                industry: industry,
                description: venue.description || null,
                location: venue.address,
                address: venue.address,
                phone: venue.phone || venue.international_phone || null,
                email: null, // Will be populated later through research
                size: employeesCount ? `${employeesCount} employees` : null,
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
        }
        catch (error) {
            console.error(`⚠️ Error converting venue ${venue.name} to company:`, error);
        }
    }
    console.log(`📊 Converted ${companies.length} venues to companies`);
    return companies;
}
/**
 * Create companies with upsert functionality
 */
async function createCompaniesFromVenuesActivity(options) {
    try {
        logger_1.logger.info('🏢 Starting companies creation from venues', {
            site_id: options.site_id,
            venuesCount: options.venues.length
        });
        // Convert venues to companies
        const companies = convertVenuesToCompanies(options.venues);
        if (companies.length === 0) {
            return {
                success: true,
                companies: [],
            };
        }
        // Import supabase client
        const supabase = (await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')))).default;
        const createdCompanies = [];
        for (const company of companies) {
            try {
                // Prepare company data for database
                const companyData = {
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
                    types: company.types,
                    coordinates: company.coordinates,
                    opening_hours: company.opening_hours,
                    amenities: company.amenities,
                    reviews: company.reviews,
                    photos: company.photos,
                    venue_id: company.venue_id,
                    site_id: options.site_id,
                    user_id: options.userId || null,
                    status: 'active',
                    origin: 'region_venues_api',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                // Use upsert to handle duplicates (based on name and location)
                const { data, error } = await supabase
                    .from('companies')
                    .upsert(companyData, {
                    onConflict: 'name,location',
                    ignoreDuplicates: false
                })
                    .select()
                    .single();
                if (error) {
                    logger_1.logger.error('❌ Failed to create/update company in database', {
                        error: error.message,
                        site_id: options.site_id,
                        companyName: company.name
                    });
                    continue;
                }
                createdCompanies.push(data);
                logger_1.logger.info(`✅ Company created/updated: ${company.name}`, {
                    site_id: options.site_id,
                    companyId: data.id
                });
            }
            catch (companyError) {
                const errorMessage = companyError instanceof Error ? companyError.message : String(companyError);
                logger_1.logger.error('❌ Exception creating company', {
                    error: errorMessage,
                    site_id: options.site_id,
                    companyName: company.name
                });
                continue;
            }
        }
        logger_1.logger.info('✅ Companies creation completed', {
            site_id: options.site_id,
            totalVenues: options.venues.length,
            companiesCreated: createdCompanies.length
        });
        return {
            success: true,
            companies: createdCompanies,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception creating companies from venues', {
            error: errorMessage,
            site_id: options.site_id
        });
        return {
            success: false,
            error: errorMessage
        };
    }
}
