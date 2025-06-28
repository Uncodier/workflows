import { apiService } from '../services/apiService';

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
  // Campos que vienen del análisis individual
  site_id: string;
  user_id: string;
  lead_notification: string; // "email" u otros valores
  analysis_id?: string; // ID del análisis (NO usar como lead_id automáticamente)
  lead_id?: string; // ID del lead - SOLO usar si viene explícitamente
  // Campos opcionales adicionales
  priority?: 'high' | 'medium' | 'low';
  response_type?: 'commercial' | 'support' | 'informational' | 'follow_up';
  potential_value?: 'high' | 'medium' | 'low' | 'unknown';
  intent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
  // Nuevos campos para WhatsApp y otros canales
  conversation_id?: string; // ID de conversación para WhatsApp
  visitor_id?: string; // ID de visitante para usuarios no autenticados
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
  origin?: string; // Nuevo parámetro opcional: "whatsapp" | "email"
}

/**
 * Send customer support message based on email data or website chat data
 */
export async function sendCustomerSupportMessageActivity(
  emailData: EmailData | any, // Allow both EmailData and direct website chat format
  baseParams: {
    agentId?: string;
    origin?: string; // Parámetro opcional para identificar el origen
  }
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  console.log('📞 Sending customer support message...');
  
  // ✅ NEW: Support both EmailData format and direct website chat format
  let message: string;
  let site_id: string;
  let user_id: string;
  let conversation_id: string | undefined;
  let visitor_id: string | undefined;
  let lead_id: string | undefined;
  let contactName: string | undefined;
  let contactEmail: string | undefined;
  let contactPhone: string | undefined;
  
  // Detect if this is EmailData format (has contact_info) or direct website chat format
  if (emailData.contact_info) {
    // EmailData format
    console.log('📧 Processing EmailData format');
    message = emailData.summary || 'Customer support interaction from analysis';
    site_id = emailData.site_id;
    user_id = emailData.user_id;
    conversation_id = emailData.conversation_id;
    visitor_id = emailData.visitor_id;
    lead_id = emailData.lead_id;
    contactName = emailData.contact_info.name;
    contactEmail = emailData.contact_info.email;
    contactPhone = emailData.contact_info.phone;
  } else {
    // Direct website chat format
    console.log('💬 Processing website chat format');
    message = emailData.message || 'Website chat interaction';
    site_id = emailData.site_id;
    user_id = emailData.user_id || ''; // May be empty for website chat
    conversation_id = emailData.conversationId;
    visitor_id = emailData.visitor_id;
    lead_id = emailData.lead_id;
    contactName = emailData.name;
    contactEmail = emailData.email;
    contactPhone = emailData.phone;
  }
  
  const { agentId, origin } = baseParams;
  
  // Build the message request payload con SOLO los parámetros requeridos por el API
  const messageRequest: CustomerSupportMessageRequest = {
    message: message,
    site_id: site_id,
    userId: user_id,
    agentId: agentId,
    lead_notification: "none", // Para mejor trazabilidad - no duplicar notificaciones
    origin: origin, // Enviar el origen (whatsapp, email, etc.)
  };

  // Add conversation ID if available (important for WhatsApp)
  if (conversation_id) {
    messageRequest.conversationId = conversation_id;
    console.log(`💬 Using conversation ID: ${conversation_id}`);
  }

  // Add visitor ID if available (for non-authenticated users)
  if (visitor_id) {
    messageRequest.visitor_id = visitor_id;
    console.log(`👤 Using visitor ID: ${visitor_id}`);
  }

  // Add all available contact information - origin indicates response channel, not data restrictions
  if (contactName) {
    messageRequest.name = contactName;
  }
  
  // Always send email if available (helps with lead creation/matching)
  if (contactEmail) {
    messageRequest.email = contactEmail;
  }
  
  // Always send phone if available (helps with lead creation/matching)  
  if (contactPhone) {
    messageRequest.phone = contactPhone;
  }

  // ✅ FIXED: Solo enviar lead_id si viene explícitamente, NUNCA generar o derivar automáticamente
  if (lead_id) {
    messageRequest.lead_id = lead_id;
    console.log(`📋 Using explicitly provided lead_id: ${lead_id}`);
  } else {
    console.log(`⚠️ No lead_id provided - API will handle lead creation/matching if needed`);
  }

  console.log('📤 Sending customer support message with payload:', {
    message: messageRequest.message?.substring(0, 50) + '...',
    hasName: !!messageRequest.name,
    hasEmail: !!messageRequest.email,
    hasPhone: !!messageRequest.phone,
    site_id: messageRequest.site_id,
    userId: messageRequest.userId,
    agentId: messageRequest.agentId,
    lead_id: messageRequest.lead_id,
    conversationId: messageRequest.conversationId,
    visitor_id: messageRequest.visitor_id,
    lead_notification: messageRequest.lead_notification,
    origin: messageRequest.origin
  });

  console.log('📋 Full payload being sent:', JSON.stringify(messageRequest, null, 2));

  try {
    const response = await apiService.post('/api/agents/customerSupport/message', messageRequest);
    
    if (!response.success) {
      console.error('❌ API call failed:', response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to send customer support message'
      };
    }
    
    console.log('✅ Customer support message sent successfully');
    console.log('📊 API Response data:', JSON.stringify(response.data, null, 2));
    
    // ✅ FIXED: Return consistent structure that workflow expects
    return {
      success: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('❌ Failed to send customer support message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
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
  
  // Determine if this email requires customer support action and assign reason
  let shouldProcess = false;
  let reason = '';
  
  if (lead_notification === 'email') {
    shouldProcess = true;
    reason = 'Email lead notification detected from syncEmails analysis';
  } else if (priority === 'high') {
    shouldProcess = true;
    reason = 'High priority analysis';
  } else if (intent === 'complaint') {
    shouldProcess = true;
    reason = 'Complaint detected - requires immediate attention';
  } else if (potential_value === 'high') {
    shouldProcess = true;
    reason = 'High commercial potential detected';
  } else {
    shouldProcess = false;
    reason = 'No processing criteria met - skipping customer support';
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