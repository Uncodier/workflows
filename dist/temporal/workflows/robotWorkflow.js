"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.robotWorkflow = robotWorkflow;
const workflow_1 = require("@temporalio/workflow");
const humanInterventionWorkflow_1 = require("./humanInterventionWorkflow");
const agentResponseParser_1 = require("../utils/agentResponseParser");
// Define the activity interface and options
const { callRobotPlanActActivity, callRobotPlanActivity, callRobotAuthActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        maximumInterval: '30s',
    },
});
/**
 * Workflow to execute robot plan in a loop until completion
 *
 * This workflow continuously calls the robot plan act API until plan_completed is true:
 * - POST /api/robots/plan/act - Executes robot plan actions in a loop
 * - Waits 3 seconds between each API call (when no error or human intervention is required)
 * - Maneja nuevos tipos de respuestas según documentación v2
 * - Implementa lógica de retry para user attention required
 * - Llama human intervention workflow cuando sea necesario
 * - Crea nuevos planes cuando se requiera
 * - Guarda nuevas sesiones de autenticación
 *
 * Input requires: site_id, activity, instance_id, and optionally instance_plan_id and user_id
 *
 * The workflow will continue calling the plan act API until the response contains plan_completed: true
 */
/**
 * Helper function to ensure workflow always completes with proper cleanup and logging
 */
