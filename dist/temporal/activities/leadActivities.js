"use strict";
/**
 * Lead and Company Activities
 * Activities for managing leads and companies
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
exports.checkExistingLeadNotificationActivity = checkExistingLeadNotificationActivity;
exports.getLeadActivity = getLeadActivity;
exports.leadFollowUpActivity = leadFollowUpActivity;
exports.leadResearchActivity = leadResearchActivity;
exports.leadAttentionActivity = leadAttentionActivity;
exports.startLeadAttentionWorkflowActivity = startLeadAttentionWorkflowActivity;
exports.startLeadFollowUpWorkflowActivity = startLeadFollowUpWorkflowActivity;
exports.saveLeadFollowUpLogsActivity = saveLeadFollowUpLogsActivity;
exports.updateLeadActivity = updateLeadActivity;
exports.getCompanyActivity = getCompanyActivity;
exports.upsertCompanyActivity = upsertCompanyActivity;
exports.updateConversationStatusAfterFollowUpActivity = updateConversationStatusAfterFollowUpActivity;
exports.validateMessageAndConversationActivity = validateMessageAndConversationActivity;
exports.updateMessageStatusToSentActivity = updateMessageStatusToSentActivity;
exports.updateMessageTimestampActivity = updateMessageTimestampActivity;
exports.updateTaskStatusToCompletedActivity = updateTaskStatusToCompletedActivity;
exports.invalidateLeadActivity = invalidateLeadActivity;
exports.invalidateEmailOnlyActivity = invalidateEmailOnlyActivity;
exports.findLeadsBySharedContactActivity = findLeadsBySharedContactActivity;
exports.updateLeadInvalidationMetadataActivity = updateLeadInvalidationMetadataActivity;
exports.checkCompanyValidLeadsActivity = checkCompanyValidLeadsActivity;
exports.addCompanyToNullListActivity = addCompanyToNullListActivity;
exports.getCompanyInfoFromLeadActivity = getCompanyInfoFromLeadActivity;
exports.cleanupFailedFollowUpActivity = cleanupFailedFollowUpActivity;
exports.deleteLeadConversationsActivity = deleteLeadConversationsActivity;
exports.updateLeadEmailVerificationActivity = updateLeadEmailVerificationActivity;
exports.invalidateReferredLeads = invalidateReferredLeads;
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
            throw new Error(`Failed to execute lead follow-up for lead ${request.lead_id}: ${response.error?.message || 'Unknown error'}`);
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
            throw new Error(`Failed to execute lead research for lead ${request.lead_id}: ${response.error?.message || 'Unknown error'}`);
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
            throw new Error(`Failed to send lead attention notification for lead ${request.lead_id}: ${response.error?.message || 'Unknown error'}`);
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
 * Activity to start leadFollowUpWorkflow as an independent workflow
 * Uses Temporal client directly to start the workflow independently (not as child workflow)
 */
