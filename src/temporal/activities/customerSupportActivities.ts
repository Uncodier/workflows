import { apiService } from '../services/apiService';
import { fetchActivitiesMapActivity } from './activityControlActivities';
import { supabaseServiceRole } from '../../lib/supabase/client';

export {
  sendCustomerSupportMessageActivity,
} from './sendCustomerSupportMessageActivity';
export type {
  CustomerSupportMessageRequest,
} from './sendCustomerSupportMessageActivity';

/**
 * Customer Support Activities
 * Activities for handling customer support interactions
 */

export interface EmailData {
    summary: string;
  original_text?: string; // Texto original del email si está disponible
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

export interface AgentSupervisorRequest {
  command_id?: string;
  conversation_id?: string;
}

export interface NotifyTeamOnInboundRequest {
  lead_id: string;
  conversation_id: string;
  message: string;
  site_id: string;
}

export interface NotifyTeamOnInboundResult {
  success: boolean;
  error?: string;
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

/**
 * Call agent supervisor API endpoint
 * This activity should not fail the workflow if it fails
 */
export async function callAgentSupervisorActivity(
  params: AgentSupervisorRequest
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  console.log('🎯 Calling agent supervisor API...');
  console.log(`📋 Command ID: ${params.command_id || 'not provided'}`);
  console.log(`💬 Conversation ID: ${params.conversation_id || 'not provided'}`);

  // Validate that we have at least one required parameter
  if (!params.command_id && !params.conversation_id) {
    console.log('⚠️ No command_id or conversation_id provided - skipping supervisor call');
    return {
      success: false,
      error: 'Both command_id and conversation_id are missing'
    };
  }

  try {
    const startTime = Date.now();
    console.log('⏱️ Starting agent supervisor API call...');

    const response = await apiService.post('/api/agents/supervisor', {
      command_id: params.command_id,
      conversation_id: params.conversation_id
    });

    const duration = Date.now() - startTime;
    console.log(`⏱️ Agent supervisor API call completed in ${duration}ms`);

    if (!response.success) {
      console.error('❌ Agent supervisor API call failed:', response.error);
      // Don't throw - just return error status
      return {
        success: false,
        error: response.error?.message || 'Failed to call agent supervisor API'
      };
    }

    console.log('✅ Agent supervisor API call successful');
    console.log('📊 Supervisor response data:', JSON.stringify(response.data, null, 2));

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    console.error('❌ Failed to call agent supervisor API:', error);
    
    // Don't throw - just return error status so workflow continues
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Notify team on inbound message activity
 * This activity calls the external API when it's the first user message in a conversation
 * This activity should not fail the workflow if it fails
 */
export async function notifyTeamOnInboundActivity(
  params: NotifyTeamOnInboundRequest
): Promise<NotifyTeamOnInboundResult> {
  console.log('🔔 Notify team on inbound activity started...');
  console.log(`📋 Lead ID: ${params.lead_id}`);
  console.log(`💬 Conversation ID: ${params.conversation_id}`);
  console.log(`🏢 Site ID: ${params.site_id}`);
  console.log(`💬 Message: ${params.message?.substring(0, 100) || 'no message'}...`);

  try {
    // Step 1: Validate that notify_team_on_inbound activity is not explicitly inactive
    console.log('🔐 Step 1: Validating notify_team_on_inbound activity status...');
    
    // Fetch activities configuration for the site
    const activitiesMap = await fetchActivitiesMapActivity([params.site_id]);
    const siteActivities = activitiesMap[params.site_id];
    
    // If no activities configuration exists, allow execution (default behavior)
    if (!siteActivities) {
      console.log('✅ No activities configuration found - allowing execution (default behavior)');
    } else {
      // Check if the specific activity key exists in configuration
      const activityConfig = siteActivities['notify_team_on_inbound'];
      
      // If activity key doesn't exist in configuration, allow execution (default behavior)
      if (!activityConfig) {
        console.log('✅ Activity notify_team_on_inbound not configured - allowing execution (default behavior)');
      } else {
        // Check the status of the activity
        const activityStatus = activityConfig.status;
        console.log(`📊 Activity 'notify_team_on_inbound' status: ${activityStatus}`);
        
        // Only block if explicitly set to "inactive"
        if (activityStatus === 'inactive') {
          console.log('⛔ Notify team activity blocked - explicitly set to inactive');
          return {
            success: false,
            error: 'Activity notify_team_on_inbound is inactive in site settings'
          };
        }
        
        // For any other status (including 'default'), allow execution
        console.log(`✅ Activity validation passed - status: ${activityStatus}`);
      }
    }

    // Step 2: Check if it's the first user message in the conversation
    console.log('🔍 Step 2: Checking if this is the first user message in conversation...');
    
    const { data: userMessages, error: messagesError, count } = await supabaseServiceRole
      .from('messages')
      .select('id, created_at', { count: 'exact' })
      .eq('conversation_id', params.conversation_id)
      .eq('role', 'user');

    if (messagesError) {
      console.error(`❌ Error checking user messages:`, messagesError);
      // Don't throw - return error status so workflow continues
      return {
        success: false,
        error: `Failed to check messages: ${messagesError.message}`
      };
    }

    // If there are more than 1 user messages, this is not the first message
    const userMessageCount = count || (userMessages?.length || 0);
    console.log(`📊 Found ${userMessageCount} user message(s) in conversation`);

    if (userMessageCount > 1) {
      console.log(`⏭️ Not the first user message - found ${userMessageCount} user messages in conversation`);
      return {
        success: false,
        error: 'Not the first user message in conversation'
      };
    }

    if (userMessageCount === 0) {
      console.log(`⚠️ No user messages found in conversation - this might be an error`);
      return {
        success: false,
        error: 'No user messages found in conversation'
      };
    }

    console.log('✅ This is the first user message in the conversation');

    // Step 3: Call the notification API
    console.log('📞 Step 3: Calling newInboundMessage API...');
    const startTime = Date.now();

    const requestBody = {
      lead_id: params.lead_id,
      conversation_id: params.conversation_id,
      message: params.message
    };

    console.log('📤 Sending notification request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/notifications/newInboundMessage', requestBody);

    const duration = Date.now() - startTime;
    console.log(`⏱️ Notification API call completed in ${duration}ms`);

    if (!response.success) {
      console.error('❌ Notification API call failed:', response.error);
      // Don't throw - just return error status so workflow continues
      return {
        success: false,
        error: response.error?.message || 'Failed to call notification API'
      };
    }

    console.log('✅ Team notification sent successfully');
    console.log('📊 Notification response data:', JSON.stringify(response.data, null, 2));

    return {
      success: true
    };

  } catch (error) {
    console.error('❌ Failed to notify team on inbound message:', error);
    
    // Don't throw - just return error status so workflow continues
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 