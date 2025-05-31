import { proxyActivities, sleep, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { AnalysisData, ScheduleCustomerSupportParams } from '../activities/customerSupportActivities';

// Configure activity options
const { 
  sendCustomerSupportMessageActivity,
  processAnalysisDataActivity 
} = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Single Customer Support Message Workflow
 * Processes one analysis and sends a customer support message
 */
export async function customerSupportMessageWorkflow(
  analysisData: AnalysisData,
  baseParams: {
    agentId?: string;
  }
): Promise<{
  success: boolean;
  processed: boolean;
  reason: string;
  response?: any;
  error?: string;
}> {
  console.log('🎯 Starting single customer support message workflow...');
  console.log(`📋 Processing analysis ID: ${analysisData.analysis_id}`);
  
  try {
    // First, process the analysis to determine if action is needed
    const processResult = await processAnalysisDataActivity(analysisData);
    
    if (!processResult.shouldProcess) {
      console.log('⏭️ Skipping analysis - not requiring immediate action');
      return {
        success: true,
        processed: false,
        reason: processResult.reason
      };
    }
    
    console.log('📞 Processing analysis - sending customer support message');
    
    // Send the customer support message using data from analysisData
    const response = await sendCustomerSupportMessageActivity(analysisData, {
      site_id: analysisData.site_id,
      agentId: baseParams.agentId,
      userId: analysisData.user_id,
    });
    
    console.log('✅ Customer support message workflow completed successfully');
    return {
      success: true,
      processed: true,
      reason: processResult.reason,
      response
    };
    
  } catch (error) {
    console.error('❌ Customer support message workflow failed:', error);
    return {
      success: false,
      processed: false,
      reason: 'Workflow execution failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Schedule Customer Support Messages Workflow
 * Takes an array of analysis data and schedules customer support messages
 * with 1-minute intervals between each message
 */
export async function scheduleCustomerSupportMessagesWorkflow(
  params: ScheduleCustomerSupportParams
): Promise<{
  totalAnalysis: number;
  scheduled: number;
  skipped: number;
  completed: number;
  failed: number;
  results: Array<{
    index: number;
    workflowId: string;
    success: boolean;
    processed: boolean;
    reason: string;
    error?: string;
    analysisId: string;
  }>;
  executionTime: string;
}> {
  console.log('🚀 Starting schedule customer support messages workflow...');
  const startTime = new Date();
  
  const { analysisArray, agentId } = params;
  const totalAnalysis = analysisArray.length;
  
  console.log(`📊 Processing ${totalAnalysis} analysis items for customer support...`);
  
  const baseParams = {
    agentId
  };
  
  const results: Array<{
    index: number;
    workflowId: string;
    success: boolean;
    processed: boolean;
    reason: string;
    error?: string;
    analysisId: string;
  }> = [];
  
  let scheduled = 0;
  let skipped = 0;
  let completed = 0;
  let failed = 0;
  
  try {
    // Process each analysis with 1-minute intervals
    for (let i = 0; i < analysisArray.length; i++) {
      const analysisData = analysisArray[i];
      const workflowId = `customer-support-message-${analysisData.analysis_id}`;
      
      console.log(`📋 Processing analysis ${i + 1}/${totalAnalysis} (ID: ${workflowId})`);
      console.log(`🏢 Site: ${analysisData.site_id}, User: ${analysisData.user_id}`);
      
      try {
        // Start child workflow for this specific analysis
        const handle = await startChild(customerSupportMessageWorkflow, {
          workflowId,
          args: [analysisData, baseParams],
        });
        
        scheduled++;
        console.log(`✅ Scheduled customer support message workflow: ${workflowId}`);
        
        // Wait for the child workflow to complete
        const result = await handle.result();
        
        if (result.success) {
          if (result.processed) {
            completed++;
            console.log(`✅ Completed processing analysis ${i + 1}: ${result.reason}`);
          } else {
            skipped++;
            console.log(`⏭️ Skipped analysis ${i + 1}: ${result.reason}`);
          }
        } else {
          failed++;
          console.error(`❌ Failed analysis ${i + 1}: ${result.error}`);
        }
        
        results.push({
          index: i,
          workflowId,
          success: result.success,
          processed: result.processed,
          reason: result.reason,
          error: result.error,
          analysisId: analysisData.analysis_id
        });
        
        // Sleep for 1 minute before processing the next analysis (except for the last one)
        if (i < analysisArray.length - 1) {
          console.log('⏰ Waiting 1 minute before processing next analysis...');
          await sleep('1m');
        }
        
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to start workflow for analysis ${i + 1}:`, errorMessage);
        
        results.push({
          index: i,
          workflowId,
          success: false,
          processed: false,
          reason: 'Failed to start workflow',
          error: errorMessage,
          analysisId: analysisData.analysis_id
        });
      }
    }
    
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.log('🎉 Schedule customer support messages workflow completed');
    console.log(`📊 Summary: ${completed} completed, ${skipped} skipped, ${failed} failed`);
    
    return {
      totalAnalysis,
      scheduled,
      skipped,
      completed,
      failed,
      results,
      executionTime
    };
    
  } catch (error) {
    console.error('❌ Schedule customer support messages workflow failed:', error);
    throw error;
  }
} 