async function startLeadFollowUpWorkflowActivity(request) {
    console.log(`🚀 Starting independent leadFollowUpWorkflow for lead: ${request.lead_id}`);
    try {
        const workflowId = `lead-follow-up-${request.lead_id}-${request.site_id}-${Date.now()}`;
        // Get Temporal client directly (same pattern used throughout the codebase)
        const client = await (0, client_1.getTemporalClient)();
        console.log('📤 Starting leadFollowUpWorkflow via Temporal client:', {
            workflowType: 'leadFollowUpWorkflow',
            workflowId,
            args: [{ lead_id: request.lead_id, site_id: request.site_id, userId: request.userId, additionalData: request.additionalData }],
            taskQueue: config_1.temporalConfig.taskQueue
        });
        // Start the workflow using Temporal client (fire and forget)
        const handle = await client.workflow.start('leadFollowUpWorkflow', {
            args: [{
                    lead_id: request.lead_id,
                    site_id: request.site_id,
                    userId: request.userId,
                    additionalData: request.additionalData
                }],
            workflowId,
            taskQueue: config_1.temporalConfig.taskQueue,
        });
        console.log(`✅ Independent leadFollowUpWorkflow started successfully for lead ${request.lead_id}`);
        console.log(`📋 Workflow ID: ${handle.workflowId}`);
        return {
            success: true,
            workflowId: handle.workflowId,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception starting independent leadFollowUpWorkflow for lead ${request.lead_id}:`, errorMessage);
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
        // Flatten the data fields directly to root level
        const requestBody = {
            siteId: request.siteId,
            leadId: request.leadId,
            userId: request.userId,
            ...request.data // Flatten the data fields (messages, lead, command_ids) directly to root
        };
        console.log('📤 Sending lead follow-up logs:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/sales/leadFollowUp/logs', requestBody);
        if (!response.success) {
            console.error(`❌ Failed to save lead follow-up logs:`, response.error);
            throw new Error(`Failed to save lead follow-up logs: ${response.error?.message || 'Unknown error'}`);
        }
        console.log(`✅ Lead follow-up logs saved successfully`);
        // Extract message_ids and conversation_ids from response data if available
        const responseData = response.data || {};
        const message_ids = responseData.message_ids || [];
        const conversation_ids = responseData.conversation_ids || [];
        console.log(`📋 Logs response data:`);
        console.log(`   - Message IDs: ${message_ids.length > 0 ? message_ids.join(', ') : 'None'}`);
        console.log(`   - Conversation IDs: ${conversation_ids.length > 0 ? conversation_ids.join(', ') : 'None'}`);
        return {
            success: true,
            message_ids,
            conversation_ids,
            data: responseData
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
/**
 * Activity to update conversation status to active after successful lead follow-up
 * This is a specific activity for post follow-up conversation activation
 */
async function updateConversationStatusAfterFollowUpActivity(request) {
    console.log(`💬 Activating conversation after successful lead follow-up...`);
    console.log(`📋 Lead ID: ${request.lead_id}, Site ID: ${request.site_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update conversation status');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, searching for conversation...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // First, try to find the conversation ID if not provided
        let conversationId = request.conversation_id;
        if (!conversationId) {
            console.log(`🔍 No conversation ID provided, searching for conversation by lead_id...`);
            // Look for conversation_id in response data
            if (request.response_data) {
                conversationId = request.response_data.conversation_id ||
                    request.response_data.lead?.conversation_id;
            }
            // Look in additional data
            if (!conversationId && request.additional_data) {
                conversationId = request.additional_data.conversation_id;
            }
            // If still no conversation ID, try to find it by lead_id
            if (!conversationId) {
                console.log(`🔍 Searching for conversation by lead_id in database...`);
                const { data: conversation, error: findError } = await supabaseServiceRole
                    .from('conversations')
                    .select('id')
                    .eq('lead_id', request.lead_id)
                    .eq('site_id', request.site_id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();
                if (findError && findError.code !== 'PGRST116') { // PGRST116 = no rows returned
                    console.error(`❌ Error searching for conversation:`, findError);
                    return {
                        success: false,
                        error: `Failed to search for conversation: ${findError.message}`
                    };
                }
                if (conversation) {
                    conversationId = conversation.id;
                    console.log(`✅ Found conversation by lead_id: ${conversationId}`);
                }
            }
        }
        if (!conversationId) {
            console.log(`⚠️ No conversation found for lead ${request.lead_id} - this is normal for some follow-ups`);
            return {
                success: true, // Don't fail the workflow for missing conversation
                error: 'No conversation found to update'
            };
        }
        console.log(`📝 Updating conversation ${conversationId} status to 'active'...`);
        const updateData = {
            status: 'active',
            updated_at: new Date().toISOString(),
            last_message_at: new Date().toISOString() // Update last message time
        };
        const { data, error } = await supabaseServiceRole
            .from('conversations')
            .update(updateData)
            .eq('id', conversationId)
            .eq('site_id', request.site_id) // Additional security filter
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating conversation ${conversationId}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Conversation ${conversationId} not found or update failed`
            };
        }
        console.log(`✅ Successfully activated conversation ${conversationId} after lead follow-up`);
        console.log(`💬 Conversation is now active and ready for new interactions`);
        return {
            success: true,
            conversation_id: conversationId
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating conversation status after follow-up:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to validate that message and conversation exist before sending follow-up
 * This validates both conversation and message integrity before proceeding with sending
 */
async function validateMessageAndConversationActivity(request) {
    console.log(`🔍 Validating message and conversation existence before follow-up...`);
    console.log(`📋 Lead ID: ${request.lead_id}, Site ID: ${request.site_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot validate message and conversation');
            return {
                success: false,
                error: 'Database not available',
                conversation_exists: false,
                message_exists: false
            };
        }
        console.log('✅ Database connection confirmed, validating existence...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Step 1: Find conversation ID if not provided - prioritize additional_data which comes from logs
        let conversationId = request.additional_data?.conversation_id ||
            request.additional_data?.conversation_ids?.[0] ||
            request.response_data?.conversation_id ||
            request.response_data?.lead?.conversation_id;
        let conversationExists = false;
        if (!conversationId) {
            console.log(`🔍 No conversation ID provided, searching by lead_id...`);
            const { data: conversation, error: findError } = await supabaseServiceRole
                .from('conversations')
                .select('id, status, custom_data, updated_at, last_message_at, created_at')
                .eq('lead_id', request.lead_id)
                .eq('site_id', request.site_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (findError && findError.code !== 'PGRST116') {
                console.error(`❌ Error searching for conversation:`, findError);
                return {
                    success: false,
                    error: `Failed to search for conversation: ${findError.message}`,
                    conversation_exists: false,
                    message_exists: false
                };
            }
            if (conversation) {
                conversationId = conversation.id;
                conversationExists = true;
                console.log(`✅ Found conversation by lead_id and reloaded from database:`);
                console.log(`   - Conversation ID: ${conversationId}`);
                console.log(`   - Status: ${conversation.status}`);
                console.log(`   - Created: ${conversation.created_at}`);
                console.log(`   - Last updated: ${conversation.updated_at}`);
                console.log(`   - Last message: ${conversation.last_message_at}`);
                console.log(`   - Custom data:`, conversation.custom_data);
            }
            else {
                console.log(`❌ No conversation found by lead_id - conversation may have been deleted by user`);
                console.log(`🔍 This could happen if:`);
                console.log(`   - User manually deleted the conversation`);
                console.log(`   - Conversation was cleaned up by another process`);
                console.log(`   - Conversation never existed for this lead`);
                // Check if there are ANY conversations for this lead (not just the most recent)
                console.log(`🔍 Checking for ANY conversations for this lead...`);
                const { data: allConversations, error: allConversationsError } = await supabaseServiceRole
                    .from('conversations')
                    .select('id, created_at, status')
                    .eq('lead_id', request.lead_id)
                    .eq('site_id', request.site_id)
                    .order('created_at', { ascending: false });
                if (!allConversationsError && allConversations && allConversations.length > 0) {
                    console.log(`📊 Found ${allConversations.length} total conversations for this lead:`);
                    allConversations.forEach((conv, index) => {
                        console.log(`   ${index + 1}. ID: ${conv.id}, Status: ${conv.status}, Created: ${conv.created_at}`);
                    });
                    console.log(`💡 User may have deleted the specific conversation but others exist`);
                }
                else {
                    console.log(`📊 No conversations found for this lead at all`);
                }
            }
        }
        else {
            console.log(`🔍 Validating provided conversation ID: ${conversationId}...`);
            const { data: conversation, error: validateError } = await supabaseServiceRole
                .from('conversations')
                .select('id, status, custom_data, updated_at, last_message_at')
                .eq('id', conversationId)
                .eq('site_id', request.site_id)
                .single();
            if (validateError) {
                console.error(`❌ Conversation ${conversationId} not found or invalid:`, validateError);
                console.error(`💬 Specific conversation was deleted - this is likely user action`);
                console.error(`🔍 Error details:`);
                console.error(`   - Error code: ${validateError.code}`);
                console.error(`   - Error message: ${validateError.message}`);
                conversationExists = false;
            }
            else {
                conversationExists = true;
                console.log(`✅ Conversation ${conversationId} exists and reloaded from database:`);
                console.log(`   - Status: ${conversation.status}`);
                console.log(`   - Last updated: ${conversation.updated_at}`);
                console.log(`   - Last message: ${conversation.last_message_at}`);
                console.log(`   - Custom data:`, conversation.custom_data);
            }
        }
        // Step 2: Validate message if message_id provided - prioritize additional_data which comes from logs
        let messageExists = false;
        let messageIsValid = false;
        const messageId = request.message_id ||
            request.additional_data?.message_ids?.[0] ||
            request.response_data?.message_id;
        if (messageId && conversationId) {
            console.log(`🔍 Validating message ID: ${messageId}...`);
            const { data: message, error: messageError } = await supabaseServiceRole
                .from('messages')
                .select('id, custom_data, created_at, updated_at, conversation_id')
                .eq('id', messageId)
                .eq('conversation_id', conversationId)
                .single();
            if (messageError) {
                console.error(`❌ Message ${messageId} not found:`, messageError);
                messageExists = false;
                messageIsValid = false;
            }
            else {
                messageExists = true;
                console.log(`✅ Message ${messageId} exists in conversation ${conversationId}`);
                console.log(`📊 Message details:`);
                console.log(`   - Created: ${message.created_at}`);
                console.log(`   - Updated: ${message.updated_at}`);
                console.log(`   - Custom data:`, JSON.stringify(message.custom_data, null, 2));
                // Validate message status - should be 'pending' or ready for sending
                const customData = message.custom_data || {};
                const messageStatus = customData.status;
                const alreadyProcessed = customData.follow_up?.processed;
                console.log(`🔍 Message status validation:`);
                console.log(`   - Current status: ${messageStatus || 'undefined'}`);
                console.log(`   - Already processed: ${alreadyProcessed || false}`);
                if (alreadyProcessed && messageStatus === 'sent') {
                    console.log(`⚠️ Message was already sent - this might be a duplicate workflow`);
                    messageIsValid = false;
                }
                else if (messageStatus && messageStatus !== 'pending' && messageStatus !== 'sent') {
                    console.log(`⚠️ Message has unexpected status: ${messageStatus}`);
                    messageIsValid = false;
                }
                else {
                    console.log(`✅ Message is ready for processing (status: ${messageStatus || 'pending'})`);
                    messageIsValid = true;
                }
            }
        }
        else if (!messageId) {
            console.log(`⚠️ No message ID provided for validation - skipping message check`);
            messageExists = true; // Don't fail validation for missing message ID
            messageIsValid = true;
        }
        else {
            console.log(`❌ Message ID provided but no conversation ID - cannot validate message`);
            messageExists = false;
            messageIsValid = false;
        }
        // Step 3: Final validation result - require both conversation and valid message (if message_id provided)
        const validationSuccess = conversationExists && (messageId ? (messageExists && messageIsValid) : true);
        // Prepare specific error details
        const errorDetails = [];
        if (!conversationExists) {
            // Check if we had a specific conversation_id from logs (vs searching by lead_id)
            const hadSpecificConversationId = request.additional_data?.conversation_id ||
                request.additional_data?.conversation_ids?.[0];
            if (hadSpecificConversationId) {
                errorDetails.push('conversation was deleted (likely by user action)');
            }
            else {
                errorDetails.push('no conversation found for this lead');
            }
        }
        if (messageId && !messageExists)
            errorDetails.push('message not found');
        if (messageId && messageExists && !messageIsValid)
            errorDetails.push('message already processed or invalid status');
        if (validationSuccess) {
            console.log(`✅ Validation successful - ready for follow-up message sending`);
            if (conversationId) {
                console.log(`💬 Conversation ${conversationId} is ready for new messages`);
            }
            if (messageId && messageExists && messageIsValid) {
                console.log(`📝 Message ${messageId} exists and is ready for processing`);
            }
        }
        else {
            console.log(`❌ Validation failed - cannot proceed with follow-up`);
            console.log(`   - Conversation exists: ${conversationExists}`);
            console.log(`   - Message exists: ${messageExists}`);
            console.log(`   - Message is valid: ${messageIsValid}`);
            console.log(`🔍 Validation failure reasons: ${errorDetails.join(', ')}`);
        }
        return {
            success: validationSuccess,
            conversation_id: conversationId,
            message_id: messageId,
            conversation_exists: conversationExists,
            message_exists: messageExists,
            error: validationSuccess ? undefined : `Validation failed: ${errorDetails.join(', ')}`
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception validating message and conversation:`, errorMessage);
        return {
            success: false,
            error: errorMessage,
            conversation_exists: false,
            message_exists: false
        };
    }
}
/**
 * Activity to update message status from pending to sent after successful follow-up delivery
 * Updates the custom_data field in the messages table
 */
async function updateMessageStatusToSentActivity(request) {
    console.log(`📝 Updating message status to 'sent' after follow-up delivery...`);
    console.log(`📋 Message ID: ${request.message_id}, Channel: ${request.delivery_channel}, Success: ${request.delivery_success}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update message status');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, updating message status...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        let messageId = request.message_id;
        // If no message_id provided, try to find the most recent message in the conversation
        if (!messageId && request.conversation_id) {
            console.log(`🔍 No message ID provided, searching for recent message in conversation ${request.conversation_id}...`);
            const { data: recentMessage, error: findError } = await supabaseServiceRole
                .from('messages')
                .select('id, custom_data')
                .eq('conversation_id', request.conversation_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (findError && findError.code !== 'PGRST116') {
                console.error(`❌ Error finding recent message:`, findError);
                return {
                    success: false,
                    error: `Failed to find recent message: ${findError.message}`
                };
            }
            if (recentMessage) {
                messageId = recentMessage.id;
                console.log(`✅ Found recent message in conversation: ${messageId}`);
            }
        }
        // If still no message_id, try to find pending messages for this lead
        if (!messageId) {
            console.log(`🔍 No message ID from conversation, searching for pending messages for lead ${request.lead_id}...`);
            const { data: pendingMessages, error: findPendingError } = await supabaseServiceRole
                .from('messages')
                .select('id, conversation_id, custom_data, created_at')
                .eq('site_id', request.site_id)
                .eq('role', 'assistant') // Messages sent by the assistant
                .order('created_at', { ascending: false })
                .limit(10); // Get recent messages
            if (findPendingError) {
                console.error(`❌ Error finding pending messages:`, findPendingError);
                return {
                    success: false,
                    error: `Failed to find pending messages: ${findPendingError.message}`
                };
            }
            if (pendingMessages && pendingMessages.length > 0) {
                // Look for messages with pending status that belong to this lead
                for (const msg of pendingMessages) {
                    const customData = msg.custom_data || {};
                    const messageStatus = customData.status;
                    // Check if this message is pending and belongs to our lead
                    if (messageStatus === 'pending') {
                        // Get the conversation to check if it belongs to our lead
                        const { data: conversation, error: convError } = await supabaseServiceRole
                            .from('conversations')
                            .select('lead_id')
                            .eq('id', msg.conversation_id)
                            .single();
                        if (!convError && conversation && conversation.lead_id === request.lead_id) {
                            messageId = msg.id;
                            console.log(`✅ Found pending message for lead ${request.lead_id}: ${messageId}`);
                            break;
                        }
                    }
                }
            }
        }
        if (!messageId) {
            console.log(`⚠️ No message found to update for lead ${request.lead_id} - this may indicate the message was not properly created`);
            return {
                success: true, // Don't fail the workflow for missing message
                error: 'No message found to update'
            };
        }
        console.log(`📝 Reloading and updating message ${messageId} status...`);
        console.log(`🔄 Reloading message from database to ensure current state...`);
        // Reload the complete message from database to ensure we have the latest state
        // This is important because 2+ hours may have passed since the workflow started
        const { data: currentMessage, error: getCurrentError } = await supabaseServiceRole
            .from('messages')
            .select('id, conversation_id, content, role, custom_data, created_at, updated_at')
            .eq('id', messageId)
            .single();
        if (getCurrentError) {
            console.error(`❌ Error reloading current message data:`, getCurrentError);
            return {
                success: false,
                error: `Failed to reload message: ${getCurrentError.message}`
            };
        }
        console.log(`✅ Message reloaded from database:`);
        console.log(`   - Message ID: ${currentMessage.id}`);
        console.log(`   - Conversation ID: ${currentMessage.conversation_id}`);
        console.log(`   - Role: ${currentMessage.role}`);
        console.log(`   - Created: ${currentMessage.created_at}`);
        console.log(`   - Last Updated: ${currentMessage.updated_at}`);
        console.log(`   - Current custom_data:`, JSON.stringify(currentMessage.custom_data, null, 2));
        // Verify the message still belongs to the correct conversation (security check)
        if (request.conversation_id && currentMessage.conversation_id !== request.conversation_id) {
            console.error(`❌ Message ${messageId} conversation mismatch:`);
            console.error(`   - Expected: ${request.conversation_id}`);
            console.error(`   - Actual: ${currentMessage.conversation_id}`);
            return {
                success: false,
                error: 'Message conversation mismatch - possible data corruption'
            };
        }
        // Check if message was already processed by another workflow
        const currentCustomData = currentMessage.custom_data || {};
        const currentStatus = currentCustomData.status;
        const alreadyProcessed = currentCustomData.follow_up?.processed;
        if (alreadyProcessed && currentStatus === 'sent') {
            console.log(`⚠️ Message ${messageId} was already processed and marked as 'sent'`);
            console.log(`   - Current status: ${currentStatus}`);
            console.log(`   - Processed at: ${currentCustomData.follow_up?.processed_at}`);
            console.log(`   - Skipping duplicate processing`);
            return {
                success: true,
                updated_message_id: messageId,
                error: 'Message already processed'
            };
        }
        if (currentStatus && currentStatus !== 'pending' && currentStatus !== 'sent') {
            console.log(`⚠️ Message ${messageId} has unexpected status: ${currentStatus}`);
            console.log(`   - Expected: 'pending' or 'sent'`);
            console.log(`   - Proceeding with update anyway`);
        }
        // Prepare updated custom_data, preserving existing fields
        const targetStatus = request.delivery_success ? 'sent' : 'failed';
        console.log(`📝 Updating message status from '${currentStatus || 'undefined'}' to '${targetStatus}'`);
        const updatedCustomData = {
            ...currentCustomData,
            status: targetStatus,
            delivery: {
                channel: request.delivery_channel,
                success: request.delivery_success,
                timestamp: new Date().toISOString(),
                details: request.delivery_details || {}
            },
            follow_up: {
                processed: true,
                processed_at: new Date().toISOString(),
                lead_id: request.lead_id,
                site_id: request.site_id
            }
        };
        // Update message with new status
        const { data, error } = await supabaseServiceRole
            .from('messages')
            .update({
            custom_data: updatedCustomData,
            updated_at: new Date().toISOString()
        })
            .eq('id', messageId)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating message ${messageId}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Message ${messageId} not found or update failed`
            };
        }
        console.log(`✅ Successfully updated message ${messageId} status to '${targetStatus}'`);
        console.log(`📊 Message now marked as processed via ${request.delivery_channel}`);
        // Update lead status to 'contacted' when message is successfully sent
        if (request.delivery_success && targetStatus === 'sent') {
            console.log(`👤 Updating lead ${request.lead_id} status to 'contacted' after successful message delivery...`);
            const leadUpdateData = {
                status: 'contacted',
                updated_at: new Date().toISOString(),
                last_contact: new Date().toISOString()
            };
            const { error: leadError } = await supabaseServiceRole
                .from('leads')
                .update(leadUpdateData)
                .eq('id', request.lead_id)
                .eq('site_id', request.site_id);
            if (leadError) {
                console.error(`❌ Warning: Failed to update lead status to 'contacted':`, leadError);
                // Don't fail the entire operation for lead update failure
            }
            else {
                console.log(`✅ Successfully updated lead ${request.lead_id} status to 'contacted'`);
            }
        }
        return {
            success: true,
            updated_message_id: messageId
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating message status:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to update message timestamp to sync with real delivery time
 * Updates the created_at field in the messages table to reflect actual send time
 */
async function updateMessageTimestampActivity(request) {
    console.log(`⏰ Updating message timestamp to sync with delivery time...`);
    console.log(`📋 Message ID: ${request.message_id}, Channel: ${request.delivery_channel}`);
    console.log(`📅 Delivery timestamp: ${request.delivery_timestamp}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update message timestamp');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, updating message timestamp...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        let messageId = request.message_id;
        // If no message_id provided, try to find the most recent message in the conversation
        if (!messageId && request.conversation_id) {
            console.log(`🔍 No message ID provided, searching for recent message in conversation...`);
            const { data: recentMessage, error: findError } = await supabaseServiceRole
                .from('messages')
                .select('id, created_at')
                .eq('conversation_id', request.conversation_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (findError && findError.code !== 'PGRST116') {
                console.error(`❌ Error finding recent message:`, findError);
                return {
                    success: false,
                    error: `Failed to find recent message: ${findError.message}`
                };
            }
            if (recentMessage) {
                messageId = recentMessage.id;
                console.log(`✅ Found recent message: ${messageId}`);
            }
        }
        if (!messageId) {
            console.log(`⚠️ No message found to update timestamp - this is normal for some follow-ups`);
            return {
                success: true, // Don't fail the workflow for missing message
                error: 'No message found to update timestamp'
            };
        }
        console.log(`⏰ Updating message ${messageId} timestamp to delivery time...`);
        // Verify the message exists and get current data
        const { data: currentMessage, error: getCurrentError } = await supabaseServiceRole
            .from('messages')
            .select('id, conversation_id, created_at, custom_data')
            .eq('id', messageId)
            .single();
        if (getCurrentError) {
            console.error(`❌ Error fetching current message:`, getCurrentError);
            return {
                success: false,
                error: `Failed to fetch message: ${getCurrentError.message}`
            };
        }
        console.log(`📅 Current message timestamp: ${currentMessage.created_at}`);
        console.log(`📅 New delivery timestamp: ${request.delivery_timestamp}`);
        // Verify the message belongs to the correct conversation (security check)
        if (request.conversation_id && currentMessage.conversation_id !== request.conversation_id) {
            console.error(`❌ Message ${messageId} conversation mismatch:`);
            console.error(`   - Expected: ${request.conversation_id}`);
            console.error(`   - Actual: ${currentMessage.conversation_id}`);
            return {
                success: false,
                error: 'Message conversation mismatch - possible data corruption'
            };
        }
        // Update the custom_data to track the original timestamp
        const currentCustomData = currentMessage.custom_data || {};
        const updatedCustomData = {
            ...currentCustomData,
            timestamp_sync: {
                original_created_at: currentMessage.created_at,
                delivery_timestamp: request.delivery_timestamp,
                synced_at: new Date().toISOString(),
                delivery_channel: request.delivery_channel,
                lead_id: request.lead_id,
                site_id: request.site_id
            }
        };
        // Update message with new timestamp and custom data
        const { data, error } = await supabaseServiceRole
            .from('messages')
            .update({
            created_at: request.delivery_timestamp,
            custom_data: updatedCustomData,
            updated_at: new Date().toISOString()
        })
            .eq('id', messageId)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating message timestamp:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Message ${messageId} not found or timestamp update failed`
            };
        }
        console.log(`✅ Successfully updated message ${messageId} timestamp`);
        console.log(`📅 Message timestamp synced: ${currentMessage.created_at} → ${request.delivery_timestamp}`);
        console.log(`📊 Original timestamp preserved in custom_data for audit trail`);
        return {
            success: true,
            updated_message_id: messageId
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating message timestamp:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to update task status (typically to mark first_contact tasks as completed)
 * Can find task by task_id or by lead_id + site_id + stage combination
 */
async function updateTaskStatusToCompletedActivity(request) {
    console.log(`📝 Updating task status for lead: ${request.lead_id}`);
    console.log(`📋 Task ID: ${request.task_id || 'will search by lead_id'}, Status: ${request.status}, Stage: ${request.stage || 'any'}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update task status');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, updating task status...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        let taskId = request.task_id;
        // If no task_id provided, try to find the task by lead_id + site_id + stage
        if (!taskId) {
            console.log(`🔍 No task ID provided, searching for task by lead_id and stage...`);
            let query = supabaseServiceRole
                .from('tasks')
                .select('id, status, stage, title')
                .eq('lead_id', request.lead_id)
                .eq('site_id', request.site_id);
            // Add stage filter if provided (typically 'awareness' for first_contact)
            if (request.stage) {
                query = query.eq('stage', request.stage);
            }
            // Order by created_at to get the most recent task
            query = query.order('created_at', { ascending: false }).limit(1);
            const { data: taskData, error: findError } = await query.single();
            if (findError && findError.code !== 'PGRST116') {
                console.error(`❌ Error finding task:`, findError);
                return {
                    success: false,
                    error: `Failed to find task: ${findError.message}`
                };
            }
            if (taskData) {
                taskId = taskData.id;
                console.log(`✅ Found task: ${taskId} (${taskData.stage}) - ${taskData.title}`);
                console.log(`   Current status: ${taskData.status}`);
            }
        }
        if (!taskId) {
            console.log(`⚠️ No task found to update for lead ${request.lead_id} with stage ${request.stage || 'any'}`);
            return {
                success: true, // Don't fail the workflow for missing task
                error: 'No task found to update',
                task_found: false
            };
        }
        console.log(`📝 Updating task ${taskId} status to '${request.status}'...`);
        // Prepare update data
        const updateData = {
            status: request.status,
            updated_at: new Date().toISOString()
        };
        // If marking as completed, set completed_date
        if (request.status === 'completed') {
            updateData.completed_date = request.completed_date || new Date().toISOString();
        }
        // Add notes if provided
        if (request.notes) {
            updateData.notes = request.notes;
        }
        // Update the task
        const { data, error } = await supabaseServiceRole
            .from('tasks')
            .update(updateData)
            .eq('id', taskId)
            .eq('site_id', request.site_id) // Additional security filter
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating task ${taskId}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Task ${taskId} not found or update failed`
            };
        }
        console.log(`✅ Successfully updated task ${taskId} status to '${request.status}'`);
        if (request.status === 'completed') {
            console.log(`🎉 Task marked as completed at: ${updateData.completed_date}`);
        }
        // Update lead status to 'contacted' when task is completed
        if (request.status === 'completed') {
            console.log(`👤 Updating lead ${request.lead_id} status to 'contacted' after task completion...`);
            const leadUpdateData = {
                status: 'contacted',
                updated_at: new Date().toISOString(),
                last_contact: new Date().toISOString()
            };
            const { error: leadError } = await supabaseServiceRole
                .from('leads')
                .update(leadUpdateData)
                .eq('id', request.lead_id)
                .eq('site_id', request.site_id);
            if (leadError) {
                console.error(`❌ Warning: Failed to update lead status to 'contacted':`, leadError);
                // Don't fail the entire operation for lead update failure
            }
            else {
                console.log(`✅ Successfully updated lead ${request.lead_id} status to 'contacted'`);
            }
        }
        return {
            success: true,
            updated_task_id: taskId,
            task_found: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating task status:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to invalidate a lead by removing site_id and adding invalidation metadata
 */
async function invalidateLeadActivity(request) {
    console.log(`🚫 Invalidating lead ${request.lead_id} - reason: ${request.reason}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot invalidate lead');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, invalidating lead...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // First get current lead data to preserve existing notes
        console.log(`📝 Fetching current lead data to preserve existing notes...`);
        const { data: currentLead, error: fetchError } = await supabaseServiceRole
            .from('leads')
            .select('notes')
            .eq('id', request.lead_id)
            .single();
        if (fetchError) {
            console.error(`❌ Error fetching current lead data:`, fetchError);
            return {
                success: false,
                error: fetchError.message
            };
        }
        // Only add metadata for email_failed or whatsapp_failed reasons
        const shouldAddMetadata = request.reason === 'email_failed' || request.reason === 'whatsapp_failed';
        const updateData = {
            site_id: null, // Remove site_id to remove lead from site
            updated_at: new Date().toISOString()
        };
        // Handle notes concatenation if response_message is provided
        if (request.response_message) {
            const invalidationNote = "Lead invalidated due to invalid email and no WhatsApp available (early validation)";
            const existingNotes = currentLead.notes || '';
            // Concatenate existing notes with invalidation note and response message
            if (existingNotes.trim()) {
                updateData.notes = `${existingNotes}\n\n${invalidationNote}\n${request.response_message}`;
            }
            else {
                updateData.notes = `${invalidationNote}\n${request.response_message}`;
            }
            console.log(`📝 Concatenating notes:`);
            console.log(`   - Existing notes: ${existingNotes ? '"' + existingNotes.substring(0, 100) + '..."' : 'None'}`);
            console.log(`   - Adding invalidation note: "${invalidationNote}"`);
            console.log(`   - Adding response message: "${request.response_message}"`);
        }
        if (shouldAddMetadata) {
            // Prepare invalidation metadata only for communication failures
            const invalidationMetadata = {
                invalidated: true,
                invalidated_at: new Date().toISOString(),
                invalidation_reason: request.reason,
                original_site_id: request.original_site_id,
                pending_revalidation: true,
                failed_contact: request.failed_contact || {},
                invalidated_by_user_id: request.userId,
            };
            // If this is a shared contact invalidation, add reference
            if (request.shared_with_lead_id) {
                invalidationMetadata.shared_with_lead_id = request.shared_with_lead_id;
            }
            updateData.metadata = invalidationMetadata;
            console.log(`📝 Adding invalidation metadata for ${request.reason}`);
        }
        else {
            console.log(`📋 Reason '${request.reason}' - only removing site_id, no metadata added`);
        }
        const { data, error } = await supabaseServiceRole
            .from('leads')
            .update(updateData)
            .eq('id', request.lead_id)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error invalidating lead ${request.lead_id}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Lead ${request.lead_id} not found or update failed`
            };
        }
        console.log(`✅ Successfully invalidated lead ${request.lead_id}`);
        console.log(`📝 Invalidation metadata added to lead`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception invalidating lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to invalidate only email from a lead (when lead has alternative contact methods like WhatsApp)
 * This removes only the email field but keeps the site_id
 */
async function invalidateEmailOnlyActivity(request) {
    console.log(`📧🚫 Invalidating only email for lead ${request.lead_id} - email: ${request.failed_email}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot invalidate email');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, invalidating email only...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Only remove the email field, keep site_id and other data
        const updateData = {
            email: null, // Remove invalid email
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabaseServiceRole
            .from('leads')
            .update(updateData)
            .eq('id', request.lead_id)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error invalidating email for lead ${request.lead_id}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Lead ${request.lead_id} not found or update failed`
            };
        }
        console.log(`✅ Successfully invalidated email for lead ${request.lead_id}`);
        console.log(`📝 Email removed, site_id preserved: ${data.site_id}`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception invalidating email for lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to find leads that share the same contact information
 */
async function findLeadsBySharedContactActivity(request) {
    console.log(`🔍 Finding leads with shared contact information...`);
    console.log(`📧 Email: ${request.email || 'N/A'}`);
    console.log(`📞 Phone: ${request.telephone || 'N/A'}`);
    console.log(`🚫 Excluding lead: ${request.exclude_lead_id || 'N/A'}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot search for shared leads');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, searching for shared contact leads...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        if (!request.email && !request.telephone) {
            console.log('⚠️ No contact information provided for search');
            return {
                success: true,
                leads: []
            };
        }
        let query = supabaseServiceRole
            .from('leads')
            .select('id, name, email, phone, site_id, status, metadata');
        // Build OR condition for shared contact
        const orConditions = [];
        if (request.email) {
            orConditions.push(`email.eq.${request.email}`);
        }
        if (request.telephone) {
            orConditions.push(`phone.eq.${request.telephone}`);
        }
        if (orConditions.length > 0) {
            query = query.or(orConditions.join(','));
        }
        // Exclude the original lead if specified
        if (request.exclude_lead_id) {
            query = query.neq('id', request.exclude_lead_id);
        }
        // Only search within the same site if specified
        if (request.site_id) {
            query = query.eq('site_id', request.site_id);
        }
        // Only include active leads (not already invalidated)
        query = query.neq('status', 'invalidated');
        const { data: leads, error } = await query;
        if (error) {
            console.error(`❌ Error searching for shared contact leads:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        console.log(`✅ Found ${leads?.length || 0} leads with shared contact information`);
        if (leads && leads.length > 0) {
            console.log('📋 Shared contact leads:');
            leads.forEach((lead, index) => {
                console.log(`   ${index + 1}. ${lead.name || lead.email} (${lead.id}) - Site: ${lead.site_id}`);
            });
        }
        return {
            success: true,
            leads: leads || []
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception searching for shared contact leads:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to update lead invalidation metadata
 * This can be used for additional metadata updates after invalidation
 */
async function updateLeadInvalidationMetadataActivity(request) {
    console.log(`📝 Updating invalidation metadata for lead ${request.lead_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update lead metadata');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, updating lead metadata...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // First get current metadata
        const { data: currentLead, error: fetchError } = await supabaseServiceRole
            .from('leads')
            .select('metadata')
            .eq('id', request.lead_id)
            .single();
        if (fetchError) {
            console.error(`❌ Error fetching current lead metadata:`, fetchError);
            return {
                success: false,
                error: fetchError.message
            };
        }
        // Merge with additional metadata
        const updatedMetadata = {
            ...currentLead.metadata || {},
            ...request.additional_metadata,
            metadata_updated_at: new Date().toISOString()
        };
        // Update lead metadata
        const { data, error } = await supabaseServiceRole
            .from('leads')
            .update({
            metadata: updatedMetadata,
            updated_at: new Date().toISOString()
        })
            .eq('id', request.lead_id)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating lead metadata:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Lead ${request.lead_id} not found or update failed`
            };
        }
        console.log(`✅ Successfully updated invalidation metadata for lead ${request.lead_id}`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating lead invalidation metadata:`, errorMessage);
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
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
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
/**
 * Activity to cleanup failed follow-up attempts
 * This cleans up conversations, messages, and tasks when message delivery fails
 * Also resets lead status to 'new' if no other conversations exist
 */
async function cleanupFailedFollowUpActivity(request) {
    console.log(`🧹 Starting cleanup for failed follow-up delivery...`);
    console.log(`📋 Lead ID: ${request.lead_id}, Site ID: ${request.site_id}`);
    console.log(`❌ Failure reason: ${request.failure_reason}`);
    console.log(`📞 Channel: ${request.delivery_channel}, Phone: ${request.phone_number}, Email: ${request.email}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot perform cleanup');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, starting cleanup process...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        let conversationDeleted = false;
        let messageDeleted = false;
        let taskDeleted = false;
        let leadResetToNew = false;
        const cleanupSummary = {
            conversations_found: 0,
            messages_in_conversation: 0,
            tasks_found: 0,
            other_conversations_exist: false
        };
        // Step 1: Find the conversation to cleanup (either provided or search by lead_id)
        let targetConversationId = request.conversation_id;
        if (!targetConversationId) {
            console.log(`🔍 No conversation ID provided, searching for conversation by lead_id...`);
            const { data: conversation, error: findError } = await supabaseServiceRole
                .from('conversations')
                .select('id, status, created_at')
                .eq('lead_id', request.lead_id)
                .eq('site_id', request.site_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (findError && findError.code !== 'PGRST116') {
                console.error(`❌ Error searching for conversation:`, findError);
                return {
                    success: false,
                    error: `Failed to search for conversation: ${findError.message}`
                };
            }
            if (conversation) {
                targetConversationId = conversation.id;
                console.log(`✅ Found conversation to cleanup: ${targetConversationId} (status: ${conversation.status})`);
            }
            else {
                console.log(`⚠️ No conversation found for lead ${request.lead_id} - cleanup will focus on tasks only`);
            }
        }
        // Step 2: Check how many conversations exist for this lead
        console.log(`🔍 Checking total conversations for lead ${request.lead_id}...`);
        const { data: allConversations, error: countError } = await supabaseServiceRole
            .from('conversations')
            .select('id, status, created_at')
            .eq('lead_id', request.lead_id)
            .eq('site_id', request.site_id)
            .order('created_at', { ascending: false });
        if (countError) {
            console.error(`❌ Error counting conversations:`, countError);
            return {
                success: false,
                error: `Failed to count conversations: ${countError.message}`
            };
        }
        cleanupSummary.conversations_found = allConversations?.length || 0;
        cleanupSummary.other_conversations_exist = (allConversations?.length || 0) > 1;
        console.log(`📊 Found ${cleanupSummary.conversations_found} total conversations for this lead`);
        console.log(`🔍 Other conversations exist: ${cleanupSummary.other_conversations_exist}`);
        // Step 3: If we have a target conversation, check its messages and potentially delete it
        if (targetConversationId) {
            console.log(`🔍 Checking messages in conversation ${targetConversationId}...`);
            const { data: messages, error: messagesError } = await supabaseServiceRole
                .from('messages')
                .select('id, role, content, custom_data, created_at')
                .eq('conversation_id', targetConversationId)
                .order('created_at', { ascending: false });
            if (messagesError) {
                console.error(`❌ Error fetching messages:`, messagesError);
                return {
                    success: false,
                    error: `Failed to fetch messages: ${messagesError.message}`
                };
            }
            cleanupSummary.messages_in_conversation = messages?.length || 0;
            console.log(`📊 Found ${cleanupSummary.messages_in_conversation} messages in conversation`);
            // Step 3.1: Delete specific message if provided
            if (request.message_id) {
                console.log(`🗑️ Deleting specific message ${request.message_id}...`);
                const { error: deleteMessageError } = await supabaseServiceRole
                    .from('messages')
                    .delete()
                    .eq('id', request.message_id)
                    .eq('conversation_id', targetConversationId);
                if (deleteMessageError) {
                    console.error(`❌ Error deleting message ${request.message_id}:`, deleteMessageError);
                }
                else {
                    messageDeleted = true;
                    console.log(`✅ Successfully deleted message ${request.message_id}`);
                    // Update message count after deletion for accurate conversation cleanup decision
                    cleanupSummary.messages_in_conversation = Math.max(0, cleanupSummary.messages_in_conversation - 1);
                    console.log(`📊 Updated message count after deletion: ${cleanupSummary.messages_in_conversation} messages remaining`);
                }
            }
            // Step 3.2: Delete conversation if it has no messages remaining (especially important for lead generation)
            if (cleanupSummary.messages_in_conversation === 0) {
                console.log(`🗑️ Deleting conversation ${targetConversationId} (${cleanupSummary.messages_in_conversation} messages remaining - empty conversation cleanup)...`);
                // First delete any remaining messages
                const { error: deleteMessagesError } = await supabaseServiceRole
                    .from('messages')
                    .delete()
                    .eq('conversation_id', targetConversationId);
                if (deleteMessagesError) {
                    console.error(`⚠️ Error deleting messages from conversation:`, deleteMessagesError);
                }
                // Then delete the conversation
                const { error: deleteConversationError } = await supabaseServiceRole
                    .from('conversations')
                    .delete()
                    .eq('id', targetConversationId)
                    .eq('site_id', request.site_id);
                if (deleteConversationError) {
                    console.error(`❌ Error deleting conversation ${targetConversationId}:`, deleteConversationError);
                }
                else {
                    conversationDeleted = true;
                    console.log(`✅ Successfully deleted conversation ${targetConversationId}`);
                }
            }
            else {
                console.log(`⚠️ Keeping conversation ${targetConversationId} (has ${cleanupSummary.messages_in_conversation} messages remaining - preserving conversation with history)`);
            }
        }
        // Step 4: Delete only tasks linked to the specific conversation (if conversation_id provided)
        if (request.conversation_id) {
            console.log(`🔍 Searching for tasks linked to conversation ${request.conversation_id}...`);
            const { data: tasks, error: tasksError } = await supabaseServiceRole
                .from('tasks')
                .select('id, task_id, name, stage, status, custom_data, created_at')
                .eq('lead_id', request.lead_id)
                .eq('site_id', request.site_id)
                .eq('conversation_id', request.conversation_id)
                .order('created_at', { ascending: false });
            if (tasksError) {
                console.error(`❌ Error fetching conversation-specific tasks:`, tasksError);
            }
            else {
                cleanupSummary.tasks_found = tasks?.length || 0;
                console.log(`📊 Found ${cleanupSummary.tasks_found} tasks linked to this conversation`);
                if (tasks && tasks.length > 0) {
                    console.log(`🗑️ Deleting ${tasks.length} conversation-specific tasks...`);
                    for (const task of tasks) {
                        console.log(`   - Deleting task: ${task.name} (${task.stage}/${task.status}) linked to conversation ${request.conversation_id}`);
                    }
                    const { error: deleteTasksError } = await supabaseServiceRole
                        .from('tasks')
                        .delete()
                        .eq('lead_id', request.lead_id)
                        .eq('site_id', request.site_id)
                        .eq('conversation_id', request.conversation_id);
                    if (deleteTasksError) {
                        console.error(`❌ Error deleting conversation-specific tasks:`, deleteTasksError);
                    }
                    else {
                        taskDeleted = true;
                        console.log(`✅ Successfully deleted ${tasks.length} conversation-specific tasks`);
                    }
                }
            }
        }
        else {
            // Fallback: If no conversation_id provided, find most recent tasks for this lead
            console.log(`⚠️ No conversation_id provided - searching for recent tasks to cleanup for lead ${request.lead_id}...`);
            const { data: tasks, error: tasksError } = await supabaseServiceRole
                .from('tasks')
                .select('id, task_id, name, stage, status, custom_data, created_at')
                .eq('lead_id', request.lead_id)
                .eq('site_id', request.site_id)
                .order('created_at', { ascending: false })
                .limit(1); // Only get the most recent task
            if (tasksError) {
                console.error(`❌ Error fetching recent tasks:`, tasksError);
            }
            else {
                cleanupSummary.tasks_found = tasks?.length || 0;
                console.log(`📊 Found ${cleanupSummary.tasks_found} recent task(s) for this lead`);
                if (tasks && tasks.length > 0) {
                    const recentTask = tasks[0];
                    console.log(`🗑️ Deleting most recent task: ${recentTask.name} (${recentTask.stage}/${recentTask.status})...`);
                    const { error: deleteTasksError } = await supabaseServiceRole
                        .from('tasks')
                        .delete()
                        .eq('id', recentTask.id);
                    if (deleteTasksError) {
                        console.error(`❌ Error deleting recent task:`, deleteTasksError);
                    }
                    else {
                        taskDeleted = true;
                        console.log(`✅ Successfully deleted most recent task for lead ${request.lead_id}`);
                    }
                }
            }
        }
        // Step 5: Reset lead status to 'new' if no other conversations exist
        if (!cleanupSummary.other_conversations_exist) {
            console.log(`🔄 Resetting lead ${request.lead_id} status to 'new' (no other conversations exist)...`);
            const { data: leadData, error: resetError } = await supabaseServiceRole
                .from('leads')
                .update({
                status: 'new',
                updated_at: new Date().toISOString(),
                custom_data: {
                    cleanup_performed: true,
                    cleanup_reason: request.failure_reason,
                    cleanup_timestamp: new Date().toISOString(),
                    original_follow_up_failure: {
                        channel: request.delivery_channel,
                        phone: request.phone_number,
                        email: request.email,
                        reason: request.failure_reason
                    }
                }
            })
                .eq('id', request.lead_id)
                .eq('site_id', request.site_id)
                .select()
                .single();
            if (resetError) {
                console.error(`❌ Error resetting lead status:`, resetError);
            }
            else if (leadData) {
                leadResetToNew = true;
                console.log(`✅ Successfully reset lead ${request.lead_id} status to 'new'`);
            }
        }
        else {
            console.log(`⚠️ Keeping lead status unchanged (${cleanupSummary.conversations_found} total conversations exist)`);
        }
        // Step 6: Log cleanup summary
        console.log(`🎉 Cleanup completed for failed follow-up!`);
        console.log(`📊 Cleanup summary:`);
        console.log(`   - Conversation deleted: ${conversationDeleted}`);
        console.log(`   - Message deleted: ${messageDeleted}`);
        console.log(`   - Tasks deleted: ${taskDeleted} (${cleanupSummary.tasks_found} found)`);
        console.log(`   - Lead reset to 'new': ${leadResetToNew}`);
        console.log(`   - Other conversations exist: ${cleanupSummary.other_conversations_exist}`);
        console.log(`   - Total conversations found: ${cleanupSummary.conversations_found}`);
        return {
            success: true,
            conversation_deleted: conversationDeleted,
            message_deleted: messageDeleted,
            task_deleted: taskDeleted,
            lead_reset_to_new: leadResetToNew,
            cleanup_summary: cleanupSummary
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception during failed follow-up cleanup:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to delete all conversations for a lead during hard invalidation
 * This is used when a lead has no valid contact methods (no email and no WhatsApp)
 * and there's no point in keeping conversation data
 */
async function deleteLeadConversationsActivity(request) {
    console.log(`🗑️ Starting conversation cleanup for hard invalidated lead ${request.lead_id}...`);
    console.log(`📋 Reason: ${request.reason}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot delete conversations');
            return {
                success: false,
                error: 'Database not available',
                conversations_deleted: 0,
                messages_deleted: 0
            };
        }
        console.log('✅ Database connection confirmed, proceeding with conversation cleanup...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Step 1: Find all conversations for this lead
        console.log(`🔍 Finding all conversations for lead ${request.lead_id}...`);
        const { data: conversations, error: findError } = await supabaseServiceRole
            .from('conversations')
            .select('id, created_at, status')
            .eq('lead_id', request.lead_id)
            .eq('site_id', request.site_id)
            .order('created_at', { ascending: false });
        if (findError) {
            console.error(`❌ Error finding conversations:`, findError);
            return {
                success: false,
                error: `Failed to find conversations: ${findError.message}`,
                conversations_deleted: 0,
                messages_deleted: 0
            };
        }
        const conversationsFound = conversations?.length || 0;
        console.log(`📊 Found ${conversationsFound} conversations for lead ${request.lead_id}`);
        if (conversationsFound === 0) {
            console.log(`ℹ️ No conversations found for lead ${request.lead_id} - cleanup complete`);
            return {
                success: true,
                conversations_deleted: 0,
                messages_deleted: 0,
                cleanup_summary: {
                    conversations_found: 0,
                    total_messages_deleted: 0
                }
            };
        }
        let totalMessagesDeleted = 0;
        let conversationsDeleted = 0;
        // Step 2: Delete messages and conversations for each conversation
        for (const conversation of conversations) {
            console.log(`🗑️ Processing conversation ${conversation.id}...`);
            // Step 2a: Delete all messages in this conversation
            const { error: deleteMessagesError, count: messagesDeletedCount } = await supabaseServiceRole
                .from('messages')
                .delete({ count: 'exact' })
                .eq('conversation_id', conversation.id);
            if (deleteMessagesError) {
                console.error(`⚠️ Error deleting messages from conversation ${conversation.id}:`, deleteMessagesError);
            }
            else {
                const messagesDeleted = messagesDeletedCount || 0;
                totalMessagesDeleted += messagesDeleted;
                console.log(`✅ Deleted ${messagesDeleted} messages from conversation ${conversation.id}`);
            }
            // Step 2b: Delete the conversation itself
            const { error: deleteConversationError } = await supabaseServiceRole
                .from('conversations')
                .delete()
                .eq('id', conversation.id)
                .eq('site_id', request.site_id);
            if (deleteConversationError) {
                console.error(`❌ Error deleting conversation ${conversation.id}:`, deleteConversationError);
            }
            else {
                conversationsDeleted++;
                console.log(`✅ Successfully deleted conversation ${conversation.id}`);
            }
        }
        console.log(`🎉 Conversation cleanup completed for lead ${request.lead_id}:`);
        console.log(`   - Conversations deleted: ${conversationsDeleted}/${conversationsFound}`);
        console.log(`   - Total messages deleted: ${totalMessagesDeleted}`);
        console.log(`   - Reason: ${request.reason}`);
        return {
            success: true,
            conversations_deleted: conversationsDeleted,
            messages_deleted: totalMessagesDeleted,
            cleanup_summary: {
                conversations_found: conversationsFound,
                total_messages_deleted: totalMessagesDeleted
            }
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception during conversation cleanup:`, errorMessage);
        return {
            success: false,
            error: errorMessage,
            conversations_deleted: 0,
            messages_deleted: 0
        };
    }
}
/**
 * Activity to update lead metadata with email verification status
 */
async function updateLeadEmailVerificationActivity(request) {
    console.log(`📧✅ Updating email verification status for lead ${request.lead_id}: ${request.emailVerified}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot update email verification');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, updating email verification status...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Get current lead data to merge with existing metadata
        const { data: currentLead, error: fetchError } = await supabaseServiceRole
            .from('leads')
            .select('metadata, email')
            .eq('id', request.lead_id)
            .single();
        if (fetchError) {
            console.error(`❌ Error fetching current lead data: ${fetchError.message}`);
            return {
                success: false,
                error: fetchError.message
            };
        }
        // Prepare updated metadata
        const currentMetadata = currentLead?.metadata || {};
        const updatedMetadata = {
            ...currentMetadata,
            emailVerified: request.emailVerified,
            emailVerificationTimestamp: new Date().toISOString(),
            emailVerificationWorkflow: 'leadResearchWorkflow'
        };
        // If a validated email is provided and it's different from current, update it
        const updateData = {
            metadata: updatedMetadata,
            updated_at: new Date().toISOString()
        };
        if (request.validatedEmail && request.validatedEmail !== currentLead?.email) {
            updateData.email = request.validatedEmail;
            console.log(`📧 Updating email from ${currentLead?.email} to ${request.validatedEmail}`);
        }
        const { data, error } = await supabaseServiceRole
            .from('leads')
            .update(updateData)
            .eq('id', request.lead_id)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating email verification for lead ${request.lead_id}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
        if (!data) {
            return {
                success: false,
                error: `Lead ${request.lead_id} not found or update failed`
            };
        }
        console.log(`✅ Successfully updated email verification for lead ${request.lead_id}`);
        console.log(`📝 Email verified status: ${request.emailVerified}`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception updating email verification for lead ${request.lead_id}:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to invalidate referred leads when a lead with referral_lead_id is invalidated
 *
 * This activity:
 * 1. Finds all leads that have the same referral_lead_id as the invalidated lead
 * 2. Finds the referral lead itself (the lead that referral_lead_id points to)
 * 3. Invalidates only those leads that share the same email or phone as the original lead
 */
async function invalidateReferredLeads(request) {
    console.log(`🔗 Invalidating referred leads for referral_lead_id: ${request.referral_lead_id}`);
    const invalidatedLeads = [];
    const errors = [];
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, cannot invalidate referred leads');
            return {
                success: false,
                invalidated_leads: [],
                errors: ['Database not available']
            };
        }
        console.log('✅ Database connection confirmed, finding referred leads...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Step 1: Find all leads with the same referral_lead_id (excluding the original lead)
        console.log(`🔍 Finding leads with referral_lead_id: ${request.referral_lead_id}...`);
        const { data: referredLeads, error: referredError } = await supabaseServiceRole
            .from('leads')
            .select('id, email, phone, site_id')
            .eq('referral_lead_id', request.referral_lead_id)
            .neq('id', request.lead_id) // Exclude the original invalidated lead
            .not('site_id', 'is', null); // Only get leads that are still active (have site_id)
        if (referredError) {
            console.error(`❌ Error finding referred leads:`, referredError);
            errors.push(`Failed to find referred leads: ${referredError.message}`);
        }
        else if (referredLeads && referredLeads.length > 0) {
            console.log(`📋 Found ${referredLeads.length} leads with same referral_lead_id`);
            // Filter leads that share the same email or phone as the original lead
            const leadsToInvalidate = referredLeads.filter(lead => {
                const sameEmail = request.original_email && lead.email === request.original_email;
                const samePhone = request.original_phone && lead.phone === request.original_phone;
                return sameEmail || samePhone;
            });
            console.log(`🎯 ${leadsToInvalidate.length} leads share contact info and will be invalidated`);
            // Invalidate each matching lead
            for (const leadToInvalidate of leadsToInvalidate) {
                try {
                    console.log(`🚫 Invalidating referred lead ${leadToInvalidate.id}...`);
                    const invalidationResult = await invalidateLeadActivity({
                        lead_id: leadToInvalidate.id,
                        original_site_id: leadToInvalidate.site_id,
                        reason: `referral_${request.reason}`,
                        failed_contact: {
                            email: request.original_email,
                            telephone: request.original_phone
                        },
                        userId: request.userId,
                        shared_with_lead_id: request.lead_id,
                        response_message: request.response_message ?
                            `${request.response_message} (referred lead invalidation)` :
                            undefined
                    });
                    if (invalidationResult.success) {
                        invalidatedLeads.push(leadToInvalidate.id);
                        console.log(`✅ Successfully invalidated referred lead ${leadToInvalidate.id}`);
                    }
                    else {
                        const errorMsg = `Failed to invalidate referred lead ${leadToInvalidate.id}: ${invalidationResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        errors.push(errorMsg);
                    }
                }
                catch (leadError) {
                    const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
                    console.error(`❌ Exception invalidating referred lead ${leadToInvalidate.id}:`, errorMessage);
                    errors.push(`Exception invalidating referred lead ${leadToInvalidate.id}: ${errorMessage}`);
                }
            }
        }
        else {
            console.log(`ℹ️ No referred leads found with referral_lead_id: ${request.referral_lead_id}`);
        }
        // Step 2: Check and invalidate the referral lead itself if it shares contact info
        console.log(`🔍 Checking referral lead ${request.referral_lead_id}...`);
        const { data: referralLead, error: referralError } = await supabaseServiceRole
            .from('leads')
            .select('id, email, phone, site_id')
            .eq('id', request.referral_lead_id)
            .not('site_id', 'is', null) // Only if still active
            .single();
        if (referralError) {
            if (referralError.code === 'PGRST116') {
                console.log(`ℹ️ Referral lead ${request.referral_lead_id} not found or already invalidated`);
            }
            else {
                console.error(`❌ Error finding referral lead:`, referralError);
                errors.push(`Failed to find referral lead: ${referralError.message}`);
            }
        }
        else if (referralLead) {
            // Check if referral lead shares contact info with original lead
            const sameEmail = request.original_email && referralLead.email === request.original_email;
            const samePhone = request.original_phone && referralLead.phone === request.original_phone;
            if (sameEmail || samePhone) {
                console.log(`🎯 Referral lead ${request.referral_lead_id} shares contact info, invalidating...`);
                try {
                    const referralInvalidationResult = await invalidateLeadActivity({
                        lead_id: referralLead.id,
                        original_site_id: referralLead.site_id,
                        reason: `referral_source_${request.reason}`,
                        failed_contact: {
                            email: request.original_email,
                            telephone: request.original_phone
                        },
                        userId: request.userId,
                        shared_with_lead_id: request.lead_id,
                        response_message: request.response_message ?
                            `${request.response_message} (referral source invalidation)` :
                            undefined
                    });
                    if (referralInvalidationResult.success) {
                        invalidatedLeads.push(referralLead.id);
                        console.log(`✅ Successfully invalidated referral lead ${referralLead.id}`);
                    }
                    else {
                        const errorMsg = `Failed to invalidate referral lead ${referralLead.id}: ${referralInvalidationResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        errors.push(errorMsg);
                    }
                }
                catch (referralLeadError) {
                    const errorMessage = referralLeadError instanceof Error ? referralLeadError.message : String(referralLeadError);
                    console.error(`❌ Exception invalidating referral lead ${referralLead.id}:`, errorMessage);
                    errors.push(`Exception invalidating referral lead ${referralLead.id}: ${errorMessage}`);
                }
            }
            else {
                console.log(`ℹ️ Referral lead ${request.referral_lead_id} does not share contact info, skipping invalidation`);
            }
        }
        console.log(`🎉 Referred leads invalidation completed. Invalidated: ${invalidatedLeads.length}, Errors: ${errors.length}`);
        return {
            success: true,
            invalidated_leads: invalidatedLeads,
            errors
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception in invalidateReferredLeads:`, errorMessage);
        return {
            success: false,
            invalidated_leads: invalidatedLeads,
            errors: [...errors, errorMessage]
        };
    }
}
