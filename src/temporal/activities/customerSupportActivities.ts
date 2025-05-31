import { apiService } from '../services/apiService';

/**
 * Customer Support Activities
 * Activities for handling customer support interactions
 */

export interface EmailData {
  email: {
    summary: string;
    contact_info: {
      name: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
    };
  };
  // Campos adicionales que pueden venir del análisis
  priority?: 'high' | 'medium' | 'low';
  response_type?: 'commercial' | 'support' | 'informational' | 'follow_up';
  potential_value?: 'high' | 'medium' | 'low' | 'unknown';
  intent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
  lead_notification?: boolean;
  analysis_id?: string;
}

export interface ScheduleCustomerSupportParams {
  emails: EmailData[];
  site_id: string;
  user_id: string;
  total_emails: number;
  agentId?: string;
}

// Mantener AnalysisData como alias para compatibilidad
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
}

/**
 * Send customer support message based on email data
 */
export async function sendCustomerSupportMessageActivity(
  emailData: EmailData,
  baseParams: {
    site_id: string;
    user_id: string;
    agentId?: string;
  }
): Promise<any> {
  console.log('📞 Sending customer support message...');
  
  const { email, lead_notification, response_type } = emailData;
  const { site_id, user_id, agentId } = baseParams;
  
  // Build the message request payload usando los campos directos
  const messageRequest: CustomerSupportMessageRequest = {
    message: email.summary || 'Customer support interaction from analysis',
    site_id: site_id,
    agentId: agentId,
    userId: user_id,
    lead_notification: lead_notification && response_type ? response_type : undefined,
  };

  // Add contact information if available
  if (email.contact_info.name) {
    messageRequest.name = email.contact_info.name;
  }
  
  if (email.contact_info.email) {
    messageRequest.email = email.contact_info.email;
  }
  
  if (email.contact_info.phone) {
    messageRequest.phone = email.contact_info.phone;
  }

  console.log('📤 Sending customer support message with payload:', {
    hasContactInfo: !!(email.contact_info.name || email.contact_info.email),
    intent: emailData.intent || 'unknown',
    priority: emailData.priority || 'medium',
    analysisId: emailData.analysis_id || 'no-id'
  });

  try {
    const response = await apiService.post('/api/agents/customerSupport/message', messageRequest);
    
    if (!response.success) {
      throw new Error(`Failed to send customer support message: ${response.error?.message}`);
    }
    
    console.log('✅ Customer support message sent successfully');
    return response.data;
    
  } catch (error) {
    console.error('❌ Failed to send customer support message:', error);
    throw error;
  }
}

/**
 * Process email data and prepare for customer support interaction
 */
export async function processAnalysisDataActivity(
  emailData: EmailData
): Promise<{
  shouldProcess: boolean;
  priority: string;
  reason: string;
}> {
  const { lead_notification, priority, intent, potential_value } = emailData;
  
  console.log('🔍 Processing email data for customer support...');
  
  // Determine if this email requires customer support action
  const shouldProcess = 
    lead_notification ||
    priority === 'high' ||
    intent === 'complaint' ||
    potential_value === 'high';
    
  let reason = '';
  if (lead_notification) {
    reason = 'Lead notification required based on analysis';
  } else if (priority === 'high') {
    reason = 'High priority analysis';
  } else if (intent === 'complaint') {
    reason = 'Complaint detected - requires immediate attention';
  } else if (potential_value === 'high') {
    reason = 'High commercial potential detected';
  } else {
    reason = 'No immediate action required - processing for completeness';
  }
  
  console.log(`📊 Email processing result: ${shouldProcess ? 'PROCESS' : 'SKIP'} - ${reason}`);
  
  return {
    shouldProcess: true, // Por ahora procesar todos los emails
    priority: priority || 'medium',
    reason
  };
} 