import { proxyActivities, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  validateAndCleanStuckCronStatusActivity,
  validateWorkflowConfigActivity,
  cmoWrapUpActivity,
  sendDailyStandUpNotificationActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes', // Extended timeout for CMO analysis operations
  retry: {
    maximumAttempts: 3,
  },
});

export interface DailyStandUpOptions {
  site_id: string;                    // Required: Site ID
  userId?: string;
  additionalData?: any;
  runParallel?: boolean;              // Optional: run system, sales, support, growth in parallel
  // Wrap-up only mode: you can pass command id here instead of additionalData
  command_id?: string;
  commandId?: string;
}

export interface DailyStandUpResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  command_id?: string;               // Final command ID from wrap up
  systemAnalysis?: any;              // Results from system analysis
  salesAnalysis?: any;               // Results from sales analysis
  supportAnalysis?: any;             // Results from support analysis
  growthAnalysis?: any;              // Results from growth analysis
  finalSummary?: string;             // Final summary from wrap up
  notificationSent?: boolean;        // Whether notification was sent successfully
  data?: any;                        // All collected data
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to execute CMO daily stand up
 * 
 * Este workflow:
 * 1. Obtiene información del sitio
 * 2. Ejecuta análisis del sistema (settings, billing, aspectos básicos) - CRÍTICO: debe generar command_id
 * 3. Ejecuta análisis de ventas (resumen del agente de ventas)
 * 4. Ejecuta análisis de soporte (tareas y conversaciones recientes)
 * 5. Ejecuta análisis de crecimiento (contenidos y experimentos)
 * 6. Ejecuta wrap up (junta todas las memorias y hace resumen final)
 * 
 * IMPORTANTE: Si el system analysis falla o no genera command_id, el workflow falla
 * porque los análisis posteriores requieren continuidad de memoria.
 * 
 * Todas las etapas (excepto wrap up) pueden ejecutarse en paralelo si runParallel = true
 * 
 * @param options - Configuration options for daily stand up
 */
