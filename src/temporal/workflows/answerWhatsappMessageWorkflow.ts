import { startChild, ParentClosePolicy, upsertSearchAttributes } from '@temporalio/workflow';
import type { 
  WhatsAppMessageData 
} from '../activities/whatsappActivities';
import { customerSupportMessageWorkflow } from './customerSupportWorkflow';

// Note: proxyActivities and Activities available for future use if needed
// import { proxyActivities } from '@temporalio/workflow';
// import type { Activities } from '../activities';

// Configure activity options - keeping for potential future use
// const activities = proxyActivities<Activities>({
//   startToCloseTimeout: '2 minutes',
//   retry: {
//     maximumAttempts: 3,
//   },
// });

// Note: sendWhatsAppResponseActivity available if needed in the future
// const { sendWhatsAppResponseActivity } = activities;

/**
 * Answer WhatsApp Message Workflow
 * Processes incoming WhatsApp messages and delegates customer support handling to the main workflow
 */
export async function answerWhatsappMessageWorkflow(
  messageData: WhatsAppMessageData,
  options?: {
    autoRespond?: boolean;
    agentId?: string;
  }
): Promise<{
  success: boolean;
  customerSupportTriggered?: boolean;
  customerSupportResult?: {
    success: boolean;
    processed: boolean;
    workflowId?: string;
    reason?: string;
    whatsappSent?: boolean;
    whatsappWorkflowId?: string;
  };
  error?: string;
  workflow_id: string;
}> {
  const workflowId = `whatsapp-message-${messageData.messageId || Date.now()}`;

  if (messageData.siteId) {
    const searchAttributes: Record<string, string[]> = {
      site_id: [messageData.siteId],
    };
    if (messageData.userId) {
      searchAttributes.user_id = [messageData.userId];
    }
    upsertSearchAttributes(searchAttributes);
  }
  
  console.log('📱 Starting WhatsApp message workflow...');
  console.log(`🆔 Workflow ID: ${workflowId}`);
  console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
  console.log(`💬 Message: ${messageData.messageContent?.substring(0, 100) || 'No message content'}...`);
  console.log(`🏢 Site: ${messageData.siteId}, User: ${messageData.userId}`);
  
  let customerSupportTriggered = false;
  let customerSupportResult: { 
    success: boolean; 
    processed: boolean; 
    workflowId?: string; 
    reason?: string;
    whatsappSent?: boolean;
    whatsappWorkflowId?: string;
  } | undefined;
  
  try {
    // Call Customer Support workflow directly - it will handle analysis and response
    console.log('🎯 Triggering Customer Support workflow directly...');
    
    try {
      const customerSupportWorkflowId = `whatsapp-customer-support-${messageData.messageId || Date.now()}`;
      
      // Prepare data for customer support workflow
      const whatsappDataForCS = {
        whatsappData: messageData
      };
      
      const baseParams = {
        agentId: options?.agentId,
        origin: "whatsapp",
        origin_message_id: messageData.messageId,
      };
      
      // Start customer support workflow as child workflow
      const customerSupportHandle = await startChild(customerSupportMessageWorkflow, {
        workflowId: customerSupportWorkflowId,
        args: [whatsappDataForCS, baseParams],
        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      });
      
      customerSupportTriggered = true;
      console.log(`✅ Customer support workflow started: ${customerSupportWorkflowId}`);
      console.log(`🚀 Parent close policy: ABANDON - customer support workflow will continue independently`);
      
      // Wait for customer support workflow to complete
      const csResult = await customerSupportHandle.result();
      
      customerSupportResult = {
        success: csResult.success,
        processed: csResult.data?.processed || false,
        workflowId: customerSupportWorkflowId,
        reason: csResult.data?.reason || 'No reason provided',
        whatsappSent: csResult.data?.whatsappSent || false,
        whatsappWorkflowId: csResult.data?.whatsappWorkflowId
      };
      
      if (csResult.success) {
        console.log('✅ Customer support workflow completed successfully');
        if (csResult.data?.processed) {
          console.log(`📋 Customer support processed: ${csResult.data.reason}`);
          if (csResult.data?.whatsappSent) {
            console.log(`📱 Follow-up WhatsApp sent via workflow: ${csResult.data.whatsappWorkflowId}`);
          }
        } else {
          console.log(`⏭️ Customer support skipped: ${csResult.data?.reason}`);
        }
      } else {
        console.log('⚠️ Customer support workflow failed, but WhatsApp workflow continues');
      }
      
    } catch (customerSupportError) {
      console.error('❌ Customer support workflow failed:', customerSupportError);
      customerSupportResult = {
        success: false,
        processed: false,
        workflowId: `whatsapp-customer-support-${messageData.messageId || Date.now()}`,
        reason: 'Customer support workflow failed',
        whatsappSent: false
      };
      // Don't fail the entire WhatsApp workflow if customer support fails
    }
    
    console.log('✅ WhatsApp message workflow completed successfully');
    return {
      success: true,
      customerSupportTriggered,
      customerSupportResult,
      workflow_id: workflowId
    };
    
  } catch (error) {
    console.error('❌ WhatsApp message workflow failed:', error);
    // Throw error to properly fail the workflow
    throw new Error(`WhatsApp message workflow failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Batch WhatsApp Messages Workflow
 * Processes multiple WhatsApp messages with intervals
 */
export async function processWhatsAppMessagesWorkflow(
  messages: WhatsAppMessageData[],
  options?: {
    autoRespond?: boolean;
    agentId?: string;
    intervalMinutes?: number;
  }
): Promise<{
  totalMessages: number;
  processed: number;
  customerSupportTriggered: number;
  whatsappSent: number;
  failed: number;
  results: Array<{
    index: number;
    phone: string;
    success: boolean;
    customerSupportTriggered: boolean;
    whatsappSent: boolean;
    error?: string;
    workflowId: string;
  }>;
  executionTime: string;
}> {
  console.log('📱 Starting batch WhatsApp messages workflow...');
  const startTime = new Date();
  
  const totalMessages = messages.length;
  const intervalMinutes = options?.intervalMinutes || 1;
  
  console.log(`📊 Processing ${totalMessages} WhatsApp messages...`);
  console.log(`⏰ Interval: ${intervalMinutes} minute(s) between messages`);
  
  const results: Array<{
    index: number;
    phone: string;
    success: boolean;
    customerSupportTriggered: boolean;
    whatsappSent: boolean;
    error?: string;
    workflowId: string;
  }> = [];
  
  let processed = 0;
  let customerSupportTriggered = 0;
  let whatsappSent = 0;
  let failed = 0;
  
  try {
    // Process each message with intervals
    for (let i = 0; i < messages.length; i++) {
      const messageData = messages[i];
      const workflowId = `batch-whatsapp-${i}-${Date.now()}`;
      
      console.log(`📱 Processing WhatsApp message ${i + 1}/${totalMessages}`);
      console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
      console.log(`💬 Message preview: ${messageData.messageContent?.substring(0, 50) || 'No message content'}...`);
      
      try {
        const result = await answerWhatsappMessageWorkflow(messageData, options);
        
        processed++;
        if (result.customerSupportTriggered) customerSupportTriggered++;
        if (result.customerSupportResult?.whatsappSent) whatsappSent++;
        
        if (!result.success) {
          failed++;
        }
        
        results.push({
          index: i,
          phone: messageData.phoneNumber,
          success: result.success,
          customerSupportTriggered: result.customerSupportTriggered || false,
          whatsappSent: result.customerSupportResult?.whatsappSent || false,
          error: result.error,
          workflowId: result.workflow_id
        });
        
        console.log(`✅ Processed message ${i + 1}: ${result.success ? 'success' : 'failed'}`);
        
        // Wait interval before processing next message (except for the last one)
        if (i < messages.length - 1 && intervalMinutes > 0) {
          console.log(`⏰ Waiting ${intervalMinutes} minute(s) before next message...`);
          await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
        }
        
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to process message ${i + 1}:`, errorMessage);
        
        results.push({
          index: i,
          phone: messageData.phoneNumber,
          success: false,
          customerSupportTriggered: false,
          whatsappSent: false,
          error: errorMessage,
          workflowId: workflowId
        });
      }
    }
    
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.log('🎉 Batch WhatsApp messages workflow completed');
    console.log(`📊 Summary: ${processed} processed, ${customerSupportTriggered} triggered customer support, ${whatsappSent} sent follow-up WhatsApp, ${failed} failed`);
    
    return {
      totalMessages,
      processed,
      customerSupportTriggered,
      whatsappSent,
      failed,
      results,
      executionTime
    };
    
  } catch (error) {
    console.error('❌ Batch WhatsApp messages workflow failed:', error);
    throw error;
  }
} 