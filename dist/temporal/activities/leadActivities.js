"use strict";
/**
 * Lead and Company Activities
 * Activities for managing leads and companies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkExistingLeadNotificationActivity = checkExistingLeadNotificationActivity;
exports.getLeadActivity = getLeadActivity;
exports.leadFollowUpActivity = leadFollowUpActivity;
exports.leadResearchActivity = leadResearchActivity;
exports.leadAttentionActivity = leadAttentionActivity;
exports.startLeadAttentionWorkflowActivity = startLeadAttentionWorkflowActivity;
exports.saveLeadFollowUpLogsActivity = saveLeadFollowUpLogsActivity;
exports.updateLeadActivity = updateLeadActivity;
exports.getCompanyActivity = getCompanyActivity;
exports.upsertCompanyActivity = upsertCompanyActivity;
const apiService_1 = require("../services/apiService");
const supabaseService_1 = require("../services/supabaseService");
const client_1 = require("../client");
const config_1 = require("../../config/config");
/**
 * Activity to check if a lead notification was already sent today
 */
async function checkExistingLeadNotificationActivity(request) {
    console.log(`🔍 DUPLICATE CHECK: Starting check for existing lead attention notification for lead: ${request.lead_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 DUPLICATE CHECK: Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️ DUPLICATE CHECK: Database not available, proceeding with notification (cannot verify duplicates)');
            return {
                success: true,
                exists: false // Assume no notification exists if DB is unavailable
            };
        }
        console.log('✅ DUPLICATE CHECK: Database connection confirmed, checking for existing notifications...');
        // Get today's date in UTC (start and end of day)
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        console.log(`📅 DUPLICATE CHECK: Checking notifications from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
        console.log(`📅 DUPLICATE CHECK: Query params - lead_id: ${request.lead_id}, entity_type: 'lead'`);
        // Query notifications table for this lead_id and today's date
        // Using the actual table structure: related_entity_id for lead_id and created_at for timestamp
        const { data: notifications, error } = await supabaseService.client
            .from('notifications')
            .select('id, created_at, related_entity_id, related_entity_type')
            .eq('related_entity_id', request.lead_id)
            .eq('related_entity_type', 'lead')
            .gte('created_at', startOfDay.toISOString())
            .lt('created_at', endOfDay.toISOString())
            .order('created_at', { ascending: false })
            .limit(1);
        console.log(`📊 DUPLICATE CHECK: Query result - notifications:`, JSON.stringify(notifications, null, 2));
        console.log(`📊 DUPLICATE CHECK: Query error:`, error);
        if (error) {
            console.error('❌ DUPLICATE CHECK: Error querying notifications:', error);
            return {
                success: false,
                error: error.message,
                exists: false
            };
        }
        if (notifications && notifications.length > 0) {
            const lastNotification = notifications[0];
            console.log(`⚠️ DUPLICATE CHECK: FOUND existing lead attention notification for lead ${request.lead_id}`);
            console.log(`📅 DUPLICATE CHECK: Last notification created at: ${lastNotification.created_at}`);
            console.log(`📋 DUPLICATE CHECK: Notification details:`, JSON.stringify(lastNotification, null, 2));
            return {
                success: true,
                exists: true,
                lastNotification: {
                    sent_at: lastNotification.created_at,
                    notification_id: lastNotification.id
                }
            };
        }
        else {
            console.log(`✅ DUPLICATE CHECK: NO existing notifications found for lead ${request.lead_id} today`);
            return {
                success: true,
                exists: false
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception checking existing notifications for lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage,
            exists: false // Assume no notification exists on error (fail open)
        };
    }
}
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
        const lead = {
            id: leadData.id,
            email: leadData.email,
            name: leadData.name || leadData.full_name,
            company: leadData.company || leadData.company_name,
            company_name: leadData.company_name || leadData.company,
            job_title: leadData.job_title || leadData.position,
            position: leadData.position || leadData.job_title,
            industry: leadData.industry,
            location: leadData.location,
            phone: leadData.phone,
            website: leadData.website,
            company_size: leadData.company_size,
            site_id: leadData.site_id,
            created_at: leadData.created_at,
            updated_at: leadData.updated_at,
            ...leadData
        };
        console.log(`✅ Retrieved lead information for ${lead.name || lead.email}: ${lead.company}`);
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
 * Activity to execute lead research via sales agent API
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
        const response = await apiService_1.apiService.post('/api/agents/sales/leadResearch', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to execute lead research for lead ${request.lead_id}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to execute lead research'
            };
        }
        const data = response.data;
        const researchData = data?.researchData || data?.research || data;
        const insights = data?.insights || data?.findings || [];
        const recommendations = data?.recommendations || data?.next_steps || [];
        console.log(`✅ Lead research executed successfully for lead ${request.lead_id}`);
        if (insights.length > 0) {
            console.log(`🔍 Research insights generated: ${insights.length}`);
        }
        if (recommendations.length > 0) {
            console.log(`💡 Recommendations identified: ${recommendations.length}`);
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
 * Activity to send lead attention notification via external API
 * Only sends notification if the lead has an assignee_id
 */
async function leadAttentionActivity(request) {
    console.log(`📤 API CALL: Sending lead attention notification for lead: ${request.lead_id}`);
    console.log(`📤 API CALL: Request details:`, JSON.stringify(request, null, 2));
    try {
        // Send the notification to the API (validation already done in workflow)
        const requestBody = {
            lead_id: request.lead_id,
            user_message: request.user_message, // User's original message
            system_message: request.system_message, // System/assistant response
        };
        console.log('📤 API CALL: Sending lead attention request to API...');
        console.log('📤 API CALL: Request body:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/notifications/leadAttention', requestBody);
        console.log('📤 API CALL: Response:', JSON.stringify(response, null, 2));
        if (!response.success) {
            console.error(`❌ API CALL FAILED: API call failed for lead ${request.lead_id}:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to send lead attention notification'
            };
        }
        console.log(`✅ API CALL SUCCESS: Lead attention notification sent successfully for lead ${request.lead_id}`);
        return {
            success: true,
            data: {
                notificationSent: true,
                response: response.data
            }
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ API CALL EXCEPTION: Exception processing lead attention notification for lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to start leadAttentionWorkflow as an independent workflow
 * Uses Temporal client directly to start the workflow independently (not as child workflow)
 */
async function startLeadAttentionWorkflowActivity(request) {
    console.log(`🚀 Starting independent leadAttentionWorkflow for lead: ${request.lead_id}`);
    try {
        const workflowId = `lead-attention-${request.lead_id}`;
        // Get Temporal client directly (same pattern used throughout the codebase)
        const client = await (0, client_1.getTemporalClient)();
        console.log('📤 Starting workflow via Temporal client:', {
            workflowType: 'leadAttentionWorkflow',
            workflowId,
            args: [{ lead_id: request.lead_id, user_message: request.user_message, system_message: request.system_message }],
            taskQueue: config_1.temporalConfig.taskQueue
        });
        // Start the workflow using Temporal client (fire and forget)
        const handle = await client.workflow.start('leadAttentionWorkflow', {
            args: [{ lead_id: request.lead_id, user_message: request.user_message, system_message: request.system_message }],
            workflowId,
            taskQueue: config_1.temporalConfig.taskQueue,
        });
        console.log(`✅ Independent leadAttentionWorkflow started successfully for lead ${request.lead_id}`);
        console.log(`📋 Workflow ID: ${handle.workflowId}`);
        return {
            success: true,
            workflowId: handle.workflowId,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception starting independent leadAttentionWorkflow for lead ${request.lead_id}:`, errorMessage);
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
        // Extract the nested data fields to flatten them at root level
        const { success, data: nestedData } = request.data;
        const requestBody = {
            siteId: request.siteId,
            leadId: request.leadId,
            userId: request.userId,
            success,
            ...nestedData // Flatten the nested data fields (messages, lead, command_ids) to root
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
