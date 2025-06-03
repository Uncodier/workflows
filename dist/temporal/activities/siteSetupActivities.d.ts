import type { AgentConfig } from '../config/agentsConfig';
/**
 * Site Setup Activity interfaces
 */
export interface SiteSetupParams {
    site_id: string;
    user_id: string;
    company_name: string;
    contact_email: string;
    contact_name: string;
    package_type?: string;
    custom_requirements?: string[];
}
export interface CreateAgentsParams {
    site_id: string;
    user_id: string;
    company_name: string;
    agent_types?: string[];
    custom_config?: {
        agents_config?: AgentConfig[];
        use_detailed_config?: boolean;
        [key: string]: any;
    };
}
export interface CreateAgentsResult {
    success: boolean;
    agents: Array<{
        agent_id: string;
        type: string;
        name: string;
        status: string;
        description?: string;
        icon?: string;
        activities?: Array<{
            id: string;
            name: string;
            description: string;
            estimatedTime: string;
            successRate: number;
        }>;
    }>;
    total_created: number;
}
export interface AssignAccountManagerParams {
    site_id: string;
    user_id: string;
    contact_email: string;
    contact_name: string;
    company_name: string;
    preferred_manager_id?: string;
}
export interface AssignAccountManagerResult {
    success: boolean;
    account_manager: {
        manager_id: string;
        name: string;
        email: string;
        phone?: string;
    };
    assignment_date: string;
}
export interface SendSetupFollowUpEmailParams {
    contact_email: string;
    contact_name: string;
    company_name: string;
    site_id: string;
    account_manager: {
        name: string;
        email: string;
        phone?: string;
    };
    agents_created: Array<{
        type: string;
        name: string;
    }>;
    next_steps?: string[];
}
export interface SendSetupFollowUpEmailResult {
    success: boolean;
    messageId: string;
    recipient: string;
    timestamp: string;
}
/**
 * Activity to create agents for a new site
 */
export declare function createAgentsActivity(params: CreateAgentsParams): Promise<CreateAgentsResult>;
/**
 * Activity to assign an account manager to a new site
 */
export declare function assignAccountManagerActivity(params: AssignAccountManagerParams): Promise<AssignAccountManagerResult>;
/**
 * Activity to send setup follow-up email with next steps
 */
export declare function sendSetupFollowUpEmailActivity(params: SendSetupFollowUpEmailParams): Promise<SendSetupFollowUpEmailResult>;
