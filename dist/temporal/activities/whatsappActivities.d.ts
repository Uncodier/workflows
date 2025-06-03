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
export declare function analyzeWhatsAppMessageActivity(messageData: WhatsAppMessageData): Promise<WhatsAppAnalysisResponse>;
/**
 * Send WhatsApp response message
 */
export declare function sendWhatsAppResponseActivity(responseData: {
    phone: string;
    message: string;
    conversation_id?: string;
    site_id: string;
    user_id: string;
    agent_id?: string;
    message_type?: 'text' | 'image' | 'document';
    media_url?: string;
}): Promise<{
    success: boolean;
    message_id?: string;
    error?: string;
}>;
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
export declare function sendWhatsAppFromAgentActivity(params: SendWhatsAppFromAgentParams): Promise<SendWhatsAppFromAgentResult>;
