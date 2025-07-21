/**
 * Lead and Company Activities
 * Activities for managing leads and companies
 */

import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services/supabaseService';
import { getTemporalClient } from '../client';
import { temporalConfig } from '../../config/config';

// Lead interfaces
export interface Lead {
  id: string;
  email?: string;
  name?: string;
  company?: string;
  company_name?: string;
  job_title?: string;
  position?: string;
  industry?: string;
  location?: string;
  phone?: string;
  website?: string;
  company_size?: string;
  assignee_id?: string;
  site_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface GetLeadResult {
  success: boolean;
  lead?: Lead;
  error?: string;
}

/**
 * Activity to check if a lead notification was already sent today
 */
export async function checkExistingLeadNotificationActivity(request: CheckExistingNotificationRequest): Promise<CheckExistingNotificationResult> {
  console.log(`🔍 DUPLICATE CHECK: Starting check for existing lead attention notification for lead: ${request.lead_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 DUPLICATE CHECK: Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️ DUPLICATE CHECK: Database not available, proceeding with notification (cannot verify duplicates)');
      return {
        success: true,
        exists: false // Assume no notification exists if DB is unavailable
      };
    }

    console.log('✅ DUPLICATE CHECK: Database connection confirmed, checking for existing notifications...');
    
    // Get today's date in UTC (start and end of day)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    console.log(`📅 DUPLICATE CHECK: Checking notifications from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
    console.log(`📅 DUPLICATE CHECK: Query params - lead_id: ${request.lead_id}, entity_type: 'lead'`);
    
    // Query notifications table for this lead_id and today's date
    // Using the actual table structure: related_entity_id for lead_id and created_at for timestamp
    const { data: notifications, error } = await (supabaseService as any).client
      .from('notifications')
      .select('id, created_at, related_entity_id, related_entity_type')
      .eq('related_entity_id', request.lead_id)
      .eq('related_entity_type', 'lead')
      .gte('created_at', startOfDay.toISOString())
      .lt('created_at', endOfDay.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    console.log(`📊 DUPLICATE CHECK: Query result - notifications:`, JSON.stringify(notifications, null, 2));
    console.log(`📊 DUPLICATE CHECK: Query error:`, error);

    if (error) {
      console.error('❌ DUPLICATE CHECK: Error querying notifications:', error);
      return {
        success: false,
        error: error.message,
        exists: false
      };
    }

    if (notifications && notifications.length > 0) {
      const lastNotification = notifications[0];
      console.log(`⚠️ DUPLICATE CHECK: FOUND existing lead attention notification for lead ${request.lead_id}`);
      console.log(`📅 DUPLICATE CHECK: Last notification created at: ${lastNotification.created_at}`);
      console.log(`📋 DUPLICATE CHECK: Notification details:`, JSON.stringify(lastNotification, null, 2));
      
      return {
        success: true,
        exists: true,
        lastNotification: {
          sent_at: lastNotification.created_at,
          notification_id: lastNotification.id
        }
      };
    } else {
      console.log(`✅ DUPLICATE CHECK: NO existing notifications found for lead ${request.lead_id} today`);
      return {
        success: true,
        exists: false
      };
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception checking existing notifications for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage,
      exists: false // Assume no notification exists on error (fail open)
    };
  }
}

/**
 * Activity to get lead information from database
 */
export async function getLeadActivity(leadId: string): Promise<GetLeadResult> {
  console.log(`👤 Getting lead information for: ${leadId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot fetch lead information');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching lead...');
    
    const leadData = await supabaseService.fetchLead(leadId);

    const lead: Lead = {
      id: leadData.id,
      email: leadData.email,
      name: leadData.name || leadData.full_name,
      company: leadData.company || leadData.company_name,
      company_name: leadData.company_name || leadData.company,
      job_title: leadData.job_title || leadData.position,
      position: leadData.position || leadData.job_title,
      industry: leadData.industry,
      location: leadData.location,
      phone: leadData.phone,
      website: leadData.website,
      company_size: leadData.company_size,
      site_id: leadData.site_id,
      created_at: leadData.created_at,
      updated_at: leadData.updated_at,
      ...leadData
    };

    console.log(`✅ Retrieved lead information for ${lead.name || lead.email}: ${lead.company}`);
    
    return {
      success: true,
      lead
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception getting lead ${leadId}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Lead follow-up interfaces
export interface LeadFollowUpRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  data?: any;
  error?: string;
  followUpActions?: any[];
  nextSteps?: string[];
}

// Lead research interfaces
export interface LeadResearchRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadResearchResult {
  success: boolean;
  data?: any;
  error?: string;
  researchData?: any;
  insights?: any[];
  recommendations?: string[];
}

/**
 * Activity to execute lead follow-up via sales agent API
 */
export async function leadFollowUpActivity(request: LeadFollowUpRequest): Promise<LeadFollowUpResult> {
  console.log(`📞 Executing lead follow-up for lead: ${request.lead_id}, site: ${request.site_id}`);
  
  try {
    const requestBody = {
      leadId: request.lead_id,        // Convert to camelCase for API
      siteId: request.site_id,        // Convert to camelCase for API
      userId: request.userId,
      ...request.additionalData,
    };

    console.log('📤 Sending lead follow-up request:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadFollowUp', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to execute lead follow-up for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute lead follow-up'
      };
    }
    
    const data = response.data;
    const followUpActions = data?.followUpActions || data?.actions || [];
    const nextSteps = data?.nextSteps || data?.next_steps || [];
    
    console.log(`✅ Lead follow-up executed successfully for lead ${request.lead_id}`);
    if (followUpActions.length > 0) {
      console.log(`📋 Follow-up actions generated: ${followUpActions.length}`);
    }
    if (nextSteps.length > 0) {
      console.log(`🎯 Next steps identified: ${nextSteps.length}`);
    }
    
    return {
      success: true,
      data,
      followUpActions,
      nextSteps
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception executing lead follow-up for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to execute lead research via sales agent API
 */
export async function leadResearchActivity(request: LeadResearchRequest): Promise<LeadResearchResult> {
  console.log(`🔍 Executing lead research for lead: ${request.lead_id}, site: ${request.site_id}`);
  
  try {
    const requestBody = {
      leadId: request.lead_id,        // Convert to camelCase for API
      siteId: request.site_id,        // Convert to camelCase for API
      userId: request.userId,
      ...request.additionalData,
    };

    console.log('📤 Sending lead research request:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadResearch', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to execute lead research for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute lead research'
      };
    }
    
    const data = response.data;
    const researchData = data?.researchData || data?.research || data;
    const insights = data?.insights || data?.findings || [];
    const recommendations = data?.recommendations || data?.next_steps || [];
    
    console.log(`✅ Lead research executed successfully for lead ${request.lead_id}`);
    if (insights.length > 0) {
      console.log(`🔍 Research insights generated: ${insights.length}`);
    }
    if (recommendations.length > 0) {
      console.log(`💡 Recommendations identified: ${recommendations.length}`);
    }
    
    return {
      success: true,
      data,
      researchData,
      insights,
      recommendations
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception executing lead research for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Lead attention interfaces
export interface LeadAttentionRequest {
  lead_id: string;
  user_message?: string; // User's original message
  system_message?: string; // System/assistant response
}

export interface LeadAttentionResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Check existing notification interfaces
export interface CheckExistingNotificationRequest {
  lead_id: string;
}

export interface CheckExistingNotificationResult {
  success: boolean;
  exists: boolean;
  lastNotification?: {
    sent_at: string;
    notification_id: string;
  };
  error?: string;
}

/**
 * Activity to send lead attention notification via external API
 * Only sends notification if the lead has an assignee_id
 */
export async function leadAttentionActivity(request: LeadAttentionRequest): Promise<LeadAttentionResult> {
  console.log(`📤 API CALL: Sending lead attention notification for lead: ${request.lead_id}`);
  console.log(`📤 API CALL: Request details:`, JSON.stringify(request, null, 2));
  
  try {
    // Send the notification to the API (validation already done in workflow)
    const requestBody = {
      lead_id: request.lead_id,
      user_message: request.user_message, // User's original message
      system_message: request.system_message, // System/assistant response
    };

    console.log('📤 API CALL: Sending lead attention request to API...');
    console.log('📤 API CALL: Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/notifications/leadAttention', requestBody);
    
    console.log('📤 API CALL: Response:', JSON.stringify(response, null, 2));
    
    if (!response.success) {
      console.error(`❌ API CALL FAILED: API call failed for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to send lead attention notification'
      };
    }
    
    console.log(`✅ API CALL SUCCESS: Lead attention notification sent successfully for lead ${request.lead_id}`);
    
    return {
      success: true,
      data: {
        notificationSent: true,
        response: response.data
      }
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ API CALL EXCEPTION: Exception processing lead attention notification for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Start Independent Workflow interfaces
export interface StartLeadAttentionWorkflowRequest {
  lead_id: string;
  user_message?: string; // User's original message
  system_message?: string; // System/assistant response
}

export interface StartLeadAttentionWorkflowResult {
  success: boolean;
  workflowId?: string;
  error?: string;
}

/**
 * Activity to start leadAttentionWorkflow as an independent workflow
 * Uses Temporal client directly to start the workflow independently (not as child workflow)
 */
export async function startLeadAttentionWorkflowActivity(request: StartLeadAttentionWorkflowRequest): Promise<StartLeadAttentionWorkflowResult> {
  console.log(`🚀 Starting independent leadAttentionWorkflow for lead: ${request.lead_id}`);
  
  try {
    const workflowId = `lead-attention-${request.lead_id}`;
    
    // Get Temporal client directly (same pattern used throughout the codebase)
    const client = await getTemporalClient();
    
    console.log('📤 Starting workflow via Temporal client:', {
      workflowType: 'leadAttentionWorkflow',
      workflowId,
      args: [{ lead_id: request.lead_id, user_message: request.user_message, system_message: request.system_message }],
      taskQueue: temporalConfig.taskQueue
    });
    
    // Start the workflow using Temporal client (fire and forget)
    const handle = await client.workflow.start('leadAttentionWorkflow', {
      args: [{ lead_id: request.lead_id, user_message: request.user_message, system_message: request.system_message }],
      workflowId,
      taskQueue: temporalConfig.taskQueue,
    });
    
    console.log(`✅ Independent leadAttentionWorkflow started successfully for lead ${request.lead_id}`);
    console.log(`📋 Workflow ID: ${handle.workflowId}`);
    
    return {
      success: true,
      workflowId: handle.workflowId,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception starting independent leadAttentionWorkflow for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Start Lead Follow-Up Workflow interfaces
export interface StartLeadFollowUpWorkflowRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface StartLeadFollowUpWorkflowResult {
  success: boolean;
  workflowId?: string;
  error?: string;
}

/**
 * Activity to start leadFollowUpWorkflow as an independent workflow
 * Uses Temporal client directly to start the workflow independently (not as child workflow)
 */
export async function startLeadFollowUpWorkflowActivity(request: StartLeadFollowUpWorkflowRequest): Promise<StartLeadFollowUpWorkflowResult> {
  console.log(`🚀 Starting independent leadFollowUpWorkflow for lead: ${request.lead_id}`);
  
  try {
    const workflowId = `lead-follow-up-${request.lead_id}-${request.site_id}-${Date.now()}`;
    
    // Get Temporal client directly (same pattern used throughout the codebase)
    const client = await getTemporalClient();
    
    console.log('📤 Starting leadFollowUpWorkflow via Temporal client:', {
      workflowType: 'leadFollowUpWorkflow',
      workflowId,
      args: [{ lead_id: request.lead_id, site_id: request.site_id, userId: request.userId, additionalData: request.additionalData }],
      taskQueue: temporalConfig.taskQueue
    });
    
    // Start the workflow using Temporal client (fire and forget)
    const handle = await client.workflow.start('leadFollowUpWorkflow', {
      args: [{ 
        lead_id: request.lead_id, 
        site_id: request.site_id, 
        userId: request.userId, 
        additionalData: request.additionalData 
      }],
      workflowId,
      taskQueue: temporalConfig.taskQueue,
    });
    
    console.log(`✅ Independent leadFollowUpWorkflow started successfully for lead ${request.lead_id}`);
    console.log(`📋 Workflow ID: ${handle.workflowId}`);
    
    return {
      success: true,
      workflowId: handle.workflowId,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception starting independent leadFollowUpWorkflow for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to save lead follow-up logs via API
 */
export async function saveLeadFollowUpLogsActivity(request: {
  siteId: string;
  leadId: string;
  userId: string;
  data: any;
}): Promise<{ success: boolean; error?: string }> {
  console.log(`📝 Saving lead follow-up logs for lead ${request.leadId} on site ${request.siteId}`);
  
  try {
    // Flatten the data fields directly to root level
    const requestBody = {
      siteId: request.siteId,
      leadId: request.leadId,
      userId: request.userId,
      ...request.data  // Flatten the data fields (messages, lead, command_ids) directly to root
    };
    
    console.log('📤 Sending lead follow-up logs:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadFollowUp/logs', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to save lead follow-up logs:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to save lead follow-up logs'
      };
    }
    
    console.log(`✅ Lead follow-up logs saved successfully`);
    
    return {
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception saving lead follow-up logs:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Update Lead interfaces
export interface UpdateLeadRequest {
  lead_id: string;
  updateData: any;
  safeUpdate?: boolean; // If true, will not update email or phone
}

export interface UpdateLeadResult {
  success: boolean;
  lead?: any;
  error?: string;
}

/**
 * Activity to update lead information in database
 */
export async function updateLeadActivity(request: UpdateLeadRequest): Promise<UpdateLeadResult> {
  console.log(`👤 Updating lead information for: ${request.lead_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update lead information');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, updating lead...');
    
    // Prepare update data, excluding dangerous fields if safeUpdate is true
    let updateData = { ...request.updateData };
    
    if (request.safeUpdate !== false) { // Default to safe update
      // Remove dangerous fields that should not be overwritten
      const { email, phone, ...safeData } = updateData;
      updateData = safeData;
      
      if (email || phone) {
        console.log('⚠️  Skipping email/phone update for safety (safeUpdate mode)');
        console.log(`   - Email: ${email ? 'would be updated' : 'not provided'}`);
        console.log(`   - Phone: ${phone ? 'would be updated' : 'not provided'}`);
      }
    }
    
    const updatedLead = await supabaseService.updateLead(request.lead_id, updateData);

    console.log(`✅ Successfully updated lead information for ${request.lead_id}`);
    
    return {
      success: true,
      lead: updatedLead
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Company interfaces
export interface GetCompanyResult {
  success: boolean;
  company?: any;
  error?: string;
}

export interface UpsertCompanyResult {
  success: boolean;
  company?: any;
  error?: string;
}

/**
 * Activity to get company information from database
 */
export async function getCompanyActivity(companyId: string): Promise<GetCompanyResult> {
  console.log(`🏢 Getting company information for: ${companyId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot fetch company information');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching company...');
    
    const companyData = await supabaseService.fetchCompany(companyId);

    if (!companyData) {
      console.log(`⚠️  Company ${companyId} not found`);
      return {
        success: false,
        error: 'Company not found'
      };
    }

    console.log(`✅ Retrieved company information for ${companyData.name}`);
    
    return {
      success: true,
      company: companyData
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception getting company ${companyId}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to create or update company information in the database
 */
export async function upsertCompanyActivity(companyData: any): Promise<UpsertCompanyResult> {
  console.log(`🏢 Upserting company: ${companyData.name}`);
  console.log(`📋 Company data:`, JSON.stringify(companyData, null, 2));
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot upsert company');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, upserting company...');
    
    const upsertedCompany = await supabaseService.upsertCompany(companyData);

    console.log(`✅ Successfully upserted company: ${upsertedCompany.name}`);
    
    return {
      success: true,
      company: upsertedCompany
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception upserting company:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 

 

/**
 * Activity to update conversation status to active after successful lead follow-up
 * This is a specific activity for post follow-up conversation activation
 */
export async function updateConversationStatusAfterFollowUpActivity(request: {
  conversation_id?: string;
  lead_id: string;
  site_id: string;
  response_data?: any;
  additional_data?: any;
}): Promise<{ success: boolean; error?: string; conversation_id?: string }> {
  console.log(`💬 Activating conversation after successful lead follow-up...`);
  console.log(`📋 Lead ID: ${request.lead_id}, Site ID: ${request.site_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update conversation status');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, searching for conversation...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // First, try to find the conversation ID if not provided
    let conversationId = request.conversation_id;
    
    if (!conversationId) {
      console.log(`🔍 No conversation ID provided, searching for conversation by lead_id...`);
      
      // Look for conversation_id in response data
      if (request.response_data) {
        conversationId = request.response_data.conversation_id || 
                        request.response_data.lead?.conversation_id;
      }
      
      // Look in additional data
      if (!conversationId && request.additional_data) {
        conversationId = request.additional_data.conversation_id;
      }
      
      // If still no conversation ID, try to find it by lead_id
      if (!conversationId) {
        console.log(`🔍 Searching for conversation by lead_id in database...`);
        
        const { data: conversation, error: findError } = await supabaseServiceRole
          .from('conversations')
          .select('id')
          .eq('lead_id', request.lead_id)
          .eq('site_id', request.site_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (findError && findError.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error(`❌ Error searching for conversation:`, findError);
          return {
            success: false,
            error: `Failed to search for conversation: ${findError.message}`
          };
        }

        if (conversation) {
          conversationId = conversation.id;
          console.log(`✅ Found conversation by lead_id: ${conversationId}`);
        }
      }
    }

    if (!conversationId) {
      console.log(`⚠️ No conversation found for lead ${request.lead_id} - this is normal for some follow-ups`);
      return {
        success: true, // Don't fail the workflow for missing conversation
        error: 'No conversation found to update'
      };
    }

    console.log(`📝 Updating conversation ${conversationId} status to 'active'...`);

    const updateData = {
      status: 'active',
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString() // Update last message time
    };

    const { data, error } = await supabaseServiceRole
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId)
      .eq('site_id', request.site_id) // Additional security filter
      .select()
      .single();

    if (error) {
      console.error(`❌ Error updating conversation ${conversationId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Conversation ${conversationId} not found or update failed`
      };
    }

    console.log(`✅ Successfully activated conversation ${conversationId} after lead follow-up`);
    console.log(`💬 Conversation is now active and ready for new interactions`);
    
    return {
      success: true,
      conversation_id: conversationId
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating conversation status after follow-up:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 

/**
 * Activity to validate that message and conversation exist before sending follow-up
 * This validates both conversation and message integrity before proceeding with sending
 */
export async function validateMessageAndConversationActivity(request: {
  lead_id: string;
  site_id: string;
  response_data?: any;
  additional_data?: any;
  message_id?: string;
}): Promise<{ 
  success: boolean; 
  error?: string; 
  conversation_id?: string;
  message_id?: string;
  conversation_exists: boolean;
  message_exists: boolean;
}> {
  console.log(`🔍 Validating message and conversation existence before follow-up...`);
  console.log(`📋 Lead ID: ${request.lead_id}, Site ID: ${request.site_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot validate message and conversation');
      return {
        success: false,
        error: 'Database not available',
        conversation_exists: false,
        message_exists: false
      };
    }

    console.log('✅ Database connection confirmed, validating existence...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Step 1: Find conversation ID if not provided
    let conversationId = request.response_data?.conversation_id || 
                        request.response_data?.lead?.conversation_id ||
                        request.additional_data?.conversation_id;
    
    let conversationExists = false;
    
    if (!conversationId) {
      console.log(`🔍 No conversation ID provided, searching by lead_id...`);
      
             const { data: conversation, error: findError } = await supabaseServiceRole
         .from('conversations')
         .select('id, status, custom_data, updated_at, last_message_at, created_at')
         .eq('lead_id', request.lead_id)
         .eq('site_id', request.site_id)
         .order('created_at', { ascending: false })
         .limit(1)
         .single();

       if (findError && findError.code !== 'PGRST116') {
         console.error(`❌ Error searching for conversation:`, findError);
         return {
           success: false,
           error: `Failed to search for conversation: ${findError.message}`,
           conversation_exists: false,
           message_exists: false
         };
       }

       if (conversation) {
         conversationId = conversation.id;
         conversationExists = true;
         console.log(`✅ Found conversation by lead_id and reloaded from database:`);
         console.log(`   - Conversation ID: ${conversationId}`);
         console.log(`   - Status: ${conversation.status}`);
         console.log(`   - Created: ${conversation.created_at}`);
         console.log(`   - Last updated: ${conversation.updated_at}`);
         console.log(`   - Last message: ${conversation.last_message_at}`);
         console.log(`   - Custom data:`, conversation.custom_data);
       }
    } else {
      console.log(`🔍 Validating provided conversation ID: ${conversationId}...`);
      
             const { data: conversation, error: validateError } = await supabaseServiceRole
         .from('conversations')
         .select('id, status, custom_data, updated_at, last_message_at')
         .eq('id', conversationId)
         .eq('site_id', request.site_id)
         .single();

       if (validateError) {
         console.error(`❌ Conversation ${conversationId} not found or invalid:`, validateError);
         conversationExists = false;
       } else {
         conversationExists = true;
         console.log(`✅ Conversation ${conversationId} exists and reloaded from database:`);
         console.log(`   - Status: ${conversation.status}`);
         console.log(`   - Last updated: ${conversation.updated_at}`);
         console.log(`   - Last message: ${conversation.last_message_at}`);
         console.log(`   - Custom data:`, conversation.custom_data);
       }
    }

    // Step 2: Validate message if message_id provided
    let messageExists = false;
    const messageId = request.message_id || request.response_data?.message_id;
    
    if (messageId && conversationId) {
      console.log(`🔍 Validating message ID: ${messageId}...`);
      
      const { data: message, error: messageError } = await supabaseServiceRole
        .from('messages')
        .select('id, custom_data')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .single();

      if (messageError) {
        console.error(`❌ Message ${messageId} not found:`, messageError);
        messageExists = false;
      } else {
        messageExists = true;
        console.log(`✅ Message ${messageId} exists in conversation`);
        console.log(`📊 Message custom_data:`, message.custom_data);
      }
    } else {
      console.log(`⚠️ No message ID provided for validation - skipping message check`);
      messageExists = true; // Don't fail validation for missing message ID
    }

    // Step 3: Final validation result
    const validationSuccess = conversationExists; // Message is optional
    
    if (validationSuccess) {
      console.log(`✅ Validation successful - ready for follow-up message sending`);
      if (conversationId) {
        console.log(`💬 Conversation ${conversationId} is ready for new messages`);
      }
      if (messageId && messageExists) {
        console.log(`📝 Message ${messageId} exists and can be updated`);
      }
    } else {
      console.log(`❌ Validation failed - cannot proceed with follow-up`);
      console.log(`   - Conversation exists: ${conversationExists}`);
      console.log(`   - Message exists: ${messageExists}`);
    }
    
    return {
      success: validationSuccess,
      conversation_id: conversationId,
      message_id: messageId,
      conversation_exists: conversationExists,
      message_exists: messageExists,
      error: validationSuccess ? undefined : 'Validation failed - required entities do not exist'
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception validating message and conversation:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage,
      conversation_exists: false,
      message_exists: false
    };
  }
}

/**
 * Activity to update message status from pending to sent after successful follow-up delivery
 * Updates the custom_data field in the messages table
 */
export async function updateMessageStatusToSentActivity(request: {
  message_id?: string;
  conversation_id?: string;
  lead_id: string;
  site_id: string;
  delivery_channel: 'email' | 'whatsapp';
  delivery_success: boolean;
  delivery_details?: any;
}): Promise<{ success: boolean; error?: string; updated_message_id?: string }> {
  console.log(`📝 Updating message status to 'sent' after follow-up delivery...`);
  console.log(`📋 Message ID: ${request.message_id}, Channel: ${request.delivery_channel}, Success: ${request.delivery_success}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update message status');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, updating message status...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    let messageId = request.message_id;
    
    // If no message_id provided, try to find the most recent message in the conversation
    if (!messageId && request.conversation_id) {
      console.log(`🔍 No message ID provided, searching for recent message in conversation...`);
      
      const { data: recentMessage, error: findError } = await supabaseServiceRole
        .from('messages')
        .select('id, custom_data')
        .eq('conversation_id', request.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (findError && findError.code !== 'PGRST116') {
        console.error(`❌ Error finding recent message:`, findError);
        return {
          success: false,
          error: `Failed to find recent message: ${findError.message}`
        };
      }

      if (recentMessage) {
        messageId = recentMessage.id;
        console.log(`✅ Found recent message: ${messageId}`);
      }
    }

    if (!messageId) {
      console.log(`⚠️ No message found to update - this is normal for some follow-ups`);
      return {
        success: true, // Don't fail the workflow for missing message
        error: 'No message found to update'
      };
    }

    console.log(`📝 Reloading and updating message ${messageId} status...`);
    console.log(`🔄 Reloading message from database to ensure current state...`);

    // Reload the complete message from database to ensure we have the latest state
    // This is important because 2+ hours may have passed since the workflow started
    const { data: currentMessage, error: getCurrentError } = await supabaseServiceRole
      .from('messages')
      .select('id, conversation_id, content, role, custom_data, created_at, updated_at')
      .eq('id', messageId)
      .single();

    if (getCurrentError) {
      console.error(`❌ Error reloading current message data:`, getCurrentError);
      return {
        success: false,
        error: `Failed to reload message: ${getCurrentError.message}`
      };
    }

    console.log(`✅ Message reloaded from database:`);
    console.log(`   - Message ID: ${currentMessage.id}`);
    console.log(`   - Conversation ID: ${currentMessage.conversation_id}`);
    console.log(`   - Role: ${currentMessage.role}`);
    console.log(`   - Created: ${currentMessage.created_at}`);
    console.log(`   - Last Updated: ${currentMessage.updated_at}`);
    console.log(`   - Current custom_data:`, JSON.stringify(currentMessage.custom_data, null, 2));

    // Verify the message still belongs to the correct conversation (security check)
    if (request.conversation_id && currentMessage.conversation_id !== request.conversation_id) {
      console.error(`❌ Message ${messageId} conversation mismatch:`);
      console.error(`   - Expected: ${request.conversation_id}`);
      console.error(`   - Actual: ${currentMessage.conversation_id}`);
      return {
        success: false,
        error: 'Message conversation mismatch - possible data corruption'
      };
    }

    // Check if message was already processed by another workflow
    const currentCustomData = currentMessage.custom_data || {};
    const currentStatus = currentCustomData.status;
    const alreadyProcessed = currentCustomData.follow_up?.processed;
    
    if (alreadyProcessed && currentStatus === 'sent') {
      console.log(`⚠️ Message ${messageId} was already processed and marked as 'sent'`);
      console.log(`   - Current status: ${currentStatus}`);
      console.log(`   - Processed at: ${currentCustomData.follow_up?.processed_at}`);
      console.log(`   - Skipping duplicate processing`);
      return {
        success: true,
        updated_message_id: messageId,
        error: 'Message already processed'
      };
    }

    if (currentStatus && currentStatus !== 'pending' && currentStatus !== 'sent') {
      console.log(`⚠️ Message ${messageId} has unexpected status: ${currentStatus}`);
      console.log(`   - Expected: 'pending' or 'sent'`);
      console.log(`   - Proceeding with update anyway`);
    }

    // Prepare updated custom_data, preserving existing fields
    const targetStatus = request.delivery_success ? 'sent' : 'failed';
    console.log(`📝 Updating message status from '${currentStatus || 'undefined'}' to '${targetStatus}'`);
    
    const updatedCustomData = {
      ...currentCustomData,
      status: targetStatus,
      delivery: {
        channel: request.delivery_channel,
        success: request.delivery_success,
        timestamp: new Date().toISOString(),
        details: request.delivery_details || {}
      },
      follow_up: {
        processed: true,
        processed_at: new Date().toISOString(),
        lead_id: request.lead_id,
        site_id: request.site_id
      }
    };

    // Update message with new status
    const { data, error } = await supabaseServiceRole
      .from('messages')
      .update({
        custom_data: updatedCustomData,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) {
      console.error(`❌ Error updating message ${messageId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Message ${messageId} not found or update failed`
      };
    }

    console.log(`✅ Successfully updated message ${messageId} status to '${targetStatus}'`);
    console.log(`📊 Message now marked as processed via ${request.delivery_channel}`);
    
    return {
      success: true,
      updated_message_id: messageId
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating message status:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 