function finalizeWorkflow(success, reason, input, planResults, totalPlanCycles, planParams) {
    const { site_id, activity, instance_id, user_id } = input;
    // Calculate aggregate metrics
    const totalExecutionTime = planResults.reduce((sum, result) => sum + (result.execution_time_ms || 0), 0);
    const totalTokenUsage = planResults.reduce((acc, result) => {
        if (result.token_usage) {
            acc.input_tokens += result.token_usage.input_tokens || 0;
            acc.output_tokens += result.token_usage.output_tokens || 0;
        }
        return acc;
    }, { input_tokens: 0, output_tokens: 0 });
    const finalProgress = planResults.length > 0 ? planResults[planResults.length - 1].plan_progress : undefined;
    // Log final state
    console.log(`📊 Workflow finalization - State: ${success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`📝 Reason: ${reason}`);
    console.log(`🔢 Total cycles: ${totalPlanCycles}`);
    console.log(`⏱️ Total execution time: ${totalExecutionTime}ms`);
    console.log(`🎯 Token usage: ${totalTokenUsage.input_tokens + totalTokenUsage.output_tokens} total`);
    console.log(`📈 Final progress: ${finalProgress?.completed_steps || 0}/${finalProgress?.total_steps || 0} (${finalProgress?.percentage || 0}%)`);
    console.log(`🏁 Workflow ${success ? 'completed successfully' : 'terminated with failure'} at ${new Date().toISOString()}`);
    return {
        success,
        instance_id,
        instance_plan_id: input.instance_plan_id || planParams?.instance_plan_id,
        planResults,
        totalPlanCycles,
        finalProgress,
        totalExecutionTime,
        totalTokenUsage,
        error: success ? undefined : reason,
        site_id,
        activity,
        user_id,
        executedAt: new Date().toISOString()
    };
}
async function robotWorkflow(input) {
    const { site_id, activity, instance_id, instance_plan_id, user_id } = input;
    console.log(`🤖 Starting robot execution workflow for site: ${site_id}, activity: ${activity}, instance: ${instance_id}${instance_plan_id ? `, plan: ${instance_plan_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);
    // Declare variables outside try-catch for error handling scope
    const planResults = [];
    let totalPlanCycles = 0;
    let planParams = {};
    try {
        // Prepare activity parameters
        planParams = {
            site_id,
            activity,
            instance_id
        };
        if (instance_plan_id) {
            planParams.instance_plan_id = instance_plan_id;
        }
        if (user_id) {
            planParams.user_id = user_id;
        }
        let planCompleted = false;
        let planFailed = false;
        let userAttentionRetries = 0; // Contador de reintentos para user attention
        const maxCycles = 100; // Safety limit to prevent infinite loops
        const maxUserAttentionRetries = 1; // Máximo 1 retry antes de human intervention
        console.log(`🔄 Starting robot plan execution loop with v2 response handling...`);
        while (!planCompleted && !planFailed && totalPlanCycles < maxCycles) {
            totalPlanCycles++;
            console.log(`🔃 Robot plan execution cycle ${totalPlanCycles} for site ${site_id}...`);
            try {
                const planResult = await callRobotPlanActActivity(planParams);
                if (!planResult.success) {
                    console.error(`❌ Robot plan act call failed for site ${site_id} on cycle ${totalPlanCycles}:`, planResult.error);
                    throw new Error(`Plan act call failed on cycle ${totalPlanCycles}: ${planResult.error}`);
                }
                // Parse agent response según documentación v2
                const agentResponse = planResult.data?.agent_response || planResult.data?.message || '';
                const parsedResponse = (0, agentResponseParser_1.parseAgentResponse)(agentResponse);
                // Extract and structure important data from the response
                const stepData = {
                    cycle: totalPlanCycles,
                    step: planResult.data?.step,
                    plan_progress: planResult.data?.plan_progress,
                    message: planResult.data?.message,
                    execution_time_ms: planResult.data?.execution_time_ms,
                    steps_executed: planResult.data?.steps_executed,
                    token_usage: planResult.data?.token_usage,
                    remote_instance_id: planResult.data?.remote_instance_id,
                    // Estados originales
                    is_blocked: planResult.data?.is_blocked,
                    waiting_for_session: planResult.data?.waiting_for_session,
                    requires_continuation: planResult.data?.requires_continuation,
                    // Nuevos estados v2
                    plan_completed: planResult.plan_completed || planResult.data?.plan_completed,
                    plan_failed: planResult.data?.plan_failed,
                    failure_reason: planResult.data?.failure_reason || parsedResponse.reason,
                    new_plan_required: planResult.data?.new_plan_required,
                    new_session: planResult.data?.new_session,
                    new_session_info: planResult.data?.new_session_info,
                    session_needed: planResult.data?.session_needed,
                    session_request: planResult.data?.session_request,
                    session_saved: planResult.data?.session_saved,
                    session_save_info: planResult.data?.session_save_info,
                    user_attention_required: planResult.data?.user_attention_required,
                    user_attention_info: planResult.data?.user_attention_info,
                    waiting_for_user: planResult.data?.waiting_for_user,
                    instance_status: planResult.data?.instance_status,
                    // Nuevos campos para instancia pausada
                    instance_paused: planResult.data?.instance_paused,
                    waiting_for_instructions: planResult.data?.waiting_for_instructions,
                    can_resume: planResult.data?.can_resume,
                    // Datos de parsing
                    agent_response: agentResponse,
                    response_type: parsedResponse.type,
                    timestamp: new Date().toISOString()
                };
                planResults.push(stepData);
                // Determinar estado del plan según respuesta parseada y API
                planCompleted = stepData.plan_completed ?? false;
                planFailed = stepData.plan_failed ?? false;
                // Si el plan falló, verificar si es por instancia apagada y terminar inmediatamente
                if (planFailed) {
                    const instanceStatus = planResult.data?.instance_status;
                    const failureReason = stepData.failure_reason || planResult.data?.failure_reason;
                    console.log(`💥 Plan failed detected. Reason: ${failureReason}`);
                    console.log(`🔍 Instance status: ${instanceStatus || 'unknown'}`);
                    console.log(`📊 Current progress: ${stepData.plan_progress?.completed_steps || 0}/${stepData.plan_progress?.total_steps || 0} (${stepData.plan_progress?.percentage || 0}%)`);
                    if (instanceStatus === 'stopped') {
                        console.log(`🛑 Instance is stopped (${instanceStatus}), terminating workflow immediately`);
                        break; // Salir del loop inmediatamente
                    }
                    else {
                        console.log(`⚠️ Plan failed but instance status is: ${instanceStatus || 'unknown'}, will process failure handling`);
                    }
                }
                // Verificar si la instancia está pausada y esperando instrucciones para terminar el flujo
                if (planResult.data?.instance_paused === true && planResult.data?.waiting_for_instructions === true) {
                    console.log(`⏸️ Instance is paused and waiting for instructions`);
                    console.log(`📝 Message: ${planResult.data?.message || 'Instance is paused. Provide a new prompt to resume.'}`);
                    console.log(`🛑 Terminating workflow as instance requires manual intervention`);
                    // Marcar el plan como fallido por pausa de instancia
                    planFailed = true;
                    stepData.plan_failed = true;
                    stepData.failure_reason = 'Instance paused and waiting for instructions - manual intervention required';
                    stepData.response_type = 'plan_failed';
                    break; // Salir del loop inmediatamente
                }
                // Si no hay plan_completed explícito, verificar si es una respuesta de step completado final
                if (!planCompleted && parsedResponse.type === 'step_completed' && stepData.plan_progress?.percentage === 100) {
                    planCompleted = true;
                    console.log(`✅ Plan marcado como completado por step finished con 100% de progreso`);
                }
                console.log(`📊 Cycle ${totalPlanCycles} completed. Plan completed: ${planCompleted}`);
                console.log(`🔍 Response type detected: ${parsedResponse.type}`);
                // Log progress if available
                if (planResult.data?.plan_progress) {
                    const progress = planResult.data.plan_progress;
                    console.log(`📈 Progress: ${progress.completed_steps}/${progress.total_steps} (${progress.percentage}%)`);
                }
                // Log current step if available
                if (planResult.data?.step) {
                    const step = planResult.data.step;
                    console.log(`🔧 Step: ${step.title} (${step.status}) - ${step.result || 'In progress'}`);
                }
                // Log execution metrics
                if (planResult.data?.execution_time_ms) {
                    console.log(`⏱️ Execution time: ${planResult.data.execution_time_ms}ms`);
                }
                // Manejo específico según tipo de respuesta v2
                if (parsedResponse.type === 'plan_failed') {
                    console.log(`💥 Plan failed: ${parsedResponse.reason}`);
                    planFailed = true;
                    // Llamar human intervention workflow
                    console.log(`👤 Triggering human intervention workflow due to plan failure...`);
                    try {
                        await (0, workflow_1.startChild)(humanInterventionWorkflow_1.humanInterventionWorkflow, {
                            args: [{
                                    conversationId: `robot-plan-${instance_id}-${totalPlanCycles}`,
                                    message: `Robot plan failed: ${parsedResponse.reason}. Instance: ${instance_id}, Site: ${site_id}, Activity: ${activity}`,
                                    user_id: user_id || 'system',
                                    agentId: 'robot-agent',
                                    conversation_title: `Robot Plan Failure - ${activity}`,
                                    site_id,
                                    origin: 'whatsapp'
                                }],
                            workflowId: `human-intervention-robot-${instance_id}-${Date.now()}`,
                            taskQueue: 'default'
                        });
                        console.log(`✅ Human intervention workflow triggered for plan failure`);
                    }
                    catch (interventionError) {
                        console.error(`❌ Failed to trigger human intervention: ${interventionError}`);
                    }
                    break; // Salir del loop
                }
                else if (parsedResponse.type === 'new_plan') {
                    console.log(`🔄 New plan required, calling growth/robot/plan with error context...`);
                    try {
                        // Crear contexto del error para el nuevo plan
                        const errorContext = {
                            previous_plan_id: instance_plan_id,
                            error_cycle: totalPlanCycles,
                            error_reason: 'Plan requires replacement',
                            previous_results: planResults.slice(-3) // Últimos 3 resultados para contexto
                        };
                        const newPlanResult = await callRobotPlanActivity({
                            site_id,
                            activity,
                            instance_id,
                            user_id,
                            error_context: JSON.stringify(errorContext)
                        });
                        if (newPlanResult.success && newPlanResult.instance_plan_id) {
                            planParams.instance_plan_id = newPlanResult.instance_plan_id;
                            console.log(`✅ New plan created with ID: ${newPlanResult.instance_plan_id}`);
                            // Reset contadores de retry
                            userAttentionRetries = 0;
                        }
                        else {
                            console.error(`❌ Failed to create new plan: ${newPlanResult.error}`);
                            planFailed = true;
                            break;
                        }
                    }
                    catch (newPlanError) {
                        console.error(`❌ Error creating new plan: ${newPlanError}`);
                        planFailed = true;
                        break;
                    }
                }
                else if (parsedResponse.type === 'new_session' || planResult.data?.new_session) {
                    console.log(`🔐 New session acquired, triggering session save...`);
                    console.log(`📋 Session info:`, stepData.new_session_info);
                    // El plan ya debería incluir automáticamente un paso de session_save después del login
                    // Solo logueamos que se detectó una nueva sesión
                    console.log(`✅ New session detected, continuing to next step (should be session_save)`);
                }
                else if (planResult.data?.session_saved) {
                    console.log(`💾 Session saved successfully`);
                    console.log(`📋 Session save info:`, planResult.data?.session_save_info);
                    if (planResult.data.session_save_info?.auth_session_id) {
                        console.log(`✅ Authentication session saved with ID: ${planResult.data.session_save_info.auth_session_id}`);
                    }
                }
                else if (parsedResponse.type === 'session_needed' || planResult.data?.session_needed) {
                    console.log(`🔑 Session needed detected`);
                    if (parsedResponse.platform) {
                        console.log(`Platform: ${parsedResponse.platform}${parsedResponse.domain ? `, Domain: ${parsedResponse.domain}` : ''}`);
                    }
                    console.log(`⏳ Waiting 5 minutes for user to provide session/login...`);
                    await (0, workflow_1.sleep)('5m');
                    // Después de 5 minutos, triggear human intervention
                    console.log(`⚠️ Session timeout reached, triggering human intervention...`);
                    try {
                        await (0, workflow_1.startChild)(humanInterventionWorkflow_1.humanInterventionWorkflow, {
                            args: [{
                                    conversationId: `robot-session-timeout-${instance_id}-${totalPlanCycles}`,
                                    message: `Robot requires session/login after 5-minute timeout. User failed to provide authentication. Instance: ${instance_id}, Site: ${site_id}, Activity: ${activity}`,
                                    user_id: user_id || 'system',
                                    agentId: 'robot-agent',
                                    conversation_title: `Session Required Timeout - ${activity}`,
                                    site_id,
                                    origin: 'whatsapp'
                                }],
                            workflowId: `human-intervention-session-timeout-${instance_id}-${Date.now()}`,
                            taskQueue: 'default'
                        });
                        console.log(`✅ Human intervention workflow triggered for session timeout`);
                    }
                    catch (interventionError) {
                        console.error(`❌ Failed to trigger human intervention: ${interventionError}`);
                    }
                    planFailed = true;
                    break;
                }
                else if (parsedResponse.type === 'user_attention') {
                    console.log(`👤 User attention required: ${parsedResponse.explanation}`);
                    // Verificar si es un paso de autenticación para aplicar timeout de 5 minutos
                    const isAuthStep = planResult.data?.step?.type === 'authentication';
                    if (isAuthStep) {
                        console.log(`🔐 Authentication step detected, applying 5-minute timeout before human intervention...`);
                        console.log(`⏳ Waiting 5 minutes for user authentication...`);
                        await (0, workflow_1.sleep)('5m');
                        // Después de 5 minutos, triggear human intervention para autenticación
                        console.log(`⚠️ Authentication timeout reached, triggering human intervention...`);
                        try {
                            await (0, workflow_1.startChild)(humanInterventionWorkflow_1.humanInterventionWorkflow, {
                                args: [{
                                        conversationId: `robot-auth-timeout-${instance_id}-${totalPlanCycles}`,
                                        message: `Robot authentication timed out after 5 minutes. User failed to complete login process. Instance: ${instance_id}, Site: ${site_id}, Activity: ${activity}`,
                                        user_id: user_id || 'system',
                                        agentId: 'robot-agent',
                                        conversation_title: `Authentication Timeout - ${activity}`,
                                        site_id,
                                        origin: 'whatsapp'
                                    }],
                                workflowId: `human-intervention-auth-timeout-${instance_id}-${Date.now()}`,
                                taskQueue: 'default'
                            });
                            console.log(`✅ Human intervention workflow triggered for authentication timeout`);
                        }
                        catch (interventionError) {
                            console.error(`❌ Failed to trigger human intervention: ${interventionError}`);
                        }
                        planFailed = true;
                        break;
                    }
                    else {
                        // Comportamiento normal para pasos no de autenticación
                        if (userAttentionRetries < maxUserAttentionRetries) {
                            console.log(`⏳ Waiting 5 minutes before retry (attempt ${userAttentionRetries + 1}/${maxUserAttentionRetries})...`);
                            await (0, workflow_1.sleep)('5m');
                            userAttentionRetries++;
                            console.log(`🔄 Retrying after user attention wait...`);
                            // Continúa el loop para hacer retry
                        }
                        else {
                            console.log(`⚠️ Maximum user attention retries reached, triggering human intervention...`);
                            try {
                                await (0, workflow_1.startChild)(humanInterventionWorkflow_1.humanInterventionWorkflow, {
                                    args: [{
                                            conversationId: `robot-attention-${instance_id}-${totalPlanCycles}`,
                                            message: `Robot requires human attention: ${parsedResponse.explanation}. Instance: ${instance_id}, Site: ${site_id}, Activity: ${activity}`,
                                            user_id: user_id || 'system',
                                            agentId: 'robot-agent',
                                            conversation_title: `Robot Attention Required - ${activity}`,
                                            site_id,
                                            origin: 'whatsapp'
                                        }],
                                    workflowId: `human-intervention-attention-${instance_id}-${Date.now()}`,
                                    taskQueue: 'default'
                                });
                                console.log(`✅ Human intervention workflow triggered for persistent user attention`);
                            }
                            catch (interventionError) {
                                console.error(`❌ Failed to trigger human intervention: ${interventionError}`);
                            }
                            planFailed = true;
                            break;
                        }
                    }
                }
                else if (parsedResponse.type === 'step_completed') {
                    console.log(`✅ Step ${parsedResponse.stepNumber || 'unknown'} completed successfully`);
                    // Verificar si este es un paso de session_save que necesita llamar la API
                    const currentStep = planResult.data?.step;
                    if (currentStep?.type === 'session_save') {
                        console.log(`💾 Executing session save step...`);
                        try {
                            // Obtener remote_instance_id del resultado del plan
                            const remote_instance_id = stepData.remote_instance_id;
                            if (remote_instance_id) {
                                await callRobotAuthActivity({
                                    remote_instance_id,
                                    site_id
                                });
                                console.log(`✅ Session save activity completed successfully`);
                            }
                            else {
                                console.error(`❌ No remote_instance_id available for session save`);
                            }
                        }
                        catch (authError) {
                            console.error(`❌ Failed to execute session save activity: ${authError}`);
                            // No fallar el plan completamente por esto, solo loguear
                        }
                    }
                    // Reset retry counter en caso de éxito
                    userAttentionRetries = 0;
                }
                else if (parsedResponse.type === 'step_failed') {
                    console.log(`❌ Step ${parsedResponse.stepNumber || 'unknown'} failed`);
                    // Reset retry counter
                    userAttentionRetries = 0;
                }
                else if (parsedResponse.type === 'step_canceled') {
                    console.log(`🚫 Step ${parsedResponse.stepNumber || 'unknown'} canceled`);
                    // Reset retry counter
                    userAttentionRetries = 0;
                }
                // Log any blocking conditions (estados originales)
                if (planResult.data?.is_blocked) {
                    console.log(`⚠️ Plan is blocked`);
                }
                if (planResult.data?.waiting_for_session) {
                    console.log(`⏳ Waiting for session`);
                }
                if (!planCompleted) {
                    console.log(`🔄 Plan not yet completed, continuing to next cycle...`);
                    // Si el step se completó exitosamente, continuar inmediatamente al siguiente step
                    // Always apply a small delay between cycles if there is no error or human intervention
                    console.log(`⏱️ Waiting 3 seconds before next plan/act call...`);
                    await (0, workflow_1.sleep)('3s');
                    console.log(`✅ Wait completed, proceeding to next cycle`);
                }
                // Update instance_plan_id if returned from the API (for first call)
                if (planResult.instance_plan_id && !instance_plan_id) {
                    planParams.instance_plan_id = planResult.instance_plan_id;
                    console.log(`🆔 Instance plan ID updated: ${planResult.instance_plan_id}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ Robot plan act exception on cycle ${totalPlanCycles} for site ${site_id}:`, errorMessage);
                console.log(`🔍 Error details - Cycle: ${totalPlanCycles}, Instance: ${instance_id}, Activity: ${activity}`);
                // Agregar información del error al planResults para trazabilidad
                const errorStepData = {
                    cycle: totalPlanCycles,
                    step: null,
                    plan_progress: null,
                    message: `Exception during plan act call: ${errorMessage}`,
                    execution_time_ms: 0,
                    steps_executed: 0,
                    token_usage: null,
                    remote_instance_id: null,
                    plan_completed: false,
                    plan_failed: true,
                    failure_reason: `Plan act exception on cycle ${totalPlanCycles}: ${errorMessage}`,
                    response_type: 'step_failed',
                    timestamp: new Date().toISOString()
                };
                planResults.push(errorStepData);
                planFailed = true;
                console.log(`📝 Error information added to planResults for traceability`);
                break; // Salir del loop en lugar de lanzar excepción
            }
        }
        if (totalPlanCycles >= maxCycles) {
            const failureReason = `Plan act execution loop reached maximum cycles (${maxCycles})`;
            return finalizeWorkflow(false, failureReason, input, planResults, totalPlanCycles, planParams);
        }
        if (planFailed) {
            const lastResult = planResults.length > 0 ? planResults[planResults.length - 1] : null;
            const failureReason = lastResult?.failure_reason || 'Plan execution failed - check planResults for details';
            return finalizeWorkflow(false, failureReason, input, planResults, totalPlanCycles, planParams);
        }
        return finalizeWorkflow(true, 'Plan completed successfully with all steps executed', input, planResults, totalPlanCycles, planParams);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Robot execution workflow exception for site ${site_id}:`, errorMessage);
        // Use la función de finalización incluso en casos de excepción
        return finalizeWorkflow(false, `Robot execution workflow failed: ${errorMessage}`, input, planResults, totalPlanCycles, planParams);
    }
}
