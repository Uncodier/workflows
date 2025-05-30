import { apiService } from '../services/apiService';

/**
 * Customer Support Activities
 * Activities for handling customer support interactions
 */

export interface AnalysisData {
  analysis: {
    summary: string;
    insights: string[];
    sentiment: 'positive' | 'negative' | 'neutral';
    priority: 'high' | 'medium' | 'low';
    action_items: string[];
    response: string[];
    lead_extraction: {
      contact_info: {
        name: string | null;
        email: string | null;
        phone: string | null;
        company: string | null;
      };
      intent: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
      requirements: string[];
      budget_indication: string | null;
      timeline: string | null;
      decision_maker: 'yes' | 'no' | 'unknown';
      source: 'website' | 'referral' | 'social_media' | 'advertising' | 'cold_outreach';
    };
    commercial_opportunity: {
      requires_response: boolean;
      response_type: 'commercial' | 'support' | 'informational' | 'follow_up';
      priority_level: 'high' | 'medium' | 'low';
      suggested_actions: string[];
      potential_value: 'high' | 'medium' | 'low' | 'unknown';
      next_steps: string[];
    };
  };
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
  site_id: string;
  agentId?: string;
  userId?: string;
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
  
  const { analysis } = analysisData;
  const { lead_extraction, commercial_opportunity } = analysis;
  
  // Build the message request payload
  const messageRequest: CustomerSupportMessageRequest = {
    message: analysis.summary || 'Customer support interaction from analysis',
    site_id: baseParams.site_id,
    agentId: baseParams.agentId,
    userId: baseParams.userId,
    lead_notification: commercial_opportunity.response_type,
  };

  // Add contact information if available
  if (lead_extraction.contact_info.name) {
    messageRequest.name = lead_extraction.contact_info.name;
  }
  
  if (lead_extraction.contact_info.email) {
    messageRequest.email = lead_extraction.contact_info.email;
  }
  
  if (lead_extraction.contact_info.phone) {
    messageRequest.phone = lead_extraction.contact_info.phone;
  }

  console.log('📤 Sending customer support message with payload:', {
    hasContactInfo: !!(lead_extraction.contact_info.name || lead_extraction.contact_info.email),
    intent: lead_extraction.intent,
    priority: analysis.priority,
    sentiment: analysis.sentiment
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
  const { analysis } = analysisData;
  const { commercial_opportunity, priority, sentiment } = analysis;
  
  console.log('🔍 Processing analysis data for customer support...');
  
  // Determine if this analysis requires customer support action
  const shouldProcess = 
    commercial_opportunity.requires_response ||
    priority === 'high' ||
    sentiment === 'negative' ||
    commercial_opportunity.priority_level === 'high';
    
  let reason = '';
  if (commercial_opportunity.requires_response) {
    reason = 'Requires response based on commercial opportunity';
  } else if (priority === 'high') {
    reason = 'High priority analysis';
  } else if (sentiment === 'negative') {
    reason = 'Negative sentiment detected';
  } else if (commercial_opportunity.priority_level === 'high') {
    reason = 'High commercial priority';
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