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
    const response = await apiService.post('/api/agents/tools/sendWhatsApp', {
      phone_number: params.phone_number,
      message: params.message,
      site_id: params.site_id,
      from: params.from || 'AI Assistant',
      agent_id: params.agent_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id
    });

    if (!response.success) {
      throw new Error(`Failed to send WhatsApp message: ${response.error?.message}`);
    }

    console.log('✅ WhatsApp sent successfully via agent API:', response.data);

    return {
      success: true,
      messageId: response.data.messageId || 'unknown',
      recipient: params.phone_number,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ WhatsApp sending failed:', error);
    throw new Error(`WhatsApp sending failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} 