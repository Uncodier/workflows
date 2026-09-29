// Interfaces for daily prospection

export interface ProspectionLead {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  site_id: string;
  assignee_id?: string;
  phone?: string;
  position?: string;
  company?: any;
  company_name?: string;
  segment_id?: string;
  [key: string]: any;
}

export interface DailyProspectionOptions {
  outreach_cursor?: { createdAt: string; id: string };
  outreach_activity?: import('../../utils/outreachActivity').OutreachActivityKey;
  site_id: string;
  userId?: string;
  hoursThreshold?: number; // Default 48 hours
  maxLeads?: number; // Maximum leads to process per site (default 30)
  page?: number; // Page number for pagination (0-based, default 0)
  pageSize?: number; // Page size for pagination (default 30)
  additionalData?: any;
}

// New interfaces for communication channels validation
export interface ValidateCommunicationChannelsParams {
  outreach_activity?: import('../../utils/outreachActivity').OutreachActivityKey;
  site_id: string;
  /** Only for new outbound work; historical workflows keep configuration-only behavior. */
  requireHealthyOutbound?: boolean;
}

export interface ValidateCommunicationChannelsResult {
  availableChannels?: string[];
  success: boolean;
  hasEmailChannel: boolean;
  hasWhatsappChannel: boolean;
  hasAnyChannel: boolean;
  emailConfig?: any;
  whatsappConfig?: any;
  // True when channels.email has aliases configured (string or array), even if disabled
  emailAliasConfigured?: boolean;
  error?: string;
}

export interface GetProspectionLeadsResult {
  nextCursor?: { createdAt: string; id: string };
  success: boolean;
  leads: ProspectionLead[];
  total: number;
  hasMorePages?: boolean; // Indicates if there are more pages available
  currentPage?: number; // Current page number (0-based)
  pageSize?: number; // Page size used for this query
  totalCandidatesFound?: number; // Total candidates before filtering
  error?: string;
  criteria?: {
    site_id: string;
    status: string;
    hoursThreshold: number;
    createdBefore: string;
    page?: number;
    pageSize?: number;
  };
}



