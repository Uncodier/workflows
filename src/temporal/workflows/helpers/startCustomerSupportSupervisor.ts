import { isCancellation, ParentClosePolicy, startChild } from '@temporalio/workflow';
import type { Activities } from '../../activities';
import { TASK_QUEUES } from '../../config/taskQueues';
import { agentSupervisorWorkflow } from '../agentSupervisorWorkflow';

type SupervisorActivities = Pick<Activities,
  'getSiteIdFromCommandOrConversationActivity' | 'validateWorkflowConfigActivity'>;

/** Shared post-response step. Callers supply their original activity proxies and site fallback. */
export async function startCustomerSupportSupervisor(
  responseData: any,
  fallbackSiteId: string | undefined,
  activities: SupervisorActivities,
  propagateCancellation: boolean,
): Promise<void> {
  try {
    const commandId = responseData?.command_id;
    const conversationId = responseData?.conversation_id;
    if (commandId || conversationId) {
      let siteIdForValidation = fallbackSiteId;
      if (!siteIdForValidation) {
        const siteIdResult = await activities.getSiteIdFromCommandOrConversationActivity({
          command_id: commandId,
          conversation_id: conversationId,
        });
        if (siteIdResult.success && siteIdResult.site_id) {
          siteIdForValidation = siteIdResult.site_id;
        }
      }
      if (siteIdForValidation) {
        const configValidation = await activities.validateWorkflowConfigActivity(
          siteIdForValidation, 'supervise_conversations'
        );
        if (!configValidation.shouldExecute) {
          console.log(`Supervisor workflow blocked: ${configValidation.reason}`);
        } else {
          await startChild(agentSupervisorWorkflow, {
            args: [{ command_id: commandId, conversation_id: conversationId }],
            workflowId: `agent-supervisor-${commandId || conversationId}-${Date.now()}`,
            taskQueue: TASK_QUEUES.HIGH,
            parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
          });
        }
      }
    }
  } catch (error) {
    if (propagateCancellation && isCancellation(error)) throw error;
    console.error('Agent supervisor workflow start error (non-blocking):', error);
  }
}