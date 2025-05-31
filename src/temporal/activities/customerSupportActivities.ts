import { apiService } from '../services/apiService';

/**
 * Customer Support Activities
 * Activities for handling customer support interactions
 */

export interface AnalysisData {
  email: {
    summary: string;
    contact_info: {
      name: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
    };
  };
  // Campos requeridos del API
  site_id: string;
  user_id: string;
  lead_notification: boolean;
  priority: 'high' | 'medium' | 'low';
  response_type: 'commercial' | 'support' | 'informational' | 'follow_up';
  potential_value: 'high' | 'medium' | 'low' | 'unknown';
  intent: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
  // ID único para tracking
  analysis_id: string;
}

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

export interface ScheduleCustomerSupportParams {
  analysisArray: AnalysisData[];
  agentId?: string;
}

/**
 * Send customer support message based on analysis data
 */
export async function sendCustomerSupportMessageActivity(
  analysisData: AnalysisData,
  baseParams: {
    site_id: string;
    agentId?: string;
    userId?: string;
  }
): Promise<any> {
  console.log('📞 Sending customer support message...');
  
  const { email, site_id, user_id, lead_notification, response_type } = analysisData;
  
  // Build the message request payload usando los campos directos
  const messageRequest: CustomerSupportMessageRequest = {
    message: email.summary || 'Customer support interaction from analysis',
    site_id: site_id, // Usar el site_id del analysisData
    agentId: baseParams.agentId,
    userId: user_id, // Usar el user_id del analysisData
    lead_notification: lead_notification ? response_type : undefined,
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
    intent: analysisData.intent,
    priority: analysisData.priority,
    analysisId: analysisData.analysis_id
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
 * Process analysis data and prepare for customer support interaction
 */
export async function processAnalysisDataActivity(
  analysisData: AnalysisData
): Promise<{
  shouldProcess: boolean;
  priority: string;
  reason: string;
}> {
  const { lead_notification, priority, intent, potential_value } = analysisData;
  
  console.log('🔍 Processing analysis data for customer support...');
  
  // Determine if this analysis requires customer support action
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
    reason = 'No immediate action required';
  }
  
  console.log(`📊 Analysis processing result: ${shouldProcess ? 'PROCESS' : 'SKIP'} - ${reason}`);
  
  return {
    shouldProcess,
    priority,
    reason
  };
} 