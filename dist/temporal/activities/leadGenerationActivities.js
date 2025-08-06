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
exports.searchLeadsByCompanyCityActivity = searchLeadsByCompanyCityActivity;
exports.callRegionVenuesApiActivity = callRegionVenuesApiActivity;
exports.callRegionVenuesWithMultipleSearchTermsActivity = callRegionVenuesWithMultipleSearchTermsActivity;
exports.callLeadGenerationApiActivity = callLeadGenerationApiActivity;
exports.saveLeadsFromDeepResearchActivity = saveLeadsFromDeepResearchActivity;
exports.createLeadsFromResearchActivity = createLeadsFromResearchActivity;
exports.createSingleLead = createSingleLead;
exports.convertVenuesToCompanies = convertVenuesToCompanies;
exports.updateMemoryActivity = updateMemoryActivity;
exports.findSalesCrmAgentActivity = findSalesCrmAgentActivity;
exports.updateAgentMemoryWithLeadStatsActivity = updateAgentMemoryWithLeadStatsActivity;
exports.createCompaniesFromVenuesActivity = createCompaniesFromVenuesActivity;
exports.upsertVenueFailedActivity = upsertVenueFailedActivity;
exports.notifyNewLeadsActivity = notifyNewLeadsActivity;
exports.determineMaxVenuesActivity = determineMaxVenuesActivity;
const logger_1 = require("../../lib/logger");
const apiService_1 = require("../services/apiService");
const supabaseService_1 = require("../services/supabaseService");
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
            throw new Error(`Failed to call region search API: ${response.error?.message || 'Unknown error'}`);
        }
        const data = response.data;
        // Extract business_types, location data, and target_segment_id
        const businessTypes = data?.data?.business_types || data?.business_types || data?.businessTypes;
        const targetCity = data?.data?.target_city || data?.target_city || data?.targetCity;
        const targetRegion = data?.data?.target_region || data?.target_region || data?.targetRegion;
        const targetSegmentId = data?.data?.target_segment_id || data?.target_segment_id || data?.targetSegmentId;
        logger_1.logger.info('✅ Region search API call successful', {
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
 * Activity to search leads by company city
 * Returns company names of leads whose company address contains the specified city
 * Uses exact Google Maps address data without parsing or guessing
 */
async function searchLeadsByCompanyCityActivity(options) {
    try {
        logger_1.logger.info('🔍 Starting search for leads by company city and region', {
            site_id: options.site_id,
            city: options.city,
            region: options.region
        });
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return {
                success: false,
                error: 'Database not connected'
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
            logger_1.logger.error('❌ Error searching leads by company city', {
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
            logger_1.logger.error('❌ Error searching leads with company JSON', {
                error: jsonError.message,
                site_id: options.site_id
            });
            // Continue with company_id results only
        }
        const companyNames = new Set();
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
        logger_1.logger.info('✅ Successfully searched leads by company city', {
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception searching leads by company city', {
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
async function callRegionVenuesApiActivity(options) {
    try {
        logger_1.logger.info('🏢 Starting region venues API call', {
            site_id: options.site_id,
            userId: options.userId,
            searchTerm: options.searchTerm,
            city: options.city,
            region: options.region,
            country: options.country,
            maxVenues: options.maxVenues,
            excludeNamesCount: options.excludeNames?.length || 0
        });
        console.log(`🚨 URGENT DEBUG - callRegionVenuesApiActivity received searchTerm: "${options.searchTerm}"`);
        console.log(`🚨 URGENT DEBUG - callRegionVenuesApiActivity options:`, JSON.stringify(options, null, 2));
        const requestBody = {
            siteId: options.site_id,
            userId: options.userId,
            searchTerm: options.searchTerm,
            city: options.city,
            region: options.region,
            country: options.country, // Add country parameter to API request
            maxVenues: options.maxVenues || 20,
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
        const response = await apiService_1.apiService.post('/api/agents/sales/regionVenues', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ Region venues API call failed', {
                error: response.error,
                site_id: options.site_id
            });
            throw new Error(`Failed to call region venues API: ${response.error?.message || 'Unknown error'}`);
        }
        const data = response.data;
        logger_1.logger.info('✅ Region venues API call successful', {
            site_id: options.site_id,
            hasData: !!data,
            hasVenues: !!(data?.venues),
            venuesCount: data?.venues?.length || 0
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
 * Nueva actividad para llamar a la API de venues con búsquedas múltiples individuales
 * En lugar de pasar todos los business types en un search term, hace búsquedas individuales
 * Usa ciudad, región y país (si disponible) e intenta con cada business type si es necesario
 */
async function callRegionVenuesWithMultipleSearchTermsActivity(options) {
    try {
        logger_1.logger.info('🏢 Starting multiple search terms region venues API call', {
            site_id: options.site_id,
            userId: options.userId,
            businessTypesCount: options.businessTypes?.length || 0,
            city: options.city,
            region: options.region,
            country: options.country,
            maxVenues: options.maxVenues,
            targetVenueGoal: options.targetVenueGoal,
            excludeNamesCount: options.excludeNames?.length || 0
        });
        const businessTypes = options.businessTypes || [];
        console.log(`🚨 URGENT DEBUG callRegionVenuesWithMultipleSearchTermsActivity ENTRY`);
        console.log(`🚨 URGENT DEBUG received businessTypes:`, JSON.stringify(businessTypes, null, 2));
        console.log(`🚨 URGENT DEBUG businessTypes.length:`, businessTypes.length);
        if (businessTypes.length > 0) {
            console.log(`🚨 URGENT DEBUG businessTypes[0]:`, JSON.stringify(businessTypes[0], null, 2));
            console.log(`🚨 URGENT DEBUG businessTypes[0].name:`, businessTypes[0]?.name);
            console.log(`🚨 URGENT DEBUG typeof businessTypes[0].name:`, typeof businessTypes[0]?.name);
        }
        const targetVenueGoal = options.targetVenueGoal || options.maxVenues || 20;
        const allVenues = [];
        let totalApiCalls = 0;
        const searchResults = [];
        const combinedExcludeNames = [...(options.excludeNames || [])];
        console.log(`🎯 Target venue goal: ${targetVenueGoal} venues`);
        console.log(`🌍 Geographic fields: city="${options.city || 'none'}", region="${options.region || 'none'}", country="${options.country || 'none'}"`);
        console.log(`🏷️ Business types to search: ${businessTypes.map(bt => bt?.name || 'UNDEFINED').join(', ')}`);
        // Búsqueda inicial con el primer business type si está disponible
        if (businessTypes.length > 0) {
            const firstBusinessType = businessTypes[0];
            console.log(`🚨 URGENT DEBUG firstBusinessType:`, JSON.stringify(firstBusinessType, null, 2));
            // Verificación más robusta del acceso a la propiedad name
            const firstBusinessTypeName = firstBusinessType?.name || firstBusinessType?.business_type_name || 'UNKNOWN_BUSINESS_TYPE';
            console.log(`🚨 URGENT DEBUG firstBusinessTypeName: "${firstBusinessTypeName}"`);
            console.log(`🚨 URGENT DEBUG typeof firstBusinessTypeName: ${typeof firstBusinessTypeName}`);
            const firstSearchTerm = firstBusinessTypeName;
            console.log(`🚨 URGENT DEBUG firstSearchTerm FINAL: "${firstSearchTerm}"`);
            console.log(`🔍 Initial search with first business type: "${firstSearchTerm}" (no geographic concatenation - using separate fields)`);
            const firstSearchOptions = {
                site_id: options.site_id,
                userId: options.userId,
                searchTerm: firstSearchTerm,
                city: options.city,
                region: options.region,
                country: options.country, // Pass country parameter to API
                maxVenues: targetVenueGoal, // Intentar obtener todos los venues necesarios en la primera búsqueda
                priority: options.priority || 'high',
                excludeNames: combinedExcludeNames,
                additionalData: {
                    ...options.additionalData,
                    searchIteration: 1,
                    businessType: firstBusinessTypeName,
                    isMultipleSearchStrategy: true
                }
            };
            console.log(`🚨 URGENT DEBUG About to call callRegionVenuesApiActivity with:`);
            console.log(`🚨 URGENT DEBUG firstSearchOptions.searchTerm: "${firstSearchOptions.searchTerm}"`);
            console.log(`🚨 URGENT DEBUG firstSearchOptions:`, JSON.stringify(firstSearchOptions, null, 2));
            const firstResult = await callRegionVenuesApiActivity(firstSearchOptions);
            totalApiCalls++;
            if (firstResult.success && firstResult.data && firstResult.data.venues) {
                const venues = firstResult.data.venues;
                allVenues.push(...venues);
                // Agregar nombres de venues encontrados a la lista de exclusión para búsquedas futuras
                combinedExcludeNames.push(...venues.map(v => v.name));
                searchResults.push({
                    iteration: 1,
                    businessType: firstBusinessTypeName,
                    searchTerm: firstSearchTerm,
                    venuesFound: venues.length,
                    success: true
                });
                console.log(`✅ Initial search completed: ${venues.length} venues found`);
                console.log(`📊 Current total: ${allVenues.length}/${targetVenueGoal} venues`);
            }
            else {
                searchResults.push({
                    iteration: 1,
                    businessType: firstBusinessTypeName,
                    searchTerm: firstSearchTerm,
                    venuesFound: 0,
                    success: false,
                    error: firstResult.error
                });
                console.log(`⚠️ Initial search failed or returned no venues: ${firstResult.error}`);
            }
        }
        // Si no hemos alcanzado el objetivo, continuar con los demás business types
        if (allVenues.length < targetVenueGoal && businessTypes.length > 1) {
            console.log(`🔄 Need more venues (${allVenues.length}/${targetVenueGoal}), trying additional business types...`);
            for (let i = 1; i < businessTypes.length && allVenues.length < targetVenueGoal; i++) {
                const businessType = businessTypes[i];
                const businessTypeName = businessType?.name || businessType?.business_type_name || `UNKNOWN_BUSINESS_TYPE_${i}`;
                const searchTerm = businessTypeName;
                console.log(`🚨 URGENT DEBUG Additional search ${i + 1} businessTypeName: "${businessTypeName}"`);
                console.log(`🔍 Additional search ${i + 1}: "${searchTerm}" (no geographic concatenation - using separate fields)`);
                const remainingVenuesNeeded = targetVenueGoal - allVenues.length;
                const searchOptions = {
                    site_id: options.site_id,
                    userId: options.userId,
                    searchTerm: searchTerm,
                    city: options.city,
                    region: options.region,
                    country: options.country, // Pass country parameter to API
                    maxVenues: remainingVenuesNeeded, // Solo buscar los venues que faltan
                    priority: options.priority || 'high',
                    excludeNames: combinedExcludeNames,
                    additionalData: {
                        ...options.additionalData,
                        searchIteration: i + 1,
                        businessType: businessTypeName,
                        isMultipleSearchStrategy: true
                    }
                };
                console.log(`🚨 URGENT DEBUG About to call callRegionVenuesApiActivity (additional search ${i + 1}) with:`);
                console.log(`🚨 URGENT DEBUG searchOptions.searchTerm: "${searchOptions.searchTerm}"`);
                const result = await callRegionVenuesApiActivity(searchOptions);
                totalApiCalls++;
                if (result.success && result.data && result.data.venues) {
                    const venues = result.data.venues;
                    const newVenues = venues.filter(v => !allVenues.some(existing => existing.name === v.name));
                    if (newVenues.length > 0) {
                        allVenues.push(...newVenues);
                        combinedExcludeNames.push(...newVenues.map(v => v.name));
                        console.log(`✅ Additional search ${i + 1} completed: ${newVenues.length} new venues found`);
                        console.log(`📊 Current total: ${allVenues.length}/${targetVenueGoal} venues`);
                    }
                    else {
                        console.log(`⚠️ Additional search ${i + 1} found no new venues (all were duplicates)`);
                    }
                    searchResults.push({
                        iteration: i + 1,
                        businessType: businessTypeName,
                        searchTerm: searchTerm,
                        venuesFound: newVenues.length,
                        totalFoundBefore: venues.length,
                        success: true
                    });
                }
                else {
                    searchResults.push({
                        iteration: i + 1,
                        businessType: businessTypeName,
                        searchTerm: searchTerm,
                        venuesFound: 0,
                        success: false,
                        error: result.error
                    });
                    console.log(`❌ Additional search ${i + 1} failed: ${result.error}`);
                }
                // Pequeña pausa entre búsquedas para evitar rate limiting
                if (i < businessTypes.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        const finalVenueCount = allVenues.length;
        console.log(`📊 Multiple search strategy completed:`);
        console.log(`   - Total API calls made: ${totalApiCalls}`);
        console.log(`   - Business types searched: ${businessTypes.length}`);
        console.log(`   - Final venues found: ${finalVenueCount}`);
        console.log(`   - Target goal achieved: ${finalVenueCount >= targetVenueGoal ? '✅' : '❌'} (${finalVenueCount}/${targetVenueGoal})`);
        // Log resumen de resultados por búsqueda
        console.log(`📋 Search results summary:`);
        searchResults.forEach((result, index) => {
            const status = result.success ? (result.venuesFound > 0 ? '✅' : '⚠️') : '❌';
            console.log(`   ${index + 1}. ${status} ${result.businessType}: ${result.venuesFound} venues`);
        });
        if (finalVenueCount === 0) {
            const errorMessage = `No venues found after ${totalApiCalls} search attempts across ${businessTypes.length} business types`;
            logger_1.logger.error('❌ Multiple search strategy failed - no venues found', {
                site_id: options.site_id,
                businessTypesSearched: businessTypes.length,
                totalApiCalls,
                searchResults
            });
            return {
                success: false,
                error: errorMessage
            };
        }
        // Crear respuesta en el formato esperado
        const responseData = {
            searchTerm: `Multiple searches: ${businessTypes.map(bt => bt.name).join(', ')} (geographic fields passed separately)`,
            city: options.city,
            region: options.region,
            venueCount: finalVenueCount,
            venues: allVenues,
            timestamp: new Date().toISOString(),
            // Metadatos adicionales sobre la estrategia de búsqueda múltiple
            multipleSearchMetadata: {
                totalApiCalls,
                businessTypesSearched: businessTypes.length,
                targetVenueGoal,
                goalAchieved: finalVenueCount >= targetVenueGoal,
                searchResults,
                country: options.country || null,
                strategy: 'individual_business_type_searches'
            }
        };
        logger_1.logger.info('✅ Multiple search strategy region venues API call successful', {
            site_id: options.site_id,
            finalVenueCount,
            businessTypesSearched: businessTypes.length,
            totalApiCalls,
            goalAchieved: finalVenueCount >= targetVenueGoal
        });
        return {
            success: true,
            data: responseData
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception in multiple search terms region venues API call', {
            error: errorMessage,
            site_id: options.site_id,
            businessTypesCount: options.businessTypes?.length || 0
        });
        return {
            success: false,
            error: errorMessage
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
            throw new Error(`Failed to call lead generation API: ${response.error?.message || 'Unknown error'}`);
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
        logger_1.logger.info('✅ Lead generation API call successful', {
            site_id: options.site_id,
            hasSearchTopic: !!searchTopic,
            hasTargetCity: !!targetCity,
            hasTargetRegion: !!targetRegion,
            hasPrompt: !!responseData?.prompt,
            hasData: !!responseData?.data
        });
        // Validate that we have the essential data
        if (!searchTopic) {
            logger_1.logger.error('❌ Lead generation API response missing searchTopic', {
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
 * Activity to save leads generated from deep research
 * This is a visible workflow step that occurs after deep research and before moving to next venue
 */
async function saveLeadsFromDeepResearchActivity(options) {
    try {
        logger_1.logger.info('💾 Starting to save leads from deep research', {
            site_id: options.site_id,
            leadsCount: options.leads.length,
            companyName: options.company?.name,
            createMode: options.create || false
        });
        if (options.leads.length === 0) {
            logger_1.logger.info('⚠️ No leads to save from deep research', {
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
        const createLeadsOptions = {
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
            logger_1.logger.info('✅ Successfully saved leads from deep research', {
                site_id: options.site_id,
                companyName: options.company?.name,
                leadsCreated: result.leadsCreated,
                leadsValidated: result.leadsValidated
            });
            console.log(`✅ Successfully saved ${result.leadsCreated || 0} leads from deep research for company: ${options.company?.name}`);
            console.log(`📊 Validation results: ${result.leadsValidated || 0} leads validated`);
        }
        else {
            logger_1.logger.error('❌ Failed to save leads from deep research', {
                site_id: options.site_id,
                companyName: options.company?.name,
                error: result.error,
                errorsCount: result.errors?.length || 0
            });
        }
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception saving leads from deep research', {
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
                        const createResult = await createSingleLead(lead, options.site_id, options.userId, options.additionalData?.company?.id, options.segment_id);
                        if (createResult.success) {
                            leadsCreated++;
                            logger_1.logger.info(`✅ Lead created successfully: ${lead.name || lead.email}`, {
                                site_id: options.site_id,
                                leadId: createResult.leadId
                            });
                        }
                        else {
                            // Check if error is due to duplicate (expected behavior)
                            if (createResult.error && createResult.error.includes('already exists')) {
                                console.log(`🔄 Skipping duplicate lead: ${lead.name || lead.email} - ${createResult.error}`);
                                logger_1.logger.info(`🔄 Duplicate lead skipped: ${lead.name || lead.email}`, {
                                    site_id: options.site_id,
                                    reason: createResult.error
                                });
                                // Don't count as error since duplicates are expected and handled
                            }
                            else {
                                // This is a real error (database issues, etc.)
                                errors.push(`Failed to create lead ${lead.name || lead.email}: ${createResult.error}`);
                                logger_1.logger.error(`❌ Failed to create lead: ${lead.name || lead.email}`, {
                                    site_id: options.site_id,
                                    error: createResult.error
                                });
                            }
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
                    }
                    else {
                        console.error(`❌ Failed to update agent memory: ${updateMemoryResult.error}`);
                    }
                }
                catch (memoryError) {
                    console.error(`❌ Exception updating agent memory:`, memoryError);
                }
            }
        }
        // Collect lead names for notification (only for successfully created leads)
        const createdLeadNames = [];
        if (options.create && leadsCreated > 0) {
            for (const validationResult of validationResults) {
                if (validationResult.valid && validationResult.lead.name) {
                    createdLeadNames.push(validationResult.lead.name);
                }
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
        // Note: Notification is now sent at the workflow level to consolidate all leads
        // Individual lead notifications are disabled to avoid duplicates
        if (options.create && createdLeadNames.length > 0) {
            console.log(`📝 Leads created: ${createdLeadNames.length} (notification will be sent at workflow completion)`);
            console.log(`📋 Lead names: ${createdLeadNames.join(', ')}`);
        }
        logger_1.logger.info(`📊 Lead creation/validation completed`, {
            site_id: options.site_id,
            leadsValidated,
            leadsCreated,
            errorsCount: errors.length,
            createMode: options.create || false,
            notificationSent: createdLeadNames.length > 0
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
async function createSingleLead(lead, site_id, userId, companyId, // Add company_id parameter
segmentId // Add segment_id parameter
) {
    try {
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // ✅ STEP 1: Check for duplicate leads by name and email
        console.log(`🔍 Checking for duplicate leads: name="${lead.name}", email="${lead.email || 'none'}"`);
        let duplicateQuery = supabaseServiceRole
            .from('leads')
            .select('id, name, email, phone')
            .eq('site_id', site_id);
        // Check for duplicates by name (always required)
        duplicateQuery = duplicateQuery.eq('name', lead.name);
        // Also check by email if provided
        if (lead.email) {
            // Use OR condition: same name OR same email (both for same site)
            const { data: duplicateLeads, error: duplicateError } = await supabaseServiceRole
                .from('leads')
                .select('id, name, email, phone')
                .eq('site_id', site_id)
                .or(`name.eq.${lead.name},email.eq.${lead.email}`);
            if (duplicateError) {
                logger_1.logger.error('❌ Error checking for duplicate leads', {
                    error: duplicateError.message,
                    site_id,
                    leadName: lead.name,
                    leadEmail: lead.email
                });
                // Continue with creation despite error (fail open)
            }
            else if (duplicateLeads && duplicateLeads.length > 0) {
                const duplicate = duplicateLeads[0];
                const duplicateReason = duplicate.name === lead.name ? 'name' : 'email';
                console.log(`⚠️ Duplicate lead found by ${duplicateReason}: ${duplicate.name} (${duplicate.email || 'no email'}) - ID: ${duplicate.id}`);
                logger_1.logger.warn('🔄 Skipping duplicate lead creation', {
                    site_id,
                    existingLeadId: duplicate.id,
                    existingName: duplicate.name,
                    existingEmail: duplicate.email,
                    newName: lead.name,
                    newEmail: lead.email,
                    duplicateReason
                });
                return {
                    success: false,
                    error: `Lead already exists with same ${duplicateReason}: ${duplicate.name}${duplicate.email ? ` (${duplicate.email})` : ''}`
                };
            }
        }
        else {
            // Only check by name if no email provided
            const { data: duplicateLeads, error: duplicateError } = await duplicateQuery;
            if (duplicateError) {
                logger_1.logger.error('❌ Error checking for duplicate leads by name', {
                    error: duplicateError.message,
                    site_id,
                    leadName: lead.name
                });
                // Continue with creation despite error (fail open)
            }
            else if (duplicateLeads && duplicateLeads.length > 0) {
                const duplicate = duplicateLeads[0];
                console.log(`⚠️ Duplicate lead found by name: ${duplicate.name} - ID: ${duplicate.id}`);
                logger_1.logger.warn('🔄 Skipping duplicate lead creation', {
                    site_id,
                    existingLeadId: duplicate.id,
                    existingName: duplicate.name,
                    newName: lead.name,
                    duplicateReason: 'name'
                });
                return {
                    success: false,
                    error: `Lead already exists with same name: ${duplicate.name}`
                };
            }
        }
        console.log(`✅ No duplicates found, proceeding with lead creation`);
        // ✅ STEP 2: Prepare lead data for database
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
        }
        else {
            console.log(`⚠️ No company_id provided for lead ${lead.name || lead.email}`);
        }
        if (segmentId) {
            console.log(`🎯 Assigning segment_id ${segmentId} to lead ${lead.name || lead.email}`);
        }
        else {
            console.log(`⚠️ No segment_id provided for lead ${lead.name || lead.email}`);
        }
        // ✅ STEP 3: Insert the lead
        const { data, error } = await supabaseServiceRole
            .from('leads')
            .insert([leadData])
            .select()
            .single();
        if (error) {
            logger_1.logger.error('❌ Failed to create lead in database', {
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
        logger_1.logger.info('✅ Lead created successfully with company_id', {
            leadId: data.id,
            leadEmail: lead.email,
            companyId: companyId || 'none'
        });
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
function convertVenuesToCompanies(venues, targetCity) {
    const companies = [];
    // Helper function to map venue types to allowed industry values
    const mapVenueTypeToIndustry = (types) => {
        if (!types || types.length === 0)
            return 'other';
        const typeMap = {
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
    const mapEmployeeCountToSize = (count) => {
        if (!count)
            return '1-10'; // Default for small businesses
        if (count <= 10)
            return '1-10';
        else if (count <= 50)
            return '11-50';
        else if (count <= 200)
            return '51-200';
        else if (count <= 500)
            return '201-500';
        else if (count <= 1000)
            return '501-1000';
        else if (count <= 5000)
            return '1001-5000';
        else if (count <= 10000)
            return '5001-10000';
        else
            return '10001+';
    };
    for (const venue of venues) {
        try {
            // Map venue types to valid industry
            const industry = mapVenueTypeToIndustry(venue.types || []);
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
            // Map employee count to valid size
            const size = mapEmployeeCountToSize(employeesCount);
            const company = {
                name: venue.name,
                website: venue.website || null,
                industry: industry,
                description: venue.description || null,
                location: venue.address,
                address: venue.address,
                city: targetCity || null, // ✅ Always use target_city from research topic
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
        }
        catch {
        }
    }
    return companies;
}
/**
 * Activity to update agent memory with lead generation statistics
 * This is a visible workflow step that consolidates the entire memory update process
 */
async function updateMemoryActivity(options) {
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
        }
        else {
            console.error(`❌ Failed to update agent memory: ${updateMemoryResult.error}`);
        }
        return updateMemoryResult;
    }
    catch (error) {
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
async function findSalesCrmAgentActivity(siteId) {
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return {
                success: false,
                error: 'Database not connected'
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
            }
            else {
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
            }
            else {
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
    }
    catch (error) {
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
async function updateAgentMemoryWithLeadStatsActivity(options) {
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return {
                success: false,
                error: 'Database not connected'
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
        let leadsData = {};
        if (currentMemory && currentMemory.length > 0) {
            // Use existing data structure
            leadsData = currentMemory[0].data || {};
        }
        else {
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
            }
            else {
                console.log(`✅ Updated existing agent memory record`);
            }
        }
        else {
            // Create new memory
            const { error: insertError } = await supabaseServiceRole
                .from('agent_memories')
                .insert([memoryData]);
            if (insertError) {
                console.error(`❌ Error creating new agent memory:`, insertError);
                saveError = insertError;
            }
            else {
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating agent memory:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Helper function to parse Google Maps address format
 * Example: "Agustín Arroyo Chagoyan 501, Alameda, 38050 Celaya, Gto., Mexico"
 * Returns: { address1: "Agustín Arroyo Chagoyan 501, Alameda", city: "Celaya", state: "Gto.", country: "Mexico", zip: "38050" }
 */
function parseGoogleMapsAddress(addressString, targetCity) {
    if (!addressString)
        return {};
    try {
        // Split the address by commas
        const parts = addressString.split(',').map(part => part.trim());
        if (parts.length < 2) {
            // If we can't parse, just store the full address
            return {
                full_address: addressString,
                address1: addressString,
                city: targetCity || null, // Always use target_city if available
            };
        }
        // Initialize result object
        const parsed = {
            full_address: addressString
        };
        // Last part is typically country
        if (parts.length >= 1) {
            parsed.country = parts[parts.length - 1];
        }
        // Second to last is typically state/region (if we have enough parts)
        if (parts.length >= 2) {
            parsed.state = parts[parts.length - 2];
        }
        // ✅ FIXED: New approach - first find where zip code and city are, then everything before goes to address1
        let zipPartIndex = -1;
        let cityPartIndex = -1;
        // First pass: identify which parts contain zip code
        for (let i = 0; i < parts.length - 2; i++) {
            const part = parts[i];
            const zipMatch = part.match(/\b(\d{4,6})\b/);
            if (zipMatch && zipPartIndex === -1) {
                parsed.zip = zipMatch[1];
                zipPartIndex = i;
                // Check if the remaining part after removing zip contains city info
                const remainingPart = part.replace(zipMatch[0], '').trim();
                if (remainingPart) {
                    cityPartIndex = i; // City is in the same part as zip
                }
                break;
            }
        }
        // Second pass: identify city if not found with zip
        if (cityPartIndex === -1) {
            for (let i = 0; i < parts.length - 2; i++) {
                const part = parts[i];
                // Skip the zip part since we already processed it
                if (i === zipPartIndex)
                    continue;
                if (targetCity && part.toLowerCase().includes(targetCity.toLowerCase())) {
                    cityPartIndex = i;
                    break;
                }
                else if (!targetCity && !/\d/.test(part) && part.length > 2) {
                    // If no target_city, find a part that looks like a city name (no numbers)
                    cityPartIndex = i;
                    break;
                }
            }
        }
        // ✅ FIXED: Everything BEFORE the zip/city parts goes to address1
        const address1Parts = [];
        const maxIndex = Math.max(zipPartIndex, cityPartIndex);
        for (let i = 0; i < Math.min(maxIndex === -1 ? parts.length - 2 : maxIndex, parts.length - 2); i++) {
            // Skip if this is the zip part and we extracted city from elsewhere
            if (i === zipPartIndex && cityPartIndex !== zipPartIndex) {
                // Just the part before zip code in this segment
                const part = parts[i];
                const zipMatch = part.match(/\b(\d{4,6})\b/);
                if (zipMatch) {
                    const beforeZip = part.substring(0, part.indexOf(zipMatch[0])).trim();
                    if (beforeZip) {
                        address1Parts.push(beforeZip);
                    }
                }
            }
            else if (i !== cityPartIndex) {
                // This part goes entirely to address1
                address1Parts.push(parts[i]);
            }
        }
        // Handle city assignment
        if (targetCity) {
            parsed.city = targetCity; // Always use target_city if provided
        }
        else if (cityPartIndex !== -1) {
            if (cityPartIndex === zipPartIndex) {
                // City is in the same part as zip code
                const part = parts[cityPartIndex];
                const zipMatch = part.match(/\b(\d{4,6})\b/);
                if (zipMatch) {
                    const remainingPart = part.replace(zipMatch[0], '').trim();
                    parsed.city = remainingPart || null;
                }
            }
            else {
                // City is in a separate part
                parsed.city = parts[cityPartIndex];
            }
        }
        // Build address1 from collected parts
        if (address1Parts.length > 0) {
            parsed.address1 = address1Parts.join(', ');
        }
        console.log(`🗺️ Parsed address: "${addressString}" → ${JSON.stringify(parsed)}`);
        return parsed;
    }
    catch (error) {
        console.error(`❌ Error parsing address: ${addressString}`, error);
        // Fallback: return basic structure with target_city
        return {
            full_address: addressString,
            address1: addressString,
            city: targetCity || null,
        };
    }
}
/**
 * Helper function to safely store venue address data from Google Maps
 * Now includes intelligent parsing of address components while preserving full address
 */
function createVenueAddressObject(addressString, coordinates, targetCity) {
    if (!addressString)
        return {};
    // Parse the Google Maps address format
    const parsedAddress = parseGoogleMapsAddress(addressString, targetCity);
    // Add coordinates if available
    if (coordinates && coordinates.lat && coordinates.lng) {
        parsedAddress.coordinates = {
            lat: coordinates.lat,
            lng: coordinates.lng
        };
    }
    return parsedAddress;
}
/**
 * Create companies with upsert functionality
 */
async function createCompaniesFromVenuesActivity(options) {
    try {
        // Convert venues to companies with target_city
        const companies = convertVenuesToCompanies(options.venues, options.targetCity);
        if (companies.length === 0) {
            return {
                success: true,
                companies: [],
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const createdCompanies = [];
        for (const company of companies) {
            try {
                // Create the address object using Google Maps data with intelligent parsing
                const addressJson = createVenueAddressObject(company.address, company.coordinates, options.targetCity);
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
                    logger_1.logger.error('❌ Error checking existing company', {
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
                        logger_1.logger.error('❌ Failed to update existing company', {
                            error: updateError.message,
                            companyName: company.name
                        });
                        continue;
                    }
                    result = updateData;
                    logger_1.logger.info(`✅ Company updated: ${company.name}`, {
                        companyId: result.id,
                        hasAddressJson: !!addressJson && Object.keys(addressJson).length > 0
                    });
                }
                else {
                    // Create new company
                    const { data: insertData, error: insertError } = await supabaseServiceRole
                        .from('companies')
                        .insert(companyData)
                        .select()
                        .single();
                    if (insertError) {
                        logger_1.logger.error('❌ Failed to create new company', {
                            error: insertError.message,
                            companyName: company.name
                        });
                        continue;
                    }
                    result = insertData;
                    logger_1.logger.info(`✅ Company created: ${company.name}`, {
                        companyId: result.id,
                        hasAddressJson: !!addressJson && Object.keys(addressJson).length > 0
                    });
                }
                createdCompanies.push(result);
            }
            catch (companyError) {
                const errorMessage = companyError instanceof Error ? companyError.message : String(companyError);
                logger_1.logger.error('❌ Exception creating company', {
                    error: errorMessage,
                    companyName: company.name
                });
                continue;
            }
        }
        logger_1.logger.info('✅ Companies creation completed', {
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
async function upsertVenueFailedActivity(options) {
    try {
        const { site_id, city, region, venueName, userId } = options;
        logger_1.logger.info('🔄 Starting venue failed upsert', {
            siteId: site_id,
            city,
            region,
            venueName,
            userId
        });
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return {
                success: false,
                error: 'Database not connected'
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
        let excludedNames = [];
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
            logger_1.logger.error('❌ Failed to upsert venue failed memory', {
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
        logger_1.logger.info('✅ Venue failed memory upserted successfully', {
            siteId: site_id,
            key,
            venueName,
            totalExcludedNames: excludedNames.length
        });
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Error in upsertVenueFailedActivity', {
            error: errorMessage,
            options
        });
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to notify about new leads generated using external API
 */
async function notifyNewLeadsActivity(options) {
    try {
        logger_1.logger.info('📢 Starting new leads notification', {
            site_id: options.site_id,
            leadNamesCount: options.leadNames.length,
            userId: options.userId
        });
        if (options.leadNames.length === 0) {
            logger_1.logger.info('⚠️ No lead names to notify, skipping notification', {
                site_id: options.site_id
            });
            return {
                success: true
            };
        }
        const requestBody = {
            site_id: options.site_id,
            names: options.leadNames,
            userId: options.userId,
            timestamp: new Date().toISOString(),
            ...options.additionalData
        };
        console.log('📤 Sending new leads notification:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/notifications/newLeadsAlert', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ New leads notification API call failed', {
                error: response.error,
                site_id: options.site_id,
                leadNamesCount: options.leadNames.length
            });
            throw new Error(`Failed to send new leads notification: ${response.error?.message || 'Unknown error'}`);
        }
        logger_1.logger.info('✅ New leads notification sent successfully', {
            site_id: options.site_id,
            leadNamesCount: options.leadNames.length,
            leadNames: options.leadNames
        });
        console.log(`✅ Successfully notified about ${options.leadNames.length} new leads: ${options.leadNames.join(', ')}`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ New leads notification exception', {
            error: errorMessage,
            site_id: options.site_id,
            leadNamesCount: options.leadNames.length
        });
        return {
            success: false,
            error: `Notification exception: ${errorMessage}`
        };
    }
}
/**
 * Activity to determine maximum venues based on billing plan and channel configuration
 * Rules:
 * - 1 venue if free plan (no channels configured in settings)
 * - 2 venues if free plan but has at least one channel configured
 * - 10 venues for startup plan
 * - 30 venues for enterprise plan
 */
async function determineMaxVenuesActivity(options) {
    try {
        logger_1.logger.info('🔢 Starting max venues determination', {
            site_id: options.site_id,
            userId: options.userId
        });
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return {
                success: false,
                error: 'Database not connected'
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Get billing information for the site
        const { data: billingData, error: billingError } = await supabaseServiceRole
            .from('billing')
            .select('plan')
            .eq('site_id', options.site_id)
            .single();
        if (billingError) {
            logger_1.logger.error('❌ Error fetching billing data', {
                error: billingError.message,
                site_id: options.site_id
            });
            return {
                success: false,
                error: `Failed to fetch billing data: ${billingError.message}`
            };
        }
        // Get settings to check channel configuration
        const { data: settingsData, error: settingsError } = await supabaseServiceRole
            .from('settings')
            .select('channels')
            .eq('site_id', options.site_id)
            .single();
        if (settingsError) {
            logger_1.logger.error('❌ Error fetching settings data', {
                error: settingsError.message,
                site_id: options.site_id
            });
            return {
                success: false,
                error: `Failed to fetch settings data: ${settingsError.message}`
            };
        }
        const plan = billingData?.plan || 'free';
        const channels = settingsData?.channels || {};
        // Check if channels are configured (non-empty object with at least one enabled channel)
        const hasChannels = channels && typeof channels === 'object' && Object.keys(channels).length > 0 &&
            Object.values(channels).some((channel) => channel && typeof channel === 'object' && channel.enabled === true);
        let maxVenues = 2; // Default for free plan without channels (doubled)
        // Apply business logic for venue limits (doubled from original values)
        switch (plan.toLowerCase()) {
            case 'free':
            case 'commission': // ✅ Commission plan treated as free plan
                maxVenues = hasChannels ? 4 : 2;
                break;
            case 'startup':
                maxVenues = 20;
                break;
            case 'enterprise':
                maxVenues = 60;
                break;
            default:
                // For any unknown plan, treat as free without channels
                maxVenues = 2;
                logger_1.logger.warn('⚠️ Unknown billing plan, defaulting to 2 venues', {
                    site_id: options.site_id,
                    plan: plan
                });
                break;
        }
        logger_1.logger.info('✅ Max venues determined successfully', {
            site_id: options.site_id,
            plan: plan,
            hasChannels: hasChannels,
            maxVenues: maxVenues,
            channelsConfigured: Object.keys(channels).length
        });
        console.log(`📊 Venue limits determined for site ${options.site_id}:`);
        console.log(`   💳 Billing plan: ${plan}`);
        console.log(`   📡 Channels configured: ${hasChannels ? 'Yes' : 'No'} (${Object.keys(channels).length} total)`);
        console.log(`   🏢 Max venues allowed: ${maxVenues}`);
        return {
            success: true,
            maxVenues: maxVenues,
            plan: plan,
            hasChannels: hasChannels
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception determining max venues', {
            error: errorMessage,
            site_id: options.site_id
        });
        return {
            success: false,
            error: `Exception determining max venues: ${errorMessage}`
        };
    }
}