export async function dailyStandUpWorkflow(
  options: DailyStandUpOptions
): Promise<DailyStandUpResult> {
  const { site_id } = options;
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }

  const searchAttributes: Record<string, string[]> = {
    site_id: [site_id],
  };
  if (options.userId) {
    searchAttributes.user_id = [options.userId];
  }
  upsertSearchAttributes(searchAttributes);

  const workflowId = `daily-standup-${site_id}-${Date.now()}`;
  const startTime = Date.now();
  
  // Extract scheduleId - prioritize parent schedule ID from dailyOperations
  // Check if a parent schedule ID was passed through additionalData (from dailyOperationsWorkflow)
  const parentScheduleId = options.additionalData?.parentScheduleId || 
                          options.additionalData?.originalScheduleId ||
                          options.additionalData?.dailyOperationsScheduleId;
  
  const scheduleId = parentScheduleId || 
                    options.additionalData?.scheduleType || 
                    `daily-standup-${site_id}`;
  
  console.log(`🎯 Starting CMO daily stand up workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));
  const scheduleSource = parentScheduleId ? 'parent dailyOperations' : 
                       (options.additionalData?.scheduleType ? 'scheduleType' : 'fallback');
  console.log(`📋 Schedule ID: ${scheduleId} (from ${scheduleSource})`);

  // STEP 0: Validate workflow configuration
  console.log('🔐 Step 0: Validating workflow configuration...');
  const configValidation = await validateWorkflowConfigActivity(
    site_id,
    'daily_resume_and_stand_up'
  );
  
  if (!configValidation.shouldExecute) {
    console.log(`⛔ Workflow execution blocked: ${configValidation.reason}`);
    
    // Log blocked execution
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyStandUpWorkflow',
      status: 'BLOCKED',
      input: options,
      error: `Workflow is ${configValidation.activityStatus} in site settings`,
    });

    return {
      success: false,
      siteId: site_id,
      errors: [`Workflow is ${configValidation.activityStatus} in site settings`],
      executionTime: `${Date.now() - startTime}ms`,
      completedAt: new Date().toISOString(),
    };
  }
  
  console.log(`✅ Configuration validated: ${configValidation.reason}`);

  // Validate and clean any stuck cron status records before execution
  console.log('🔍 Validating cron status before daily standup execution...');
  
  const cronValidation = await validateAndCleanStuckCronStatusActivity(
    'dailyStandUpWorkflow',
    site_id,
    24 // 24 hours threshold - daily standups should not be stuck longer than 24h
  );
  
  console.log(`📋 Cron validation result: ${cronValidation.reason}`);
  if (cronValidation.wasStuck) {
    console.log(`🧹 Cleaned stuck record that was ${cronValidation.hoursStuck?.toFixed(1)}h old`);
  }
  
  if (!cronValidation.canProceed) {
    console.log('⏳ Another daily standup is likely running for this site - terminating');
    
    // Log termination
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyStandUpWorkflow',
      status: 'BLOCKED',
      input: options,
      error: `Workflow blocked: ${cronValidation.reason}`,
    });

    throw new Error(`Workflow blocked: ${cronValidation.reason}`);
  }

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'dailyStandUpWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: scheduleId,
    activityName: 'dailyStandUpWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let wrapUpResult: any = null;
  let finalCommandId = '';
  let executionTime = '';

  try {
    const baseRequest = {
      site_id: site_id,
      userId: options.userId,
      additionalData: {
        ...options.additionalData,
        workflowId: workflowId
      }
    };

    finalCommandId =
      options.command_id ||
      options.commandId ||
      options.additionalData?.command_id ||
      options.additionalData?.commandId;
    if (!finalCommandId) {
      console.log('ℹ️ No command_id provided. Proceeding with wrap-up using current context.');
    } else {
      console.log(`🔄 Running wrap up with provided command_id: ${finalCommandId}...`);
    }

    wrapUpResult = await cmoWrapUpActivity({
      ...baseRequest,
      command_id: finalCommandId
    });

    if (!wrapUpResult?.success) {
      const errorMsg = `Wrap up failed: ${wrapUpResult?.error || 'Unknown error'}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    // Prepare notification payload with safe fallbacks to avoid re-calling wrap-up
    const safeSubject = wrapUpResult.subject || `Daily Stand Up - Site ${site_id}`;
    const safeMessage = wrapUpResult.message || wrapUpResult.summary || 'No message generated by wrap-up. Please review the summary and health data.';

    if (!wrapUpResult.subject || !wrapUpResult.message) {
      const warnMsg = 'Wrap up result missing subject or message - using safe fallbacks for notification';
      console.warn(`⚠️ ${warnMsg}`);
      errors.push(`Notification: ${warnMsg}`);
    }

    console.log(`📧 Sending daily stand up notification...`);
    await sendDailyStandUpNotificationActivity({
      site_id: site_id,
      subject: safeSubject,
      message: safeMessage,
      health: wrapUpResult.health
    });
    console.log(`✅ Daily stand up notification sent successfully`);

    executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    const result: DailyStandUpResult = {
      success: true,
      siteId: site_id,
      command_id: finalCommandId,
      finalSummary: wrapUpResult?.summary,
      notificationSent: true,
      data: { wrapUp: wrapUpResult },
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: scheduleId,
      activityName: 'dailyStandUpWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyStandUpWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    console.log(`🎉 CMO daily stand up wrap up-only workflow completed successfully!`);
    console.log(`📊 Summary: Wrap up for site ${site_id} completed in ${executionTime}`);
    console.log(`   - Command ID: ${finalCommandId}`);
    console.log(`   - Wrap up: ${wrapUpResult?.success ? 'Success' : 'Failed'}`);
    console.log(`   - Errors: ${errors.length}`);

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ CMO daily stand up workflow failed: ${errorMessage}`);
    
    executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: scheduleId,
      activityName: 'dailyStandUpWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyStandUpWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // FAIL the workflow completely - do not return failed result, throw the error
    // The whole point of this workflow is to send the daily standup notification
    // If that fails, the workflow should fail, not succeed with a failure result
    throw error;
  }
} 