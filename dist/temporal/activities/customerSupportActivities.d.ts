/**
 * Customer Support Activities
 * Activities for handling customer support interactions
 */
export interface EmailData {
    summary: string;
    original_subject?: string;
    contact_info: {
        name: string | null;
        email: string | null;
        phone: string | null;
        company: string | null;
    };
    site_id: string;
    user_id: string;
    lead_notification: string;
    analysis_id?: string;
    lead_id?: string;
    priority?: 'high' | 'medium' | 'low';
    response_type?: 'commercial' | 'support' | 'informational' | 'follow_up';
    potential_value?: 'high' | 'medium' | 'low' | 'unknown';
    intent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
    conversation_id?: string;
    visitor_id?: string;
}
export interface ScheduleCustomerSupportParams {
    emails: EmailData[];
    site_id: string;
    user_id: string;
    total_emails: number;
    timestamp?: string;
    agentId?: string;
}
export interface ApiEmailResponse {
    emails: EmailData[];
    site_id: string;
    user_id: string;
    total_emails: number;
    timestamp: string;
    childWorkflow: {
        type: "scheduleCustomerSupportMessagesWorkflow";
        args: ScheduleCustomerSupportParams;
    };
}
export type AnalysisData = EmailData;
export interface CustomerSupportMessageRequest {
    message: string;
    visitor_id?: string;
    lead_id?: string;
    name?: string;
    email?: string;
    phone?: string;
    userId?: string;
    conversationId?: string;
    agentId?: string;
    site_id?: string;
    lead_notification?: string;
    origin?: string;
}
/**
 * Send customer support message based on email data
 */
export declare function sendCustomerSupportMessageActivity(emailData: EmailData, baseParams: {
    agentId?: string;
    origin?: string;
}): Promise<{
    success: boolean;
    data?: any;
    error?: string;
}>;
/**
 * Process email data and prepare for customer support interaction
 */
export declare function processAnalysisDataActivity(emailData: EmailData): Promise<{
    shouldProcess: boolean;
    priority: string;
    reason: string;
}>;
/**
 * Process API email response and execute customer support workflow
 */
export declare function processApiEmailResponseActivity(apiResponse: ApiEmailResponse): Promise<{
    success: boolean;
    workflowId?: string;
    error?: string;
}>;
