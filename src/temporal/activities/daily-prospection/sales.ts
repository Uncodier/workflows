import { apiService } from '../../services/apiService';
import { getSupabaseService } from '../../services/supabaseService';
import { ProspectionLead } from './types';

/**
 * Activity to send leads to sales agent for lead selection and prioritization
 */
export async function sendLeadsToSalesAgentActivity(
  options: {
    site_id: string;
    leads: ProspectionLead[];
    userId?: string;
    additionalData?: any;
  }
): Promise<{
  success: boolean;
  response?: any;
  selectedLeads?: any[];
  priority?: any;
  error?: string;
}> {
  const { site_id, leads, userId } = options;
  
  console.log(`🎯 Sending ${leads.length} leads to sales agent for selection and prioritization`);
  console.log(`   - Site ID: ${site_id}`);
  console.log(`   - User ID: ${userId}`);
  
  try {
    if (!leads || leads.length === 0) {
      console.log('ℹ️ No leads to send to sales agent');
      return {
        success: true,
        selectedLeads: [],
        response: { message: 'No leads provided' }
      };
    }

    // Prepare request body for the sales agent API
    // Send only lead IDs and siteId at root level (converted to camelCase for API)
    const requestBody = {
      siteId: site_id,  // Convert to camelCase for API consistency
      leads: leads.map(lead => lead.id), // Send only the IDs
      userId: userId,
      additionalData: {
        workflowType: 'dailyProspection',
        // Only include essential data to avoid 414 errors
        siteName: options.additionalData?.siteName,
        siteUrl: options.additionalData?.siteUrl,
        workflowId: options.additionalData?.workflowId
        // Exclude large objects that could cause 414 errors
      }
    };

    const requestBodySize = JSON.stringify(requestBody).length;
    console.log(`📤 Sending leads to sales agent API (${requestBodySize} bytes):`, {
      leadCount: leads.length,
      endpoint: '/api/agents/sales/leadSelection'
    });
    
    // Warn if request body is getting large
    if (requestBodySize > 50000) { // 50KB warning threshold
      console.warn(`⚠️ Large request body detected (${requestBodySize} bytes). This might cause 414 errors.`);
    }

    // Call the sales agent API with reasonable timeout (2 minutes)
    const response = await apiService.request('/api/agents/sales/leadSelection', {
      method: 'POST',
      body: requestBody,
      timeout: 120000 // 2 minutes timeout for lead selection
    });

    if (!response.success) {
      console.error(`❌ Failed to send leads to sales agent:`, response.error);
      throw new Error(`Failed to send leads to sales agent: ${response.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ Successfully sent leads to sales agent`);
    console.log(`📊 Sales agent response:`, JSON.stringify(response.data, null, 2));

    // Extract selected leads and priority information from response
    const selectedLeads = response.data?.selectedLeads || response.data?.leads || response.data?.results || [];
    const priority = response.data?.priority || response.data?.prioritization || response.data?.analysis;

    console.log(`🎯 Sales agent results:`);
    console.log(`   - Selected leads: ${selectedLeads.length}`);
    console.log(`   - Priority analysis: ${priority ? 'Available' : 'Not provided'}`);

    return {
      success: true,
      response: response.data,
      selectedLeads: selectedLeads,
      priority: priority
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception sending leads to sales agent:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to assign priority leads based on sales agent response
 */
export async function assignPriorityLeadsActivity(
  options: {
    site_id: string;
    salesAgentResponse: any;
    userId?: string;
    additionalData?: any;
  }
): Promise<{
  success: boolean;
  assignedLeads: any[];
  notificationResults: any[];
  error?: string;
}> {
  const { site_id, salesAgentResponse } = options;
  
  console.log(`📋 Processing lead assignments from sales agent response`);
  console.log(`   - Site ID: ${site_id}`);
  
  try {
    const importantAccounts = salesAgentResponse?.important_accounts || [];
    
    if (!importantAccounts || importantAccounts.length === 0) {
      console.log('ℹ️ No important accounts found for assignment');
      return {
        success: true,
        assignedLeads: [],
        notificationResults: []
      };
    }

    console.log(`🎯 Found ${importantAccounts.length} important accounts for assignment`);

    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️ Database not available, cannot assign leads');
      return {
        success: false,
        assignedLeads: [],
        notificationResults: [],
        error: 'Database not available'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    const assignedLeads: any[] = [];
    const notificationResults: any[] = [];

    // Process each important account
    for (const account of importantAccounts) {
      const leadId = account.lead_id;
      const assigneeId = account.recommended_assignee_id;
      const assigneeName = account.recommended_assignee_name;
      
      if (!leadId || !assigneeId) {
        console.log(`⚠️ Skipping account - missing lead_id or assignee_id:`, account);
        continue;
      }

      console.log(`📌 Assigning lead ${leadId} to ${assigneeName} (${assigneeId})`);

      try {
        // Step 1: Update lead assignee_id in database
        const { data: updatedLead, error: updateError } = await supabaseServiceRole
          .from('leads')
          .update({
            assignee_id: assigneeId,
            updated_at: new Date().toISOString(),
            last_contact: new Date().toISOString()
          })
          .eq('id', leadId)
          .eq('site_id', site_id)
          .select()
          .single();

        if (updateError) {
          console.error(`❌ Failed to update lead ${leadId} assignee:`, updateError);
          continue;
        }

        console.log(`✅ Successfully updated lead ${leadId} assignee to ${assigneeId}`);

        // Step 2: Send lead assignment notification
        const contactRecommendation = salesAgentResponse?.contact_recommendations?.find(
          (rec: any) => rec.lead_id === leadId
        );

        const priorityLead = salesAgentResponse?.priority_leads?.find(
          (lead: any) => lead.primary_lead_id === leadId
        );

        const notificationBody = {
          lead_id: leadId,
          assignee_id: assigneeId,
          brief: `Cuenta importante: ${account.company} - ${account.assignment_reasoning}`,
          next_steps: contactRecommendation?.key_talking_points 
            ? contactRecommendation.key_talking_points.split(', ').map((point: string) => `Enfocar en: ${point}`)
            : ['Contactar al prospecto', 'Revisar información de la empresa', 'Preparar propuesta inicial'],
          priority: contactRecommendation?.urgency?.toLowerCase() || 'medium',
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
          additional_context: `${account.assignment_reasoning}. ${contactRecommendation?.contact_strategy || ''}`,
          include_team_notification: true,
          metadata: {
            source: 'daily_prospection_workflow',
            account_value: account.account_value,
            priority_score: priorityLead?.priority_score,
            company: account.company,
            workflow_id: options.additionalData?.workflowId,
            // Only include essential data to avoid 414 errors
            siteName: options.additionalData?.siteName,
            siteUrl: options.additionalData?.siteUrl,
            workflowType: options.additionalData?.workflowType
            // Exclude large objects that could cause 414 errors
          }
        };

        const requestBodySize = JSON.stringify(notificationBody).length;
        console.log(`📤 Sending lead assignment notification (${requestBodySize} bytes):`, {
          lead_id: leadId,
          assignee_id: assigneeId,
          company: account.company
        });
        
        // Warn if request body is getting large
        if (requestBodySize > 50000) { // 50KB warning threshold
          console.warn(`⚠️ Large request body detected (${requestBodySize} bytes). This might cause 414 errors.`);
        }

        const notificationResponse = await apiService.request('/api/notifications/leadAssignment', {
          method: 'POST',
          body: notificationBody,
          timeout: 30000 // 30 seconds timeout for notifications
        });

        if (notificationResponse.success) {
          console.log(`✅ Successfully sent assignment notification for lead ${leadId}`);
          notificationResults.push({
            lead_id: leadId,
            assignee_id: assigneeId,
            success: true,
            response: notificationResponse.data
          });
        } else {
          console.error(`❌ Failed to send assignment notification for lead ${leadId}:`, notificationResponse.error);
          notificationResults.push({
            lead_id: leadId,
            assignee_id: assigneeId,
            success: false,
            error: notificationResponse.error?.message || 'Failed to send notification'
          });
        }

        assignedLeads.push({
          lead_id: leadId,
          assignee_id: assigneeId,
          assignee_name: assigneeName,
          company: account.company,
          account_value: account.account_value,
          assignment_reasoning: account.assignment_reasoning,
          updated_lead: updatedLead
        });

      } catch (leadError) {
        const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
        console.error(`❌ Exception processing lead assignment ${leadId}:`, errorMessage);
        
        notificationResults.push({
          lead_id: leadId,
          assignee_id: assigneeId,
          success: false,
          error: errorMessage
        });
      }
    }

    console.log(`✅ Lead assignment process completed:`);
    console.log(`   - Total important accounts: ${importantAccounts.length}`);
    console.log(`   - Successfully assigned: ${assignedLeads.length}`);
    console.log(`   - Notification successes: ${notificationResults.filter(r => r.success).length}`);
    console.log(`   - Notification failures: ${notificationResults.filter(r => !r.success).length}`);

    return {
      success: true,
      assignedLeads,
      notificationResults
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception in lead assignment activity:`, errorMessage);
    
    return {
      success: false,
      assignedLeads: [],
      notificationResults: [],
      error: errorMessage
    };
  }
}
