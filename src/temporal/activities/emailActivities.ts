import { apiService } from '../services/apiService';

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
 * Email Sync Activity interfaces
 */
export interface SyncSentEmailsParams {
  site_id: string;
  limit?: number;
  since_date?: string; // ISO date string
}

export interface SyncSentEmailsResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Activity to send email via agent API
 */
export async function sendEmailFromAgentActivity(params: SendEmailParams): Promise<SendEmailResult> {
  console.log('📧 Sending email from agent:', {
    recipient: params.email,
    from: params.from,
    subject: params.subject,
    messageLength: params.message.length,
    site_id: params.site_id,
    agent_id: params.agent_id,
    conversation_id: params.conversation_id,
    lead_id: params.lead_id
  });

  try {
    const response = await apiService.post('/api/agents/tools/sendEmail', {
      email: params.email,
      from: params.from,
      subject: params.subject,
      message: params.message,
      site_id: params.site_id,
      agent_id: params.agent_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id
    });

    if (!response.success) {
      throw new Error(`Failed to send email: ${response.error?.message}`);
    }

    console.log('✅ Email sent successfully:', response.data);

    return {
      success: true,
      messageId: response.data.messageId || 'unknown',
      recipient: params.email,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw new Error(`Email sending failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Activity to sync sent emails via API
 */
export async function syncSentEmailsActivity(params: SyncSentEmailsParams): Promise<SyncSentEmailsResult> {
  console.log('📨 Syncing sent emails:', {
    site_id: params.site_id,
    limit: params.limit || 10,
    since_date: params.since_date || 'not specified'
  });

  try {
    const requestBody = {
      site_id: params.site_id,
      limit: params.limit || 10,
      ...(params.since_date && { since_date: params.since_date })
    };

    console.log('📤 Sending sync sent emails request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/email/sync', requestBody);

    if (!response.success) {
      console.error('❌ Sent emails sync failed:', response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to sync sent emails'
      };
    }

    console.log('✅ Sent emails sync completed successfully');
    console.log('📊 Sync response data:', JSON.stringify(response.data, null, 2));

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Sent emails sync failed:', errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 