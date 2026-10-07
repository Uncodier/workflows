import type { AgentConfig } from '../config/agentsConfig';

export interface SiteSetupOptions {
  enable_analytics?: boolean;
  enable_chat?: boolean;
  enable_leads?: boolean;
  enable_email_tracking?: boolean;
  default_timezone?: string;
  default_language?: string;
  default_locale?: string;
}

export interface SiteSetupParams {
  site_id: string;
  user_id?: string;
  company_name?: string;
  contact_email?: string;
  contact_name?: string;
  setup_type?: 'basic' | 'advanced' | 'complete';
  options?: SiteSetupOptions;
  package_type?: string;
  custom_requirements?: string[];
}

export type SetupAgentConfig = Partial<AgentConfig> & {
  name: string;
  type: string;
  configuration?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
};

export interface CreateAgentsParams {
  site_id: string;
  user_id?: string;
  company_name?: string;
  agent_types?: string[];
  custom_config?: {
    agents_config?: SetupAgentConfig[];
    use_detailed_config?: boolean;
    [key: string]: unknown;
  };
}

export interface SetupAgent {
  agent_id: string;
  type: string;
  name: string;
  status: string;
  description?: string;
  activities?: Array<{
    name: string;
    description: string;
    estimatedTime: string;
    successRate: number;
  }>;
}

export interface CreateAgentsResult {
  success: boolean;
  agents: SetupAgent[];
  total_created: number;
  total_existing: number;
  partial: boolean;
  errors: string[];
}

export interface AccountManager {
  manager_id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface AssignAccountManagerParams {
  site_id: string;
  user_id?: string;
  contact_email?: string;
  contact_name?: string;
  company_name?: string;
  preferred_manager_id?: string;
}

export interface AssignAccountManagerResult {
  success: boolean;
  skipped?: boolean;
  skipped_reason?: string;
  error?: string;
  account_manager: AccountManager;
  assignment_date: string;
}

export interface SendSetupFollowUpEmailParams {
  contact_email?: string;
  contact_name?: string;
  company_name?: string;
  site_id: string;
  account_manager?: Omit<AccountManager, 'manager_id'>;
  agents_created?: Array<{ type: string; name: string }>;
  next_steps?: string[];
}

export interface SendSetupFollowUpEmailResult {
  success: boolean;
  unconfirmed?: boolean;
  skipped?: boolean;
  skipped_reason?: string;
  error?: string;
  messageId: string;
  recipient: string;
  timestamp: string;
}