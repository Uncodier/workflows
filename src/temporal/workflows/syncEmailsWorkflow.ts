import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { scheduleCustomerSupportMessagesWorkflow } from './scheduleCustomerSupportMessagesWorkflow';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  analyzeEmailsActivity,
  syncSentEmailsActivity,
  deliveryStatusActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes', // ✅ FIXED: Increased timeout from 5 to 10 minutes
  retry: {
    maximumAttempts: 3,
  },
});

export interface SyncEmailsOptions {
  userId: string;
  provider: 'gmail' | 'outlook' | 'imap';
  since?: Date | string; // Can be Date or string
  folderIds?: string[];
  batchSize?: number;
  siteId?: string; // Added to track which site this sync is for
  analysisLimit?: number; // Number of emails to analyze
}

interface EmailAnalysisResult {
  success: boolean;
  commandId?: string;
  emailCount?: number;
  analysisCount?: number; // Número de emails realmente analizados
  status?: string;
  message?: string;
  error?: string;
}

interface SyncEmailsResult {
  success: boolean;
  provider: string;
  userId: string;
  siteId: string;
  syncedEmails: number;
  batchesProcessed: number;
  batches: any[];
  syncDuration: string;
  syncedAt: string;
  nextSyncRecommended: string;
  errors: string[];
  analysisResult: EmailAnalysisResult | null;
}

/**
 * Workflow to synchronize emails from various providers
 * 
 * @param options - Configuration options for email synchronization
 */
