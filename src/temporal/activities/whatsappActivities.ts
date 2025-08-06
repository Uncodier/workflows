import { apiService } from '../services/apiService';

/**
 * WhatsApp Activities
 * Activities for handling WhatsApp message analysis and responses
 */

export interface WhatsAppMessageData {
  messageContent: string;
  phoneNumber: string;
  senderName?: string;
  messageId?: string;
  conversationId?: string;
  businessAccountId?: string;
  agentId?: string;
  siteId: string;
  userId: string;
  timestamp?: string;
  message_type?: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location';
  media_url?: string;
  is_from_business?: boolean;
}

export interface WhatsAppAnalysisRequest {
  message: string;
  phone: string;
  contact_name?: string;
  message_id?: string;
  conversation_id?: string;
  timestamp?: string;
  site_id: string;
  user_id: string;
  message_type?: string;
  media_url?: string;
  is_from_business?: boolean;
}

export interface WhatsAppAnalysisResponse {
  success: boolean;
  analysis?: {
    intent: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'greeting' | 'follow_up' | 'unknown';
    priority: 'high' | 'medium' | 'low';
    response_type: 'automated' | 'human_required' | 'information' | 'commercial';
    sentiment: 'positive' | 'neutral' | 'negative';
    suggested_response?: string;
    requires_action: boolean;
    contact_info?: {
      name?: string;
      phone: string;
      email?: string;
      company?: string;
    };
    summary: string;
    keywords?: string[];
    analysis_id?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Analyze WhatsApp message using AI
 */
export async function analyzeWhatsAppMessageActivity(
  messageData: WhatsAppMessageData
): Promise<WhatsAppAnalysisResponse> {
  console.log('📱 Analyzing WhatsApp message...');
  console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
  console.log(`💬 Message: ${messageData.messageContent?.substring(0, 100) || 'No message content'}...`);
  
  try {
    // Prepare request payload
    const analysisRequest: WhatsAppAnalysisRequest = {
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

    const response = await apiService.post('/api/agents/whatsapp/analyze', analysisRequest);
    
    if (!response.success) {
      console.error('❌ WhatsApp analysis failed:', response.error);
      throw new Error(`Failed to analyze WhatsApp message: ${response.error?.message || 'Unknown error'}`);
    }
    
    console.log('✅ WhatsApp analysis completed successfully');
    console.log('📊 Analysis result:', JSON.stringify(response.data, null, 2));
    
    return {
      success: true,
      analysis: response.data
    };
    
  } catch (error) {
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
export async function sendWhatsAppResponseActivity(
  responseData: {
    phone: string;
    message: string;
    conversation_id?: string;
    site_id: string;
    user_id: string;
    agent_id?: string;
    message_type?: 'text' | 'image' | 'document';
    media_url?: string;
  }
): Promise<{
  success: boolean;
  message_id?: string;
  error?: string;
}> {
  console.log('📱 Sending WhatsApp response...');
  console.log(`📞 To: ${responseData.phone}`);
  console.log(`💬 Message: ${responseData.message?.substring(0, 100) || 'No message content'}...`);
  
  try {
    const response = await apiService.post('/api/agents/whatsapp/send', {
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
    
  } catch (error) {
    console.error('❌ WhatsApp response failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * WhatsApp From Agent Activity interfaces
 */
export interface SendWhatsAppFromAgentParams {
  phone_number: string;
  message: string;
  site_id: string;
  from?: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
}

export interface SendWhatsAppFromAgentResult {
  success: boolean;
  messageId: string;
  recipient: string;
  timestamp: string;
  template_required?: boolean; // ✅ Nueva propiedad para indicar si se requiere template
}

/**
 * Activity to send WhatsApp message via agent API
 */
export async function sendWhatsAppFromAgentActivity(params: SendWhatsAppFromAgentParams): Promise<SendWhatsAppFromAgentResult> {
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
    const apiPayload: any = {
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
    } else {
      console.log(`⚠️ Skipping lead_id - API will obtain it from phone_number: ${params.phone_number}`);
    }

    const response = await apiService.post('/api/agents/tools/sendWhatsApp', apiPayload);

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

  } catch (error) {
    console.error('❌ WhatsApp sending failed:', error);
    throw new Error(`WhatsApp sending failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Interface for createTemplate activity parameters
 */
export interface CreateTemplateParams {
  message_id: string;
  phone_number: string;
  message: string;
  site_id: string;
}

/**
 * Interface for createTemplate activity result
 */
export interface CreateTemplateResult {
  success: boolean;
  template_id: string;
  timestamp: string;
}

/**
 * Activity to create WhatsApp template
 */
export async function createTemplateActivity(params: CreateTemplateParams): Promise<CreateTemplateResult> {
  console.log('📄 Creating WhatsApp template:', {
    message_id: params.message_id,
    phone_number: params.phone_number,
    site_id: params.site_id,
    messageLength: params.message.length
  });

  try {
    const response = await apiService.post('/api/agents/whatsapp/createTemplate', {
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

  } catch (error) {
    console.error('❌ WhatsApp template creation failed:', error);
    throw new Error(`WhatsApp template creation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Interface for sendTemplate activity parameters
 */
export interface SendTemplateParams {
  template_id: string;
  phone_number: string;
  site_id: string;
  message_id?: string;       // Para tracking
  original_message?: string; // Para logging
}

/**
 * Interface for sendTemplate activity result  
 */
export interface SendTemplateResult {
  success: boolean;
  messageId: string;
  timestamp: string;
}

/**
 * Activity to send WhatsApp template
 */
export async function sendTemplateActivity(params: SendTemplateParams): Promise<SendTemplateResult> {
  console.log('📤 Sending WhatsApp template:', {
    template_id: params.template_id,
    phone_number: params.phone_number,
    site_id: params.site_id,
    message_id: params.message_id || 'not-provided',
    original_message: params.original_message ? `${params.original_message.substring(0, 50)}...` : 'not-provided'
  });

  try {
    const response = await apiService.post('/api/agents/whatsapp/sendTemplate', {
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

  } catch (error) {
    console.error('❌ WhatsApp template sending failed:', error);
    throw new Error(`WhatsApp template sending failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Interface for updateMessageStatus activity parameters
 */
export interface UpdateMessageStatusParams {
  message_id: string; // ✅ This is actually the 'id' field from messages table
  status: 'failed' | 'sent' | 'pending';
  error_details?: string;
  site_id: string; // ✅ For validation and logging purposes
}

/**
 * Interface for updateMessageStatus activity result
 */
export interface UpdateMessageStatusResult {
  success: boolean;
  message_id: string;
  updated_status: string;
  timestamp: string;
}

/**
 * Activity to update message custom_data with status using Supabase
 */
export async function updateMessageStatusActivity(params: UpdateMessageStatusParams): Promise<UpdateMessageStatusResult> {
  console.log('📊 Updating message status via Supabase:', {
    message_id: params.message_id,
    status: params.status,
    site_id: params.site_id,
    hasErrorDetails: !!params.error_details
  });

  try {
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Prepare custom_data update
    const customDataUpdate: any = {
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

  } catch (error) {
    console.error('❌ Message status update failed:', error);
    throw new Error(`Message status update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Helper function to validate UUID format
 */
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
} 