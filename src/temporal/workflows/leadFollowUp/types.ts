export interface LeadFollowUpOptions {
  lead_id: string;                    // Required: Lead ID
  site_id: string;                    // Required: Site ID
  userId?: string;
  message_status?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  leadId: string;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  followUpActions?: any[];
  nextSteps?: string[];
  data?: any;
  messageSent?: {
    channel: 'email' | 'whatsapp';
    recipient: string;
    success: boolean;
    messageId?: string;
  };
  errors: string[];
  executionTime: string;
  completedAt: string;
}
