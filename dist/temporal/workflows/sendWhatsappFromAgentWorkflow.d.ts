/**
 * Workflow parameters interface
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
/**
 * Workflow result interface
 */
export interface SendWhatsAppFromAgentResult {
    success: boolean;
    messageId: string;
    recipient: string;
    executionTime: string;
    timestamp: string;
}
/**
 * Send WhatsApp From Agent Workflow
 * Sends a WhatsApp message via the agent API endpoint
 */
export declare function sendWhatsappFromAgent(params: SendWhatsAppFromAgentParams): Promise<SendWhatsAppFromAgentResult>;
