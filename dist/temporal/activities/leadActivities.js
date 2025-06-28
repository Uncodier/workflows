"use strict";
/**
 * Lead and Company Activities
 * Activities for managing leads and companies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLeadActivity = getLeadActivity;
exports.leadFollowUpActivity = leadFollowUpActivity;
exports.leadResearchActivity = leadResearchActivity;
exports.saveLeadFollowUpLogsActivity = saveLeadFollowUpLogsActivity;
exports.updateLeadActivity = updateLeadActivity;
exports.getCompanyActivity = getCompanyActivity;
exports.upsertCompanyActivity = upsertCompanyActivity;
const apiService_1 = require("../services/apiService");
const supabaseService_1 = require("../services/supabaseService");
/**
 * Activity to get lead information from database
 */
async function getLeadActivity(leadId) {
    console.log(`👤 Getting lead information for: ${leadId}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot fetch lead information');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, fetching lead...');
        const leadData = await supabaseService.fetchLead(leadId);
        if (!leadData) {
            console.log(`⚠️  Lead ${leadId} not found`);
            return {
                success: false,
                error: 'Lead not found'
            };
        }
        const lead = {
            id: leadData.id,
            email: leadData.email,
            name: leadData.name,
            company: leadData.company || leadData.company_name,
            company_name: leadData.company_name,
            job_title: leadData.job_title || leadData.position,
            position: leadData.position,
            industry: leadData.industry,
            location: leadData.location,
            phone: leadData.phone,
            website: leadData.website,
            company_size: leadData.company_size,
            site_id: leadData.site_id,
            created_at: leadData.created_at,
            updated_at: leadData.updated_at,
            ...leadData // Include any additional fields
        };
        console.log(`✅ Retrieved lead information for ${lead.name || lead.email}`);
        console.log(`📧 Contact: ${lead.email}, 📱 Phone: ${lead.phone}`);
        if (lead.company) {
            console.log(`🏢 Company: ${lead.company}`);
        }
        return {
            success: true,
            lead
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting lead ${leadId}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to execute lead follow-up via sales agent API
 */
async function leadFollowUpActivity(request) {
    console.log(`📞 Executing lead follow-up for lead: ${request.lead_id}, site: ${request.site_id}`);
    try {
        const requestBody = {
            leadId: request.lead_id, // Convert to camelCase for API
            siteId: request.site_id, // Convert to camelCase for API
            userId: request.userId,
            ...request.additionalData,
        };
        console.log('📤 Sending lead follow-up request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/sales/leadFollowUp', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to execute lead follow-up for lead ${request.lead_id}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to execute lead follow-up'
            };
        }
        const data = response.data;
        const followUpActions = data?.followUpActions || data?.actions || [];
        const nextSteps = data?.nextSteps || data?.next_steps || [];
        console.log(`✅ Lead follow-up executed successfully for lead ${request.lead_id}`);
        if (followUpActions.length > 0) {
            console.log(`📋 Follow-up actions generated: ${followUpActions.length}`);
        }
        if (nextSteps.length > 0) {
            console.log(`🎯 Next steps identified: ${nextSteps.length}`);
        }
        return {
            success: true,
            data,
            followUpActions,
            nextSteps
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception executing lead follow-up for lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to execute lead research via lead research agent API
 */
async function leadResearchActivity(request) {
    console.log(`🔍 Executing lead research for lead: ${request.lead_id}, site: ${request.site_id}`);
    try {
        const requestBody = {
            leadId: request.lead_id, // Convert to camelCase for API
            siteId: request.site_id, // Convert to camelCase for API
            userId: request.userId,
            ...request.additionalData,
        };
        console.log('📤 Sending lead research request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/lead-research/leadResearch', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to execute lead research for lead ${request.lead_id}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to execute lead research'
            };
        }
        const data = response.data;
        const researchData = data?.researchData || data?.research || data;
        const insights = data?.insights || [];
        const recommendations = data?.recommendations || [];
        console.log(`✅ Lead research executed successfully for lead ${request.lead_id}`);
        if (insights.length > 0) {
            console.log(`💡 Insights generated: ${insights.length}`);
        }
        if (recommendations.length > 0) {
            console.log(`💭 Recommendations identified: ${recommendations.length}`);
        }
        return {
            success: true,
            data,
            researchData,
            insights,
            recommendations
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception executing lead research for lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to save lead follow-up logs via API
 */
async function saveLeadFollowUpLogsActivity(request) {
    console.log(`📝 Saving lead follow-up logs for lead ${request.leadId} on site ${request.siteId}`);
    try {
        // The data contains the direct response from the API with messages, lead, and command_ids
        const requestBody = {
            siteId: request.siteId,
            leadId: request.leadId,
            userId: request.userId,
            success: true, // Mark as successful since we reached this point
            ...request.data // Flatten the data fields (messages, lead, command_ids) to root
        };
        console.log('📤 Sending lead follow-up logs:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/sales/leadFollowUp/logs', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to save lead follow-up logs:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to save lead follow-up logs'
            };
        }
        console.log(`✅ Lead follow-up logs saved successfully`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception saving lead follow-up logs:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to update lead information in database
 */
async function updateLeadActivity(request) {
    console.log(`👤 Updating lead information for: ${request.lead_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update lead information');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, updating lead...');
        // Prepare update data, excluding dangerous fields if safeUpdate is true
        let updateData = { ...request.updateData };
        if (request.safeUpdate !== false) { // Default to safe update
            // Remove dangerous fields that should not be overwritten
            const { email, phone, ...safeData } = updateData;
            updateData = safeData;
            if (email || phone) {
                console.log('⚠️  Skipping email/phone update for safety (safeUpdate mode)');
                console.log(`   - Email: ${email ? 'would be updated' : 'not provided'}`);
                console.log(`   - Phone: ${phone ? 'would be updated' : 'not provided'}`);
            }
        }
        const updatedLead = await supabaseService.updateLead(request.lead_id, updateData);
        console.log(`✅ Successfully updated lead information for ${request.lead_id}`);
        return {
            success: true,
            lead: updatedLead
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
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
            console.log('⚠️  Database not available, cannot upsert company information');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, upserting company...');
        const company = await supabaseService.upsertCompany(companyData);
        console.log(`✅ Successfully upserted company: ${company.name}`);
        return {
            success: true,
            company
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