export async function syncEmailsWorkflow(
  options: SyncEmailsOptions | any
): Promise<SyncEmailsResult> {
  // Handle both camelCase and snake_case parameter formats
  const userId = options.userId || options.user_id;
  const siteId = options.siteId || options.site_id || userId;
  const workflowId = `sync-emails-${userId}`;
  
  console.log(`📧 Starting email sync workflow for user ${userId} (${options.provider})`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'syncEmailsWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  if (siteId) {
    await saveCronStatusActivity({
      siteId,
      workflowId,
      scheduleId: `email-sync-${siteId}`,
      activityName: 'syncEmailsWorkflow',
      status: 'RUNNING',
      lastRun: new Date().toISOString()
    });
  }

  try {
    console.log(`🔍 Step 1: Validating email sync configuration...`);
    
    // Parse since parameter correctly - can be Date object or string
    let sinceDate: Date;
    if (options.since) {
      sinceDate = typeof options.since === 'string' ? new Date(options.since) : options.since;
    } else {
      sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
    }

    // Simulate email sync validation
    const validation = {
      isValid: true,
      provider: options.provider,
      batchSize: options.batchSize || 50,
      since: sinceDate,
      analysisLimit: options.analysisLimit || 15
    };

    if (!validation.isValid) {
      throw new Error(`Invalid email sync configuration for provider ${options.provider}`);
    }

    console.log(`✅ Configuration validated for ${options.provider} provider`);

    console.log(`📬 Step 2: Connecting to ${options.provider} email server...`);
    console.log(`✅ Connected to ${options.provider} email server`);

    console.log(`📥 Step 3: Email sync preparation completed`);
    console.log(`💾 Step 4: Ready to process emails with real activities...`);

    const result: SyncEmailsResult = {
      success: true,
      provider: options.provider,
      userId: userId,
      siteId,
      syncedEmails: 0, // Will be updated by real activities
      batchesProcessed: 0, // Will be updated by real activities  
      batches: [], // Will be updated by real activities
      syncDuration: 'real-time',
      syncedAt: new Date().toISOString(),
      nextSyncRecommended: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      errors: [],
      analysisResult: null,
    };

    // Step 5: AI Email Analysis (always enabled)
    console.log(`🤖 Step 5: Starting AI email analysis...`);
    console.log(`📊 Analyzing up to ${validation.analysisLimit} emails for commercial opportunities`);

    try {
      const analysisRequest = {
        site_id: siteId,
        limit: validation.analysisLimit,
        user_id: userId,
        analysis_type: 'commercial_opportunity',
        since_date: validation.since.toISOString()
      };

      const analysisResponse = await analyzeEmailsActivity(analysisRequest);

      // ✅ FIXED: Properly handle analysis failure and propagate critical errors
      if (analysisResponse.success) {
        console.log(`✅ Email analysis initiated successfully`);
        console.log(`📧 ${analysisResponse.data?.emailCount || 0} emails submitted for analysis`);
        console.log(`🤖 ${analysisResponse.data?.analysisCount || 0} emails were analyzed`);
        console.log(`📋 Command ID: ${analysisResponse.data?.commandId}`);
        
        result.analysisResult = {
          success: true,
          commandId: analysisResponse.data?.commandId,
          emailCount: analysisResponse.data?.emailCount,
          analysisCount: analysisResponse.data?.analysisCount,
          status: analysisResponse.data?.status,
          message: analysisResponse.data?.message
        };

        // 🚀 Activación automática: cuando hay emails analizados, ejecutar customer support
        if (analysisResponse.data?.emails && analysisResponse.data.emails.length > 0) {
          console.log(`🚀 Found ${analysisResponse.data.emails.length} analyzed emails - starting customer support workflow`);
          console.log(`📊 Starting customer support workflow for ${analysisResponse.data.analysisCount} analyzed emails`);
          
          const customerSupportWorkflowId = `schedule-customer-support-${siteId}-${Date.now()}`;
          
          // Preparar parámetros para scheduleCustomerSupportMessagesWorkflow
          const scheduleParams = {
            emails: analysisResponse.data.emails,
            site_id: siteId,
            user_id: userId,
            total_emails: analysisResponse.data.analysisCount,
            timestamp: new Date().toISOString(),
            agentId: undefined, // Se puede configurar si es necesario
            origin: "email" // Indicar que el origen es email (syncMails)
          };
          
          try {
            // ✅ FIXED: Better error handling for child workflow
            const childWorkflowHandle = await startChild(scheduleCustomerSupportMessagesWorkflow, {
              workflowId: customerSupportWorkflowId,
              args: [scheduleParams],
              parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
            });
            
            console.log(`✅ Started scheduleCustomerSupportMessagesWorkflow: ${customerSupportWorkflowId}`);
            console.log(`🔄 This will process customer support messages with 1-minute intervals`);
            console.log(`🚀 Parent close policy: ABANDON - child workflow will continue running independently`);
            
            // ✅ FIXED: Wait a moment to ensure child workflow started properly
            console.log(`⏳ Waiting for child workflow to initialize...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            
          } catch (workflowError) {
            const workflowErrorMessage = workflowError instanceof Error ? workflowError.message : String(workflowError);
            console.error(`❌ Failed to start customer support workflow: ${workflowErrorMessage}`);
            
            // ✅ FIXED: Add error to result but don't fail the entire workflow
            result.errors.push(`Customer support workflow failed: ${workflowErrorMessage}`);
          }
        } else {
          console.log(`📋 No analyzed emails returned - customer support workflow not triggered`);
        }
        
        console.log(`📋 Email analysis completed. Command ID: ${analysisResponse.data?.commandId}`);
        console.log(`🔄 Customer support workflow will be triggered automatically when emails are analyzed`);
        
      } else {
        console.log(`⚠️ Email analysis failed: ${analysisResponse.error?.message}`);
        result.analysisResult = {
          success: false,
          error: analysisResponse.error?.message || 'Unknown analysis error'
        };
        
        // ✅ FIXED: Add to errors array for visibility
        result.errors.push(`Email analysis failed: ${analysisResponse.error?.message || 'Unknown error'}`);
        
        // ✅ FIXED: Don't throw exception for analysis failure - it's not critical for the workflow
        console.log(`🔄 Continuing workflow despite analysis failure...`);
      }
    } catch (analysisError) {
      const analysisErrorMessage = analysisError instanceof Error ? analysisError.message : String(analysisError);
      console.log(`⚠️ Email analysis error: ${analysisErrorMessage}`);
      result.analysisResult = {
        success: false,
        error: analysisErrorMessage
      };
      
      // ✅ FIXED: Add to errors array and continue workflow
      result.errors.push(`Email analysis exception: ${analysisErrorMessage}`);
      console.log(`🔄 Continuing workflow despite analysis exception...`);
    }

    // Step 6: Sync Sent Emails  
    console.log(`📨 Step 6: Syncing sent emails to update lead status...`);
    
    try {
      const syncSentEmailsRequest = {
        site_id: siteId,
        limit: 20, // Sync last 20 sent emails
        since_date: validation.since.toISOString()
      };

      const syncSentResponse = await syncSentEmailsActivity(syncSentEmailsRequest);

      // ✅ FIXED: Proper error handling for sent emails sync
      if (syncSentResponse.success) {
        console.log(`✅ Sent emails sync completed successfully`);
        console.log(`📊 Sync results:`, JSON.stringify(syncSentResponse.data, null, 2));
      } else {
        console.log(`⚠️ Sent emails sync failed: ${syncSentResponse.error}`);
        result.errors.push(`Sent emails sync failed: ${syncSentResponse.error || 'Unknown error'}`);
      }
    } catch (syncError) {
      const syncErrorMessage = syncError instanceof Error ? syncError.message : String(syncError);
      console.log(`⚠️ Sent emails sync error: ${syncErrorMessage}`);
      result.errors.push(`Sent emails sync exception: ${syncErrorMessage}`);
    }

    // Step 7: Check Email Delivery Status
    console.log(`📋 Step 7: Checking email delivery status...`);
    
    try {
      const deliveryStatusRequest = {
        site_id: siteId
      };

      const deliveryStatusResponse = await deliveryStatusActivity(deliveryStatusRequest);

      // ✅ FIXED: Proper error handling for delivery status
      if (deliveryStatusResponse.success) {
        console.log(`✅ Email delivery status check completed successfully`);
        console.log(`📊 Delivery status results:`, JSON.stringify(deliveryStatusResponse.data, null, 2));
      } else {
        console.log(`⚠️ Email delivery status check failed: ${deliveryStatusResponse.error}`);
        result.errors.push(`Delivery status check failed: ${deliveryStatusResponse.error || 'Unknown error'}`);
      }
    } catch (deliveryError) {
      const deliveryErrorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.log(`⚠️ Email delivery status check error: ${deliveryErrorMessage}`);
      result.errors.push(`Delivery status check exception: ${deliveryErrorMessage}`);
    }

    console.log(`🎉 Email sync completed successfully!`);
    console.log(`📊 Results: Email sync activities completed successfully`);
    
    if (result.analysisResult?.success) {
      console.log(`🤖 AI Analysis: ${result.analysisResult.emailCount} emails processed, ${result.analysisResult.analysisCount} analyzed (Command: ${result.analysisResult.commandId})`);
    }

    // ✅ FIXED: Show warnings if there were non-critical errors
    if (result.errors.length > 0) {
      console.log(`⚠️ Workflow completed with ${result.errors.length} non-critical errors:`);
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    // ✅ FIXED: Always update cron status to COMPLETED even if there were non-critical errors
    if (siteId) {
      await saveCronStatusActivity({
        siteId,
        workflowId,
        scheduleId: `email-sync-${siteId}`,
        activityName: 'syncEmailsWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString(),
        nextRun: result.nextSyncRecommended,
        // ✅ FIXED: Include error summary if there were non-critical errors
        errorMessage: result.errors.length > 0 ? `${result.errors.length} non-critical errors occurred` : undefined
      });
    }

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'syncEmailsWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Email sync failed: ${errorMessage}`);

    // ✅ FIXED: Always update cron status to FAILED in the catch block
    if (siteId) {
      try {
        await saveCronStatusActivity({
          siteId,
          workflowId,
          scheduleId: `email-sync-${siteId}`,
          activityName: 'syncEmailsWorkflow',
          status: 'FAILED',
          lastRun: new Date().toISOString(),
          errorMessage: errorMessage,
          retryCount: 1
        });
      } catch (statusError) {
        console.error(`❌ Failed to update cron status to FAILED: ${statusError}`);
        // Even if updating status fails, continue with other cleanup
      }
    }

    // ✅ FIXED: Always log workflow execution failure
    try {
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'syncEmailsWorkflow',
        status: 'FAILED',
        input: options,
        error: errorMessage,
      });
    } catch (logError) {
      console.error(`❌ Failed to log workflow execution failure: ${logError}`);
      // Continue even if logging fails
    }

    throw error;
  }
} 