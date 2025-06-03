/**
 * Workflow parameters interface
 */
export interface SendEmailFromAgentParams {
    email: string;
    from?: string;
    subject: string;
    message: string;
    site_id: string;
    agent_id?: string;
    conversation_id?: string;
    lead_id?: string;
}
/**
 * Workflow result interface
 */
export interface SendEmailFromAgentResult {
    success: boolean;
    messageId: string;
    recipient: string;
    executionTime: string;
    timestamp: string;
}
/**
 * Send Email From Agent Workflow
 * Sends an email via the agent API endpoint
 */
export declare function sendEmailFromAgent(params: SendEmailFromAgentParams): Promise<SendEmailFromAgentResult>;
