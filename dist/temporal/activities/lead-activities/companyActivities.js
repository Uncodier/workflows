"use strict";
/**
 * Company Activities
 * Activities for managing companies
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
exports.getCompanyActivity = getCompanyActivity;
exports.upsertCompanyActivity = upsertCompanyActivity;
exports.checkCompanyValidLeadsActivity = checkCompanyValidLeadsActivity;
exports.addCompanyToNullListActivity = addCompanyToNullListActivity;
exports.getCompanyInfoFromLeadActivity = getCompanyInfoFromLeadActivity;
const supabaseService_1 = require("../../services/supabaseService");
/**
 * Activity to get company information from database
 */
async function getCompanyActivity(companyId) {
    console.log(`🏢 Getting company information for: ${companyId}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot fetch company information');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, fetching company...');
        const companyData = await supabaseService.fetchCompany(companyId);
        if (!companyData) {
            console.log(`⚠️  Company ${companyId} not found`);
            return {
                success: false,
                error: 'Company not found'
            };
        }
        console.log(`✅ Retrieved company information for ${companyData.name}`);
        return {
            success: true,
            company: companyData
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting company ${companyId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to create or update company information in the database
 */
async function upsertCompanyActivity(companyData) {
    console.log(`🏢 Upserting company: ${companyData.name}`);
    console.log(`📋 Company data:`, JSON.stringify(companyData, null, 2));
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot upsert company');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, upserting company...');
        const upsertedCompany = await supabaseService.upsertCompany(companyData);
        console.log(`✅ Successfully upserted company: ${upsertedCompany.name}`);
        return {
            success: true,
            company: upsertedCompany
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception upserting company:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to check if a company has any valid leads remaining
 */
async function checkCompanyValidLeadsActivity(request) {
    console.log(`🔍 Checking valid leads for company - Name: ${request.company_name}, ID: ${request.company_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot check company leads');
            return {
                success: false,
                hasValidLeads: false,
                totalLeads: 0,
                validLeads: 0,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, checking company leads...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../../lib/supabase/client')));
        let company = null;
        let leadsQuery = supabaseServiceRole
            .from('leads')
            .select('id, name, email, phone, site_id, status, company, company_id')
            .eq('site_id', request.site_id);
        // Filter by company
        if (request.company_id) {
            leadsQuery = leadsQuery.eq('company_id', request.company_id);
            // Get company information
            const { data: companyData, error: companyError } = await supabaseServiceRole
                .from('companies')
                .select('*')
                .eq('id', request.company_id)
                .single();
            if (!companyError && companyData) {
                company = companyData;
            }
        }
        else if (request.company_name) {
            // For leads with company in JSONB field
            leadsQuery = leadsQuery.or(`company_id.is.null`)
                .filter('company->>name', 'ilike', `%${request.company_name}%`);
        }
        else {
            return {
                success: false,
                hasValidLeads: false,
                totalLeads: 0,
                validLeads: 0,
                error: 'Company name or ID is required'
            };
        }
        // Exclude the lead that triggered the invalidation
        if (request.exclude_lead_id) {
            leadsQuery = leadsQuery.neq('id', request.exclude_lead_id);
        }
        const { data: leads, error: leadsError } = await leadsQuery;
        if (leadsError) {
            console.error(`❌ Error checking company leads:`, leadsError);
            return {
                success: false,
                hasValidLeads: false,
                totalLeads: 0,
                validLeads: 0,
                error: leadsError.message
            };
        }
        const totalLeads = leads?.length || 0;
        // Count valid leads (leads that still have site_id and are not invalidated)
        const validLeads = leads?.filter(lead => lead.site_id &&
            (!lead.status || lead.status !== 'invalidated')) || [];
        const hasValidLeads = validLeads.length > 0;
        console.log(`📊 Company leads summary:`);
        console.log(`   - Total leads found: ${totalLeads}`);
        console.log(`   - Valid leads remaining: ${validLeads.length}`);
        console.log(`   - Company has valid leads: ${hasValidLeads}`);
        return {
            success: true,
            hasValidLeads,
            totalLeads,
            validLeads: validLeads.length,
            company: company
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception checking company valid leads:`, errorMessage);
        return {
            success: false,
            hasValidLeads: false,
            totalLeads: 0,
            validLeads: 0,
            error: errorMessage
        };
    }
}
/**
 * Activity to add a company to the null companies list for a city
 */
async function addCompanyToNullListActivity(request) {
    console.log(`🚫 Adding company to null list: ${request.company_name} in ${request.city}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot add company to null list');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, adding to null companies...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../../lib/supabase/client')));
        // Prepare null company data
        const nullCompanyData = {
            company_name: request.company_name,
            company_id: request.company_id || null,
            city: request.city.toLowerCase().trim(),
            site_id: request.site_id,
            reason: request.reason,
            failed_contact: request.failed_contact || {},
            total_leads_invalidated: request.total_leads_invalidated,
            original_lead_id: request.original_lead_id,
            invalidated_by_user_id: request.userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        // Check if company is already in null list for this city
        const { data: existingNullCompany, error: checkError } = await supabaseServiceRole
            .from('null_companies')
            .select('*')
            .eq('company_name', request.company_name)
            .eq('city', request.city.toLowerCase().trim())
            .eq('site_id', request.site_id)
            .maybeSingle();
        if (checkError && checkError.code !== 'PGRST116') {
            console.error(`❌ Error checking existing null company:`, checkError);
            return {
                success: false,
                error: checkError.message
            };
        }
        if (existingNullCompany) {
            console.log(`⚠️ Company ${request.company_name} already in null list for ${request.city}`);
            console.log(`🔄 Updating existing null company record...`);
            // Update existing record with new reason and increment count
            const { data: updateData, error: updateError } = await supabaseServiceRole
                .from('null_companies')
                .update({
                reason: request.reason,
                failed_contact: request.failed_contact || {},
                total_leads_invalidated: request.total_leads_invalidated,
                updated_at: new Date().toISOString(),
                last_invalidation_lead_id: request.original_lead_id
            })
                .eq('id', existingNullCompany.id)
                .select()
                .single();
            if (updateError) {
                console.error(`❌ Error updating null company:`, updateError);
                return {
                    success: false,
                    error: updateError.message
                };
            }
            console.log(`✅ Updated existing null company record for ${request.company_name}`);
            return {
                success: true,
                nullCompanyId: updateData.id
            };
        }
        // Create new null company record
        const { data: insertData, error: insertError } = await supabaseServiceRole
            .from('null_companies')
            .insert(nullCompanyData)
            .select()
            .single();
        if (insertError) {
            console.error(`❌ Error creating null company record:`, insertError);
            return {
                success: false,
                error: insertError.message
            };
        }
        console.log(`✅ Successfully added ${request.company_name} to null companies list for ${request.city}`);
        return {
            success: true,
            nullCompanyId: insertData.id
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception adding company to null list:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to get company information from lead data
 */
async function getCompanyInfoFromLeadActivity(request) {
    console.log(`🏢 Getting company information from lead: ${request.lead_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot get company info');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, getting company info...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../../lib/supabase/client')));
        // Get lead information with company relationship
        const { data: lead, error: leadError } = await supabaseServiceRole
            .from('leads')
            .select(`
        id,
        company,
        company_id,
        address,
        company:company_id (
          id,
          name,
          address
        )
      `)
            .eq('id', request.lead_id)
            .single();
        if (leadError) {
            console.error(`❌ Error getting lead information:`, leadError);
            return {
                success: false,
                error: leadError.message
            };
        }
        if (!lead) {
            return {
                success: false,
                error: 'Lead not found'
            };
        }
        // eslint-disable-next-line prefer-const
        let companyInfo = {};
        // Try to get company info from company_id relationship first
        if (lead.company_id && lead.company) {
            companyInfo.id = lead.company.id;
            companyInfo.name = lead.company.name;
            // Extract city from company address
            if (lead.company.address) {
                const address = lead.company.address;
                companyInfo.city = address.city || address.full_address || null;
            }
        }
        // Fallback to company JSONB field
        else if (lead.company && typeof lead.company === 'object') {
            const companyData = lead.company;
            companyInfo.name = companyData.name;
            // Extract city from company address in JSONB
            if (companyData.address) {
                companyInfo.city = companyData.address;
            }
            else if (companyData.full_address) {
                companyInfo.city = companyData.full_address;
            }
        }
        // Try to get city from lead address if no company city
        else if (lead.address && typeof lead.address === 'object') {
            const leadAddress = lead.address;
            companyInfo.city = leadAddress.city || leadAddress.full_address || null;
        }
        console.log(`📋 Company info extracted:`, companyInfo);
        return {
            success: true,
            company: companyInfo
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting company info from lead:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
