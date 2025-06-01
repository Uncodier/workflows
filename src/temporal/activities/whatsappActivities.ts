import { apiService } from '../services/apiService';

/**
 * WhatsApp Activities
 * Activities for handling WhatsApp message analysis and responses
 */

export interface WhatsAppMessageData {
  message: string;
  phone: string;
  contact_name?: string;
  message_id?: string;
  conversation_id?: string;
  timestamp?: string;
  site_id: string;
  user_id: string;
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
  console.log(`📞 From: ${messageData.contact_name || messageData.phone}`);
  console.log(`💬 Message: ${messageData.message.substring(0, 100)}...`);
  
  try {
    // Prepare request payload
    const analysisRequest: WhatsAppAnalysisRequest = {
      message: messageData.message,
      phone: messageData.phone,
      site_id: messageData.site_id,
      user_id: messageData.user_id,
      contact_name: messageData.contact_name,
      message_id: messageData.message_id,
      conversation_id: messageData.conversation_id,
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
  console.log(`💬 Message: ${responseData.message.substring(0, 100)}...`);
  
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