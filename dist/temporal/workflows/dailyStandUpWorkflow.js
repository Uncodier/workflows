"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyStandUpWorkflow = dailyStandUpWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, validateAndCleanStuckCronStatusActivity, cmoWrapUpActivity, sendDailyStandUpNotificationActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes', // Extended timeout for CMO analysis operations
    retry: {
        maximumAttempts: 3,
    },
});
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
async function dailyStandUpWorkflow(options) {
    const { site_id } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
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
    // Validate and clean any stuck cron status records before execution
    console.log('🔍 Validating cron status before daily standup execution...');
    const cronValidation = await validateAndCleanStuckCronStatusActivity('dailyStandUpWorkflow', site_id, 24 // 24 hours threshold - daily standups should not be stuck longer than 24h
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
    const errors = [];
    let wrapUpResult = null;
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
        }
        else {
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
        // Send daily stand up notification - REQUIRED if wrapUpResult includes subject/message
        if (!wrapUpResult.subject || !wrapUpResult.message) {
            const errorMsg = 'Wrap up result must include subject and message for notification - workflow failed';
            console.error(`❌ ${errorMsg}`);
            errors.push(`Notification: ${errorMsg}`);
            throw new Error(errorMsg);
        }
        console.log(`📧 Sending daily stand up notification...`);
        await sendDailyStandUpNotificationActivity({
            site_id: site_id,
            subject: wrapUpResult.subject,
            message: wrapUpResult.message,
            health: wrapUpResult.health
        });
        console.log(`✅ Daily stand up notification sent successfully`);
        executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
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
    }
    catch (error) {
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
