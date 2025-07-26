"use strict";
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
exports.analyzeWhatsAppMessageActivity = analyzeWhatsAppMessageActivity;
exports.sendWhatsAppResponseActivity = sendWhatsAppResponseActivity;
exports.sendWhatsAppFromAgentActivity = sendWhatsAppFromAgentActivity;
exports.createTemplateActivity = createTemplateActivity;
exports.sendTemplateActivity = sendTemplateActivity;
exports.updateMessageStatusActivity = updateMessageStatusActivity;
const apiService_1 = require("../services/apiService");
/**
 * Analyze WhatsApp message using AI
 */
async function analyzeWhatsAppMessageActivity(messageData) {
    console.log('📱 Analyzing WhatsApp message...');
    console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
    console.log(`💬 Message: ${messageData.messageContent?.substring(0, 100) || 'No message content'}...`);
    try {
        // Prepare request payload
        const analysisRequest = {
            message: messageData.messageContent,
            phone: messageData.phoneNumber,
            site_id: messageData.siteId,
            user_id: messageData.userId,
            contact_name: messageData.senderName,
            message_id: messageData.messageId,
            conversation_id: messageData.conversationId,
            timestamp: messageData.timestamp || new Date().toISOString(),
            message_type: messageData.message_type || 'text',
            media_url: messageData.media_url,
            is_from_business: messageData.is_from_business || false
        };
        console.log('📤 Sending WhatsApp message for analysis:', {
            phone: analysisRequest.phone,
            messageLength: analysisRequest.message.length,
            messageType: analysisRequest.message_type,
            site_id: analysisRequest.site_id,
            user_id: analysisRequest.user_id,
            hasMediaUrl: !!analysisRequest.media_url,
            conversationId: analysisRequest.conversation_id
        });
        console.log('📋 Full analysis request:', JSON.stringify(analysisRequest, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/whatsapp/analyze', analysisRequest);
        if (!response.success) {
            console.error('❌ WhatsApp analysis failed:', response.error);
            return {
                success: false,
                error: {
                    code: response.error?.code || 'ANALYSIS_FAILED',
                    message: response.error?.message || 'Failed to analyze WhatsApp message'
                }
            };
        }
        console.log('✅ WhatsApp analysis completed successfully');
        console.log('📊 Analysis result:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            analysis: response.data
        };
    }
    catch (error) {
        console.error('❌ WhatsApp analysis activity failed:', error);
        return {
            success: false,
            error: {
                code: 'ACTIVITY_ERROR',
                message: error instanceof Error ? error.message : String(error)
            }
        };
    }
}
/**
 * Send WhatsApp response message
 */
async function sendWhatsAppResponseActivity(responseData) {
    console.log('📱 Sending WhatsApp response...');
    console.log(`📞 To: ${responseData.phone}`);
    console.log(`💬 Message: ${responseData.message?.substring(0, 100) || 'No message content'}...`);
    try {
        const response = await apiService_1.apiService.post('/api/agents/whatsapp/send', {
            phone: responseData.phone,
            message: responseData.message,
            conversation_id: responseData.conversation_id,
            site_id: responseData.site_id,
            user_id: responseData.user_id,
            agent_id: responseData.agent_id,
            message_type: responseData.message_type || 'text',
            media_url: responseData.media_url
        });
        if (!response.success) {
            throw new Error(`Failed to send WhatsApp message: ${response.error?.message}`);
        }
        console.log('✅ WhatsApp response sent successfully');
        return {
            success: true,
            message_id: response.data.message_id
        };
    }
    catch (error) {
        console.error('❌ WhatsApp response failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
/**
 * Activity to send WhatsApp message via agent API
 */
async function sendWhatsAppFromAgentActivity(params) {
    console.log('📱 Sending WhatsApp from agent:', {
        recipient: params.phone_number,
        from: params.from || 'AI Assistant',
        messageLength: params.message.length,
        site_id: params.site_id,
        agent_id: params.agent_id,
        conversation_id: params.conversation_id,
        lead_id: params.lead_id
    });
    try {
        // Prepare API payload - only include lead_id if it's a valid UUID
        const apiPayload = {
            phone_number: params.phone_number,
            message: params.message,
            site_id: params.site_id,
            from: params.from || 'AI Assistant',
            agent_id: params.agent_id,
            conversation_id: params.conversation_id,
        };
        // Only include lead_id if it's present and looks like a valid UUID
        // API can obtain lead_id from phone_number if not provided
        if (params.lead_id && isValidUUID(params.lead_id)) {
            apiPayload.lead_id = params.lead_id;
            console.log(`📋 Including valid lead_id: ${params.lead_id}`);
        }
        else {
            console.log(`⚠️ Skipping lead_id - API will obtain it from phone_number: ${params.phone_number}`);
        }
        const response = await apiService_1.apiService.post('/api/agents/tools/sendWhatsApp', apiPayload);
        if (!response.success) {
            throw new Error(`Failed to send WhatsApp message: ${response.error?.message}`);
        }
        console.log('✅ WhatsApp sent successfully via agent API:', response.data);
        return {
            success: true,
            messageId: response.data.message_id || 'unknown', // ✅ API returns message_id, not messageId
            recipient: params.phone_number,
            timestamp: new Date().toISOString(),
            template_required: response.data.template_required || false // ✅ Include template_required from API response
        };
    }
    catch (error) {
        console.error('❌ WhatsApp sending failed:', error);
        throw new Error(`WhatsApp sending failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to create WhatsApp template
 */
async function createTemplateActivity(params) {
    console.log('📄 Creating WhatsApp template:', {
        message_id: params.message_id,
        phone_number: params.phone_number,
        site_id: params.site_id,
        messageLength: params.message.length
    });
    try {
        const response = await apiService_1.apiService.post('/api/agents/whatsapp/createTemplate', {
            message_id: params.message_id,
            phone_number: params.phone_number,
            message: params.message,
            site_id: params.site_id
        });
        if (!response.success) {
            throw new Error(`Failed to create WhatsApp template: ${response.error?.message}`);
        }
        console.log('✅ WhatsApp template created successfully:', response.data);
        return {
            success: true,
            template_id: response.data.template_id,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('❌ WhatsApp template creation failed:', error);
        throw new Error(`WhatsApp template creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to send WhatsApp template
 */
async function sendTemplateActivity(params) {
    console.log('📤 Sending WhatsApp template:', {
        template_id: params.template_id,
        phone_number: params.phone_number,
        site_id: params.site_id,
        message_id: params.message_id || 'not-provided',
        original_message: params.original_message ? `${params.original_message.substring(0, 50)}...` : 'not-provided'
    });
    try {
        const response = await apiService_1.apiService.post('/api/agents/whatsapp/sendTemplate', {
            template_id: params.template_id,
            phone_number: params.phone_number,
            site_id: params.site_id,
            message_id: params.message_id,
            original_message: params.original_message
        });
        if (!response.success) {
            throw new Error(`Failed to send WhatsApp template: ${response.error?.message}`);
        }
        console.log('✅ WhatsApp template sent successfully:', response.data);
        return {
            success: true,
            messageId: response.data.message_id || 'unknown', // ✅ API returns message_id, not messageId
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('❌ WhatsApp template sending failed:', error);
        throw new Error(`WhatsApp template sending failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to update message custom_data with status using Supabase
 */
async function updateMessageStatusActivity(params) {
    console.log('📊 Updating message status via Supabase:', {
        message_id: params.message_id,
        status: params.status,
        site_id: params.site_id,
        hasErrorDetails: !!params.error_details
    });
    try {
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Prepare custom_data update
        const customDataUpdate = {
            status: params.status,
            updated_at: new Date().toISOString()
        };
        // Include error details if status is failed
        if (params.status === 'failed' && params.error_details) {
            customDataUpdate.error_details = params.error_details;
            customDataUpdate.error_timestamp = new Date().toISOString();
        }
        // Update message in Supabase
        const { data, error } = await supabaseServiceRole
            .from('messages')
            .update({
            custom_data: customDataUpdate
        })
            .eq('id', params.message_id) // ✅ Table uses 'id' as primary key, not 'message_id'
            .select();
        if (error) {
            throw new Error(`Supabase update failed: ${error.message}`);
        }
        if (!data || data.length === 0) {
            throw new Error(`Message not found with id: ${params.message_id} for site: ${params.site_id}`);
        }
        console.log('✅ Message status updated successfully in Supabase:', data[0]);
        return {
            success: true,
            message_id: params.message_id,
            updated_status: params.status,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('❌ Message status update failed:', error);
        throw new Error(`Message status update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Helper function to validate UUID format
 */
function isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}
