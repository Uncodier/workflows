/**
 * Email Analysis Activities
 * Activities for calling external email analysis API
 */
export interface EmailAnalysisRequest {
    site_id: string;
    limit?: number;
    agentId?: string;
    lead_id?: string;
    user_id?: string;
    team_member_id?: string;
    analysis_type?: string;
}
export interface EmailAnalysisResponse {
    success: boolean;
    data?: {
        commandId: string;
        status: string;
        message: string;
        emailCount: number;
        analysisCount: number;
        emails: any[];
        childWorkflow?: {
            type: string;
            args: any;
        };
    };
    error?: {
        code: string;
        message: string;
    };
}
/**
 * Activity to analyze emails using external API
 */
export declare function analyzeEmailsActivity(request: EmailAnalysisRequest): Promise<EmailAnalysisResponse>;
/**
 * Activity to check email analysis command status
 */
export declare function checkEmailAnalysisStatusActivity(commandId: string): Promise<any>;
