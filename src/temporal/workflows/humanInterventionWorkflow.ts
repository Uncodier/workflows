import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Configure activity options
const { teamMemberInterventionActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export interface HumanInterventionWorkflowParams {
  conversationId: string;
  message: string;
  user_id: string;
  agentId: string;
  conversation_title?: string;
  lead_id?: string;
  visitor_id?: string;
  site_id?: string;
  origin?: 'email' | 'whatsapp';
}

export interface HumanInterventionWorkflowResult {
  success: boolean;
  conversationId: string;
  messageId?: string;
  origin?: string;
  emailResult?: any;
  whatsappResult?: any;
  executionTime: string;
  timestamp: string;
  error?: string;
}

/**
 * Human Intervention Workflow
 * Records team member intervention in agent conversations and optionally
 * triggers email or WhatsApp workflows based on origin
 */
export async function humanInterventionWorkflow(
  params: HumanInterventionWorkflowParams
): Promise<HumanInterventionWorkflowResult> {
  console.log(`👤 Starting human intervention workflow for conversation ${params.conversationId}`);
  const startTime = new Date();

  try {
    // Step 1: Record the human intervention via API
    console.log(`📝 Step 1: Recording team member intervention in conversation...`);
    const interventionResult = await teamMemberInterventionActivity({
      conversationId: params.conversationId,
      message: params.message,
      user_id: params.user_id,
      agentId: params.agentId,
      conversation_title: params.conversation_title,
      lead_id: params.lead_id,  
      visitor_id: params.visitor_id,
      site_id: params.site_id
    });

    if (!interventionResult.success) {
      throw new Error(`Failed to record intervention: ${interventionResult.error}`);
    }

    console.log(`✅ Team member intervention recorded successfully: ${interventionResult.messageId}`);

    const result: HumanInterventionWorkflowResult = {
      success: true,
      conversationId: params.conversationId,
      messageId: interventionResult.messageId,
      origin: params.origin,
      executionTime: '0ms',
      timestamp: interventionResult.timestamp
    };

    // Step 2: Execute additional workflows based on origin
    if (params.origin) {
      console.log(`🚀 Step 2: Processing origin-specific workflow: ${params.origin}`);
      
      if (params.origin === 'email') {
        console.log(`📧 Triggering sendEmailFromAgent workflow...`);
        
        if (!params.site_id) {
          console.log(`⚠️ Warning: site_id is required for email workflow, skipping...`);
        } else {
          try {
            // Note: email field should be provided in a more complete implementation
            // For now, we'll skip if email is not available
            console.log(`⚠️ Email workflow requires recipient email address - workflow will complete with intervention only`);
            result.emailResult = { 
              success: false, 
              error: 'Email address not provided - unable to send email' 
            };
          } catch (emailError) {
            const emailErrorMessage = emailError instanceof Error ? emailError.message : String(emailError);
            console.error(`❌ Email workflow failed: ${emailErrorMessage}`);
            result.emailResult = { success: false, error: emailErrorMessage };
          }
        }
      } 
      else if (params.origin === 'whatsapp') {
        console.log(`📱 Triggering sendWhatsappFromAgent workflow...`);
        
        if (!params.site_id) {
          console.log(`⚠️ Warning: site_id is required for WhatsApp workflow, skipping...`);
        } else {
          try {
            // Note: phone_number field should be provided in a more complete implementation
            // For now, we'll skip if phone number is not available
            console.log(`⚠️ WhatsApp workflow requires recipient phone number - workflow will complete with intervention only`);
            result.whatsappResult = { 
              success: false, 
              error: 'Phone number not provided - unable to send WhatsApp message' 
            };
          } catch (whatsappError) {
            const whatsappErrorMessage = whatsappError instanceof Error ? whatsappError.message : String(whatsappError);
            console.error(`❌ WhatsApp workflow failed: ${whatsappErrorMessage}`);
            result.whatsappResult = { success: false, error: whatsappErrorMessage };
          }
        }
      }
    } else {
      console.log(`⏭️ Step 2: No origin specified - workflow completed with intervention recording only`);
    }

    const endTime = new Date();
    result.executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

    console.log(`🎉 Human intervention workflow completed successfully!`);
    console.log(`📊 Summary: Intervention recorded for conversation ${params.conversationId}${params.origin ? ` with ${params.origin} workflow` : ''}`);

    return result;

  } catch (error) {
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error(`❌ Human intervention workflow failed: ${errorMessage}`);

    return {
      success: false,
      conversationId: params.conversationId,
      origin: params.origin,
      executionTime,
      timestamp: new Date().toISOString(),
      error: errorMessage
    };
  }
} 