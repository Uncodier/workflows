import { apiService } from '../services/apiService';

/**
 * Customer Support Activities
 * Activities for handling customer support interactions
 */

export interface EmailData {
  email: {
    summary: string;
    original_subject?: string;
    contact_info: {
      name: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
    };
  };
  // Campos que vienen del análisis individual
  site_id: string;
  user_id: string;
  lead_notification: string; // "email" u otros valores
  analysis_id: string;
  // Campos opcionales adicionales
  priority?: 'high' | 'medium' | 'low';
  response_type?: 'commercial' | 'support' | 'informational' | 'follow_up';
  potential_value?: 'high' | 'medium' | 'low' | 'unknown';
  intent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
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
    agentId?: string;
  }
): Promise<any> {
  console.log('📞 Sending customer support message...');
  
  const { email, site_id, user_id, analysis_id } = emailData;
  const { agentId } = baseParams;
  
  // Build the message request payload usando los campos del emailData
  // Usar lead_notification = "none" para mejor trazabilidad
  const messageRequest: CustomerSupportMessageRequest = {
    message: email.summary || 'Customer support interaction from analysis',
    site_id: site_id,
    agentId: agentId,
    userId: user_id,
    lead_notification: "none", // Para mejor trazabilidad - no duplicar notificaciones
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
    analysisId: analysis_id,
    leadNotification: "none", // Mejorar trazabilidad
    originalLeadNotification: emailData.lead_notification
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
  console.log(`📨 Original lead_notification: ${lead_notification}`);
  
  // Determine if this email requires customer support action
  // IMPORTANTE: Manejar lead_notification = "email" del flujo syncEmails
  const shouldProcess = 
    lead_notification === 'email' ||  // Viene del análisis de syncEmails
    priority === 'high' ||
    intent === 'complaint' ||
    potential_value === 'high';
    
  let reason = '';
  if (lead_notification === 'email') {
    reason = 'Email lead notification detected from syncEmails analysis';
  } else if (priority === 'high') {
    reason = 'High priority analysis';
  } else if (intent === 'complaint') {
    reason = 'Complaint detected - requires immediate attention';
  } else if (potential_value === 'high') {
    reason = 'High commercial potential detected';
  } else {
    reason = 'Processing for completeness - email detected';
  }
  
  console.log(`📊 Email processing result: ${shouldProcess ? 'PROCESS' : 'SKIP'} - ${reason}`);
  console.log(`🔄 Will send lead_notification="none" to customer support for traceability`);
  
  return {
    shouldProcess,
    priority: priority || 'medium',
    reason
  };
}

/**
 * Process API email response and execute customer support workflow
 */
export async function processApiEmailResponseActivity(
  apiResponse: ApiEmailResponse
): Promise<{
  success: boolean;
  workflowId?: string;
  error?: string;
}> {
  console.log('🔄 Processing API email response for customer support workflow...');
  
  try {
    const { childWorkflow } = apiResponse;
    
    if (childWorkflow.type !== 'scheduleCustomerSupportMessagesWorkflow') {
      throw new Error(`Unexpected workflow type: ${childWorkflow.type}`);
    }
    
    console.log(`📊 Processing ${childWorkflow.args.emails.length} emails from API response`);
    console.log(`🏢 Site: ${childWorkflow.args.site_id}, User: ${childWorkflow.args.user_id}`);
    
    // Return the args to be used by the calling workflow
    return {
      success: true,
      workflowId: `schedule-customer-support-${Date.now()}`
    };
    
  } catch (error) {
    console.error('❌ Failed to process API email response:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 