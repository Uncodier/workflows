import { proxyActivities, sleep, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { humanInterventionWorkflow } from './humanInterventionWorkflow';
import { parseAgentResponse } from '../utils/agentResponseParser';

// Define the activity interface and options
const { 
  callRobotPlanActActivity,
  callRobotPlanActivity,
  callRobotAuthActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

export interface RobotWorkflowInput {
  site_id: string;
  activity: string;
  instance_id: string;
  instance_plan_id?: string;
  user_id?: string;
}

export interface RobotWorkflowResult {
  success: boolean;
  instance_id: string;
  instance_plan_id?: string;
  planResults?: {
    cycle: number;
    step?: {
      id: string;
      order: number;
      title: string;
      status: string;
      result?: string;
    };
    plan_progress?: {
      completed_steps: number;
      total_steps: number;
      percentage: number;
    };
    message?: string;
    execution_time_ms?: number;
    steps_executed?: number;
    token_usage?: {
      input_tokens: number;
      output_tokens: number;
    };
    remote_instance_id?: string;
    // Estados originales
    is_blocked?: boolean;
    waiting_for_session?: boolean;
    requires_continuation?: boolean;
    // Nuevos estados según documentación v2
    plan_completed?: boolean;
    plan_failed?: boolean;
    failure_reason?: string;
    new_plan_required?: boolean;
    new_session?: boolean;
    new_session_info?: any;
    session_needed?: boolean;
    session_request?: any;
    user_attention_required?: boolean;
    user_attention_info?: any;
    waiting_for_user?: boolean;
    // Respuesta cruda del agente para parsing
    agent_response?: string;
    response_type?: 'step_completed' | 'step_failed' | 'step_canceled' | 'plan_failed' | 'new_plan' | 'new_session' | 'session_needed' | 'user_attention';
    timestamp: string;
  }[];
  totalPlanCycles?: number;
  finalProgress?: {
    completed_steps: number;
    total_steps: number;
    percentage: number;
  };
  totalExecutionTime?: number;
  totalTokenUsage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: string;
  site_id: string;
  activity: string;
  user_id?: string;
  executedAt: string;
}



/**
 * Workflow to execute robot plan in a loop until completion
 * 
 * This workflow continuously calls the robot plan act API until plan_completed is true:
 * - POST /api/robots/plan/act - Executes robot plan actions in a loop
 * - Waits 30 seconds between each API call to avoid overwhelming the external service
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
export async function robotWorkflow(input: RobotWorkflowInput): Promise<RobotWorkflowResult> {
  const { site_id, activity, instance_id, instance_plan_id, user_id } = input;
  
  console.log(`🤖 Starting robot execution workflow for site: ${site_id}, activity: ${activity}, instance: ${instance_id}${instance_plan_id ? `, plan: ${instance_plan_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);

  try {
    // Prepare activity parameters
    const planParams: any = {
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

    const planResults: any[] = [];
    let totalPlanCycles = 0;
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
        const parsedResponse = parseAgentResponse(agentResponse);

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
          user_attention_required: planResult.data?.user_attention_required,
          user_attention_info: planResult.data?.user_attention_info,
          waiting_for_user: planResult.data?.waiting_for_user,
          // Datos de parsing
          agent_response: agentResponse,
          response_type: parsedResponse.type,
          timestamp: new Date().toISOString()
        };
        
        planResults.push(stepData);
        
        // Determinar estado del plan según respuesta parseada y API
        planCompleted = stepData.plan_completed ?? false;
        
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
            await startChild(humanInterventionWorkflow, {
              args: [{
                conversationId: `robot-plan-${instance_id}-${totalPlanCycles}`,
                message: `Robot plan failed: ${parsedResponse.reason}. Instance: ${instance_id}, Site: ${site_id}, Activity: ${activity}`,
                user_id: user_id || 'system',
                agentId: 'robot-agent',
                conversation_title: `Robot Plan Failure - ${activity}`,
                site_id,
                origin: 'whatsapp' as const
              }],
              workflowId: `human-intervention-robot-${instance_id}-${Date.now()}`,
              taskQueue: 'default'
            });
            console.log(`✅ Human intervention workflow triggered for plan failure`);
          } catch (interventionError) {
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
            } else {
              console.error(`❌ Failed to create new plan: ${newPlanResult.error}`);
              planFailed = true;
              break;
            }
          } catch (newPlanError) {
            console.error(`❌ Error creating new plan: ${newPlanError}`);
            planFailed = true;
            break;
          }
        }
        else if (parsedResponse.type === 'new_session') {
          console.log(`🔐 New session acquired for ${parsedResponse.platform}, saving authentication...`);
          try {
            await callRobotAuthActivity({
              instance_id,
              name: parsedResponse.platform || 'unknown-platform',
              domain: stepData.new_session_info?.domain || 'unknown-domain'
            });
            console.log(`✅ Authentication session saved for ${parsedResponse.platform}`);
          } catch (authError) {
            console.error(`❌ Failed to save authentication session: ${authError}`);
            // No fallar el plan por esto, solo loguear
          }
        }
        else if (parsedResponse.type === 'session_needed') {
          console.log(`🔑 Session needed for ${parsedResponse.platform}${parsedResponse.domain ? ` (${parsedResponse.domain})` : ''}`);
          // El API debería pausar automáticamente hasta que el usuario proporcione la sesión
        }
        else if (parsedResponse.type === 'user_attention') {
          console.log(`👤 User attention required: ${parsedResponse.explanation}`);
          
          if (userAttentionRetries < maxUserAttentionRetries) {
            console.log(`⏳ Waiting 5 minutes before retry (attempt ${userAttentionRetries + 1}/${maxUserAttentionRetries})...`);
            await sleep('5m');
            userAttentionRetries++;
            console.log(`🔄 Retrying after user attention wait...`);
            // Continúa el loop para hacer retry
          } else {
            console.log(`⚠️ Maximum user attention retries reached, triggering human intervention...`);
            
            try {
              await startChild(humanInterventionWorkflow, {
                args: [{
                  conversationId: `robot-attention-${instance_id}-${totalPlanCycles}`,
                  message: `Robot requires human attention: ${parsedResponse.explanation}. Instance: ${instance_id}, Site: ${site_id}, Activity: ${activity}`,
                  user_id: user_id || 'system',
                  agentId: 'robot-agent',
                  conversation_title: `Robot Attention Required - ${activity}`,
                  site_id,
                  origin: 'whatsapp' as const
                }],
                workflowId: `human-intervention-attention-${instance_id}-${Date.now()}`,
                taskQueue: 'default'
              });
              console.log(`✅ Human intervention workflow triggered for persistent user attention`);
            } catch (interventionError) {
              console.error(`❌ Failed to trigger human intervention: ${interventionError}`);
            }
            
            planFailed = true;
            break;
          }
        }
        else if (parsedResponse.type === 'step_completed') {
          console.log(`✅ Step ${parsedResponse.stepNumber || 'unknown'} completed successfully`);
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
          if (parsedResponse.type === 'step_completed') {
            console.log(`🚀 Step completed successfully, proceeding immediately to next step...`);
          } else {
            // Solo esperar si no fue un step completado exitosamente
            console.log(`⏱️ Waiting 30 seconds before next API call...`);
            await sleep('30s');
            console.log(`✅ Wait completed, proceeding to next cycle`);
          }
        }

        // Update instance_plan_id if returned from the API (for first call)
        if (planResult.instance_plan_id && !instance_plan_id) {
          planParams.instance_plan_id = planResult.instance_plan_id;
          console.log(`🆔 Instance plan ID updated: ${planResult.instance_plan_id}`);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Robot plan act exception on cycle ${totalPlanCycles} for site ${site_id}:`, errorMessage);
        
        throw new Error(`Plan act exception on cycle ${totalPlanCycles}: ${errorMessage}`);
      }
    }

    if (totalPlanCycles >= maxCycles) {
      console.warn(`⚠️ Robot plan act execution loop reached maximum cycles (${maxCycles}) for site ${site_id}`);
      
      throw new Error(`Plan act execution loop reached maximum cycles (${maxCycles})`);
    }

    if (planFailed) {
      console.error(`❌ Robot plan execution failed for site ${site_id}`);
      
      throw new Error('Plan execution failed - check planResults for details');
    }

    console.log(`✅ Robot execution workflow completed successfully for site: ${site_id}. Total plan act cycles: ${totalPlanCycles}`);

    // Calculate aggregate metrics
    const totalExecutionTime = planResults.reduce((sum, result) => sum + (result.execution_time_ms || 0), 0);
    const totalTokenUsage = planResults.reduce((acc, result) => {
      if (result.token_usage) {
        acc.input_tokens += result.token_usage.input_tokens || 0;
        acc.output_tokens += result.token_usage.output_tokens || 0;
      }
      return acc;
    }, { input_tokens: 0, output_tokens: 0 });
    
    // Get final progress from last result
    const finalProgress = planResults.length > 0 ? planResults[planResults.length - 1].plan_progress : undefined;
    
    console.log(`📊 Final metrics: ${totalExecutionTime}ms total, ${totalTokenUsage.input_tokens + totalTokenUsage.output_tokens} tokens used`);

    return {
      success: true,
      instance_id,
      instance_plan_id: instance_plan_id || planParams.instance_plan_id,
      planResults,
      totalPlanCycles,
      finalProgress,
      totalExecutionTime,
      totalTokenUsage,
      site_id,
      activity,
      user_id,
      executedAt: new Date().toISOString()
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Robot execution workflow exception for site ${site_id}:`, errorMessage);

    throw new Error(`Robot execution workflow failed: ${errorMessage}`);
  }
}
