import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  validateAndCleanStuckCronStatusActivity,
  getSiteActivity,
  cmoSystemAnalysisActivity,
  cmoSalesAnalysisActivity,
  cmoSupportAnalysisActivity,
  cmoGrowthAnalysisActivity,
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

  const workflowId = `daily-standup-${site_id}-${Date.now()}`;
  const startTime = Date.now();
  
  // Extract scheduleId from additionalData.scheduleType (passed by scheduling activities)
  // Fallback to generic format if not provided
  const scheduleId = options.additionalData?.scheduleType || `daily-standup-${site_id}`;
  
  console.log(`🎯 Starting CMO daily stand up workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));
  console.log(`📋 Schedule ID: ${scheduleId} (from ${options.additionalData?.scheduleType ? 'scheduleType' : 'fallback'})`);

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
    
    const result: DailyStandUpResult = {
      success: false,
      siteId: site_id,
      errors: [`Workflow blocked: ${cronValidation.reason}`],
      executionTime: `${Date.now() - startTime}ms`,
      completedAt: new Date().toISOString()
    };

    // Log termination
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyStandUpWorkflow',
      status: 'BLOCKED',
      input: options,
      output: result,
    });

    return result;
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
  let siteName = '';
  let siteUrl = '';
  let systemAnalysisResult: any = null;
  let salesAnalysisResult: any = null;
  let supportAnalysisResult: any = null;
  let growthAnalysisResult: any = null;
  let wrapUpResult: any = null;
  let finalCommandId = '';
  let executionTime = '';

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information to obtain site details
    const siteResult = await getSiteActivity(site_id);
    
    if (!siteResult.success) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    // Prepare request object for all CMO activities
    const baseRequest = {
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: {
        ...options.additionalData,
        siteName: siteName,
        siteUrl: siteUrl,
        workflowId: workflowId
      }
    };

    // Step 2: CRITICAL - Execute system analysis first to get command_id
    console.log(`🔄 Step 2: Running system analysis (CRITICAL for command_id)...`);
    
    systemAnalysisResult = await cmoSystemAnalysisActivity(baseRequest);
    
    if (!systemAnalysisResult.success) {
      const errorMsg = `System analysis failed: ${systemAnalysisResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    if (!systemAnalysisResult.command_id) {
      const errorMsg = 'System analysis succeeded but did not return command_id - cannot continue workflow';
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    finalCommandId = systemAnalysisResult.command_id;
    console.log(`✅ System analysis completed with command_id: ${finalCommandId}`);

    if (options.runParallel) {
      console.log(`🚀 Step 3: Running remaining analyses in parallel with command_id: ${finalCommandId}...`);
      
      // Execute remaining analyses in parallel with shared command_id
      const [salesResult, supportResult, growthResult] = await Promise.allSettled([
        cmoSalesAnalysisActivity({ ...baseRequest, command_id: finalCommandId }),
        cmoSupportAnalysisActivity({ ...baseRequest, command_id: finalCommandId }),
        cmoGrowthAnalysisActivity({ ...baseRequest, command_id: finalCommandId })
      ]);

      // Process sales analysis result
      if (salesResult.status === 'fulfilled') {
        salesAnalysisResult = salesResult.value;
        if (salesAnalysisResult.success) {
          console.log(`✅ Sales analysis completed: ${salesAnalysisResult.command_id || 'no command_id'}`);
        } else {
          console.error(`❌ Sales analysis failed: ${salesAnalysisResult.error}`);
          errors.push(`Sales analysis: ${salesAnalysisResult.error}`);
        }
      } else {
        console.error(`❌ Sales analysis rejected: ${salesResult.reason}`);
        errors.push(`Sales analysis rejected: ${salesResult.reason}`);
      }

      // Process support analysis result
      if (supportResult.status === 'fulfilled') {
        supportAnalysisResult = supportResult.value;
        if (supportAnalysisResult.success) {
          console.log(`✅ Support analysis completed: ${supportAnalysisResult.command_id || 'no command_id'}`);
        } else {
          console.error(`❌ Support analysis failed: ${supportAnalysisResult.error}`);
          errors.push(`Support analysis: ${supportAnalysisResult.error}`);
        }
      } else {
        console.error(`❌ Support analysis rejected: ${supportResult.reason}`);
        errors.push(`Support analysis rejected: ${supportResult.reason}`);
      }

      // Process growth analysis result
      if (growthResult.status === 'fulfilled') {
        growthAnalysisResult = growthResult.value;
        if (growthAnalysisResult.success) {
          console.log(`✅ Growth analysis completed: ${growthAnalysisResult.command_id || 'no command_id'}`);
        } else {
          console.error(`❌ Growth analysis failed: ${growthAnalysisResult.error}`);
          errors.push(`Growth analysis: ${growthAnalysisResult.error}`);
        }
      } else {
        console.error(`❌ Growth analysis rejected: ${growthResult.reason}`);
        errors.push(`Growth analysis rejected: ${growthResult.reason}`);
      }

    } else {
      // Execute analyses sequentially
      console.log(`🔄 Step 3: Running sales analysis with command_id: ${finalCommandId}...`);
      salesAnalysisResult = await cmoSalesAnalysisActivity({
        ...baseRequest,
        command_id: finalCommandId
      });
      
      if (salesAnalysisResult.success) {
        console.log(`✅ Sales analysis completed: ${salesAnalysisResult.command_id || 'no command_id'}`);
      } else {
        console.error(`❌ Sales analysis failed: ${salesAnalysisResult.error}`);
        errors.push(`Sales analysis: ${salesAnalysisResult.error}`);
      }

      console.log(`🔄 Step 4: Running support analysis with command_id: ${finalCommandId}...`);
      supportAnalysisResult = await cmoSupportAnalysisActivity({
        ...baseRequest,
        command_id: finalCommandId
      });
      
      if (supportAnalysisResult.success) {
        console.log(`✅ Support analysis completed: ${supportAnalysisResult.command_id || 'no command_id'}`);
      } else {
        console.error(`❌ Support analysis failed: ${supportAnalysisResult.error}`);
        errors.push(`Support analysis: ${supportAnalysisResult.error}`);
      }

      console.log(`🔄 Step 5: Running growth analysis with command_id: ${finalCommandId}...`);
      growthAnalysisResult = await cmoGrowthAnalysisActivity({
        ...baseRequest,
        command_id: finalCommandId
      });
      
      if (growthAnalysisResult.success) {
        console.log(`✅ Growth analysis completed: ${growthAnalysisResult.command_id || 'no command_id'}`);
      } else {
        console.error(`❌ Growth analysis failed: ${growthAnalysisResult.error}`);
        errors.push(`Growth analysis: ${growthAnalysisResult.error}`);
      }
    }

    // Step Final: Execute wrap up with the command_id
    console.log(`🔄 Step Final: Running wrap up with command_id: ${finalCommandId}...`);
    
    wrapUpResult = await cmoWrapUpActivity({
      ...baseRequest,
      command_id: finalCommandId
    });
    
    if (wrapUpResult.success) {
      console.log(`✅ Wrap up completed successfully`);
      console.log(`📋 Final summary available: ${wrapUpResult.summary ? 'Yes' : 'No'}`);
      
      // Update final command_id if wrap up returned a new one
      if (wrapUpResult.command_id) {
        finalCommandId = wrapUpResult.command_id;
      }

      // Send daily stand up notification - REQUIRED step, fail if no subject/message
      if (!wrapUpResult.subject || !wrapUpResult.message) {
        const errorMsg = 'Wrap up result must include subject and message for notification - workflow failed';
        console.error(`❌ ${errorMsg}`);
        errors.push(`Notification: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log(`📧 Sending daily stand up notification...`);
      try {
        await sendDailyStandUpNotificationActivity({
          site_id: site_id,
          subject: wrapUpResult.subject,
          message: wrapUpResult.message,
          systemAnalysis: systemAnalysisResult
        });
        console.log(`✅ Daily stand up notification sent successfully`);
      } catch (notificationError) {
        const errorMsg = `CRITICAL: Failed to send daily stand up notification - workflow must fail: ${notificationError instanceof Error ? notificationError.message : String(notificationError)}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(`Notification: ${errorMsg}`);
        throw new Error(errorMsg); // FAIL the workflow if notification cannot be sent
      }
    } else {
      // CRITICAL: If wrap up fails, we cannot send notification - fail the workflow
      const errorMsg = `CRITICAL: Wrap up failed, cannot generate notification content - workflow must fail: ${wrapUpResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(`Wrap up: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // If we reach here, notification was sent successfully (or workflow would have failed)
    const notificationSent = true;
    executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    const result: DailyStandUpResult = {
      success: true, // If we reach here, system analysis succeeded and we have command_id
      siteId: site_id,
      siteName,
      siteUrl,
      command_id: finalCommandId,
      systemAnalysis: systemAnalysisResult,
      salesAnalysis: salesAnalysisResult,
      supportAnalysis: supportAnalysisResult,
      growthAnalysis: growthAnalysisResult,
      finalSummary: wrapUpResult?.summary,
      notificationSent,
      data: {
        system: systemAnalysisResult,
        sales: salesAnalysisResult,
        support: supportAnalysisResult,
        growth: growthAnalysisResult,
        wrapUp: wrapUpResult
      },
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 CMO daily stand up workflow completed successfully!`);
    console.log(`📊 Summary: Daily stand up for ${siteName} completed in ${executionTime}`);
    console.log(`   - Site: ${siteName} (${siteUrl})`);
    console.log(`   - Command ID: ${finalCommandId}`);
    console.log(`   - System analysis: ${systemAnalysisResult?.success ? 'Success' : 'Failed'}`);
    console.log(`   - Sales analysis: ${salesAnalysisResult?.success ? 'Success' : 'Failed'}`);
    console.log(`   - Support analysis: ${supportAnalysisResult?.success ? 'Success' : 'Failed'}`);
    console.log(`   - Growth analysis: ${growthAnalysisResult?.success ? 'Success' : 'Failed'}`);
    console.log(`   - Wrap up: ${wrapUpResult?.success ? 'Success' : 'Failed'}`);
    console.log(`   - Notification sent: ${notificationSent ? 'Yes' : 'No'}`);
    console.log(`   - Errors: ${errors.length}`);

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