/**
 * Email Activity interfaces
 */
export interface SendEmailParams {
    email: string;
    from?: string;
    subject: string;
    message: string;
    site_id: string;
    agent_id?: string;
    conversation_id?: string;
    lead_id?: string;
}
export interface SendEmailResult {
    success: boolean;
    messageId: string;
    recipient: string;
    timestamp: string;
}
/**
 * Activity to send email via agent API
 */
export declare function sendEmailFromAgentActivity(params: SendEmailParams): Promise<SendEmailResult>;
