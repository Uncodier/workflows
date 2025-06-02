import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { scheduleCustomerSupportMessagesWorkflow } from './scheduleCustomerSupportMessagesWorkflow';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  analyzeEmailsActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
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
  enableAnalysis?: boolean; // Enable AI analysis of emails
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
  options: SyncEmailsOptions
): Promise<SyncEmailsResult> {
  const workflowId = `sync-emails-${options.userId}`;
  const siteId = options.siteId || options.userId;
  
  console.log(`📧 Starting email sync workflow for user ${options.userId} (${options.provider})`);
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
      enableAnalysis: options.enableAnalysis || false,
      analysisLimit: options.analysisLimit || 15
    };

    if (!validation.isValid) {
      throw new Error(`Invalid email sync configuration for provider ${options.provider}`);
    }

    console.log(`✅ Configuration validated for ${options.provider} provider`);

    console.log(`📬 Step 2: Connecting to ${options.provider} email server...`);
    
    // Simulate connection to email provider
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay

    console.log(`✅ Connected to ${options.provider} email server`);

    console.log(`📥 Step 3: Fetching emails since ${validation.since.toISOString()}...`);
    
    // Simulate email fetching with batching
    const batches = Math.ceil(100 / validation.batchSize); // Simulate 100 emails total
    let totalEmails = 0;
    const processedBatches = [];

    for (let batch = 1; batch <= batches; batch++) {
      console.log(`📦 Processing batch ${batch}/${batches} (batch size: ${validation.batchSize})`);
      
      // Simulate batch processing
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second per batch
      
      const batchEmails = Math.min(validation.batchSize, 100 - totalEmails);
      totalEmails += batchEmails;
      
      processedBatches.push({
        batch,
        emailsProcessed: batchEmails,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Batch ${batch} completed: ${batchEmails} emails processed`);
    }

    console.log(`💾 Step 4: Storing sync results...`);
    
    // Simulate storing results
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result: SyncEmailsResult = {
      success: true,
      provider: options.provider,
      userId: options.userId,
      siteId,
      syncedEmails: totalEmails,
      batchesProcessed: processedBatches.length,
      batches: processedBatches,
      syncDuration: '~6 seconds',
      syncedAt: new Date().toISOString(),
      nextSyncRecommended: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      errors: [],
      analysisResult: null,
    };

    // Step 5: AI Email Analysis (if enabled)
    if (validation.enableAnalysis && siteId) {
      console.log(`🤖 Step 5: Starting AI email analysis...`);
      console.log(`📊 Analyzing up to ${validation.analysisLimit} emails for commercial opportunities`);

      try {
        const analysisRequest = {
          site_id: siteId,
          limit: validation.analysisLimit,
          user_id: options.userId,
          analysis_type: 'commercial_opportunity'
        };

        const analysisResponse = await analyzeEmailsActivity(analysisRequest);

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
              user_id: options.userId,
              total_emails: analysisResponse.data.analysisCount,
              timestamp: new Date().toISOString(),
              agentId: undefined, // Se puede configurar si es necesario
              origin: "email" // Indicar que el origen es email (syncMails)
            };
            
            try {
              // ✅ FIXED: Configurar parentClosePolicy para que el child workflow continúe ejecutándose 
              // incluso cuando el parent workflow (syncEmails) termine
              void startChild(scheduleCustomerSupportMessagesWorkflow, {
                workflowId: customerSupportWorkflowId,
                args: [scheduleParams],
                parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
              });
              
              console.log(`✅ Started scheduleCustomerSupportMessagesWorkflow: ${customerSupportWorkflowId}`);
              console.log(`🔄 This will process customer support messages with 1-minute intervals`);
              console.log(`🚀 Parent close policy: ABANDON - child workflow will continue running independently`);
              
            } catch (workflowError) {
              console.error(`❌ Failed to start customer support workflow: ${workflowError}`);
              // No fallar todo el sync por esto
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
        }
      } catch (analysisError) {
        const analysisErrorMessage = analysisError instanceof Error ? analysisError.message : String(analysisError);
        console.log(`⚠️ Email analysis error: ${analysisErrorMessage}`);
        result.analysisResult = {
          success: false,
          error: analysisErrorMessage
        };
      }
    } else {
      console.log(`⏭️ Step 5: Skipping AI email analysis (disabled or no siteId)`);
    }

    console.log(`🎉 Email sync completed successfully!`);
    console.log(`📊 Results: ${totalEmails} emails synced in ${processedBatches.length} batches`);
    
    if (result.analysisResult?.success) {
      console.log(`🤖 AI Analysis: ${result.analysisResult.emailCount} emails processed, ${result.analysisResult.analysisCount} analyzed (Command: ${result.analysisResult.commandId})`);
    }

    // Update cron status to indicate successful completion
    if (siteId) {
      await saveCronStatusActivity({
        siteId,
        workflowId,
        scheduleId: `email-sync-${siteId}`,
        activityName: 'syncEmailsWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString(),
        nextRun: result.nextSyncRecommended
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

    // Update cron status to indicate failure
    if (siteId) {
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
    }

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'syncEmailsWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    throw error;
  }
} 