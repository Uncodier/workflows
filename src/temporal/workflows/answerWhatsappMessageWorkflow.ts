import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { 
  WhatsAppMessageData, 
  WhatsAppAnalysisResponse 
} from '../activities/whatsappActivities';

// Configure activity options
const { 
  analyzeWhatsAppMessageActivity,
  sendWhatsAppResponseActivity 
} = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Answer WhatsApp Message Workflow
 * Analyzes incoming WhatsApp messages and optionally sends automated responses
 */
export async function answerWhatsappMessageWorkflow(
  messageData: WhatsAppMessageData,
  options?: {
    autoRespond?: boolean;
    agentId?: string;
  }
): Promise<{
  success: boolean;
  analyzed: boolean;
  responded: boolean;
  analysis?: WhatsAppAnalysisResponse['analysis'];
  response?: {
    message_id?: string;
    sent_message?: string;
  };
  error?: string;
  workflow_id: string;
}> {
  const workflowId = `whatsapp-message-${messageData.message_id || Date.now()}`;
  
  console.log('📱 Starting WhatsApp message workflow...');
  console.log(`🆔 Workflow ID: ${workflowId}`);
  console.log(`📞 From: ${messageData.contact_name || messageData.phone}`);
  console.log(`💬 Message: ${messageData.message.substring(0, 100)}...`);
  console.log(`🏢 Site: ${messageData.site_id}, User: ${messageData.user_id}`);
  
  let analyzed = false;
  let responded = false;
  let analysis: WhatsAppAnalysisResponse['analysis'];
  let responseData: { message_id?: string; sent_message?: string } | undefined;
  
  try {
    // Step 1: Analyze the WhatsApp message
    console.log('🔍 Step 1: Analyzing WhatsApp message...');
    
    const analysisResult = await analyzeWhatsAppMessageActivity(messageData);
    
    if (!analysisResult.success) {
      console.error('❌ WhatsApp analysis failed:', analysisResult.error);
      return {
        success: false,
        analyzed: false,
        responded: false,
        error: analysisResult.error?.message || 'Analysis failed',
        workflow_id: workflowId
      };
    }
    
    analyzed = true;
    analysis = analysisResult.analysis;
    
    console.log('✅ WhatsApp message analysis completed');
    console.log(`📊 Analysis summary:`, {
      intent: analysis?.intent,
      priority: analysis?.priority,
      response_type: analysis?.response_type,
      sentiment: analysis?.sentiment,
      requires_action: analysis?.requires_action,
      has_suggested_response: !!analysis?.suggested_response
    });
    
    // Step 2: Send automated response if enabled and suggested
    if (options?.autoRespond && analysis?.suggested_response && analysis?.response_type === 'automated') {
      console.log('📤 Step 2: Sending automated WhatsApp response...');
      console.log(`🤖 Suggested response: ${analysis.suggested_response.substring(0, 100)}...`);
      
      try {
        const sendResult = await sendWhatsAppResponseActivity({
          phone: messageData.phone,
          message: analysis.suggested_response,
          conversation_id: messageData.conversation_id,
          site_id: messageData.site_id,
          user_id: messageData.user_id,
          agent_id: options.agentId,
          message_type: 'text'
        });
        
        if (sendResult.success) {
          responded = true;
          responseData = {
            message_id: sendResult.message_id,
            sent_message: analysis.suggested_response
          };
          console.log('✅ Automated WhatsApp response sent successfully');
          console.log(`📨 Message ID: ${sendResult.message_id}`);
        } else {
          console.log('⚠️ Failed to send automated response:', sendResult.error);
        }
        
      } catch (responseError) {
        console.error('❌ WhatsApp response failed:', responseError);
        // Don't fail the entire workflow if response fails
      }
      
    } else if (analysis?.response_type === 'human_required') {
      console.log('👨‍💼 Human response required - skipping automated response');
    } else if (!options?.autoRespond) {
      console.log('🔇 Auto-respond disabled - skipping automated response');
    } else if (!analysis?.suggested_response) {
      console.log('💭 No suggested response available - skipping automated response');
    } else {
      console.log(`📋 Response type "${analysis?.response_type}" - skipping automated response`);
    }
    
    console.log('✅ WhatsApp message workflow completed successfully');
    return {
      success: true,
      analyzed,
      responded,
      analysis,
      response: responseData,
      workflow_id: workflowId
    };
    
  } catch (error) {
    console.error('❌ WhatsApp message workflow failed:', error);
    return {
      success: false,
      analyzed,
      responded,
      error: error instanceof Error ? error.message : String(error),
      workflow_id: workflowId
    };
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
  analyzed: number;
  responded: number;
  failed: number;
  results: Array<{
    index: number;
    phone: string;
    success: boolean;
    analyzed: boolean;
    responded: boolean;
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
  console.log(`🤖 Auto-respond: ${options?.autoRespond ? 'enabled' : 'disabled'}`);
  
  const results: Array<{
    index: number;
    phone: string;
    success: boolean;
    analyzed: boolean;
    responded: boolean;
    error?: string;
    workflowId: string;
  }> = [];
  
  let processed = 0;
  let analyzed = 0;
  let responded = 0;
  let failed = 0;
  
  try {
    // Process each message with intervals
    for (let i = 0; i < messages.length; i++) {
      const messageData = messages[i];
      const workflowId = `batch-whatsapp-${i}-${Date.now()}`;
      
      console.log(`📱 Processing WhatsApp message ${i + 1}/${totalMessages}`);
      console.log(`📞 From: ${messageData.contact_name || messageData.phone}`);
      console.log(`💬 Message preview: ${messageData.message.substring(0, 50)}...`);
      
      try {
        const result = await answerWhatsappMessageWorkflow(messageData, options);
        
        processed++;
        if (result.analyzed) analyzed++;
        if (result.responded) responded++;
        
        if (!result.success) {
          failed++;
        }
        
        results.push({
          index: i,
          phone: messageData.phone,
          success: result.success,
          analyzed: result.analyzed,
          responded: result.responded,
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
          phone: messageData.phone,
          success: false,
          analyzed: false,
          responded: false,
          error: errorMessage,
          workflowId: workflowId
        });
      }
    }
    
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.log('🎉 Batch WhatsApp messages workflow completed');
    console.log(`📊 Summary: ${processed} processed, ${analyzed} analyzed, ${responded} responded, ${failed} failed`);
    
    return {
      totalMessages,
      processed,
      analyzed,
      responded,
      failed,
      results,
      executionTime
    };
    
  } catch (error) {
    console.error('❌ Batch WhatsApp messages workflow failed:', error);
    throw error;
  }
} 