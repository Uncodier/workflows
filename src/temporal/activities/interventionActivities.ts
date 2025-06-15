import { apiService } from '../services/apiService';

export interface HumanInterventionParams {
  conversationId: string;
  message: string;
  user_id: string;
  agentId: string;
  conversation_title?: string;
  lead_id?: string;
  visitor_id?: string;
  site_id?: string;
}

export interface HumanInterventionResult {
  success: boolean;
  conversationId: string;
  messageId?: string;
  timestamp: string;
  error?: string;
}

/**
 * Activity to record team member intervention in agent conversations
 */
export async function teamMemberInterventionActivity(
  params: HumanInterventionParams
): Promise<HumanInterventionResult> {
  console.log('👤 Recording team member intervention in conversation:', params.conversationId);
  
  try {
    const response = await apiService.post('/api/agents/chat/intervention', {
      conversationId: params.conversationId,
      message: params.message,
      user_id: params.user_id,
      agentId: params.agentId,
      conversation_title: params.conversation_title,
      lead_id: params.lead_id,
      visitor_id: params.visitor_id,
      site_id: params.site_id
    });

    if (!response.success) {
      throw new Error(`Failed to record intervention: ${response.error?.message}`);
    }

    console.log('✅ Team member intervention recorded successfully');
    
    return {
      success: true,
      conversationId: params.conversationId,
      messageId: response.data?.messageId,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to record team member intervention:', errorMessage);
    
    return {
      success: false,
      conversationId: params.conversationId,
      timestamp: new Date().toISOString(),
      error: errorMessage
    };
  }
} 