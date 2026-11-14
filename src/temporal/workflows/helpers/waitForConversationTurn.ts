import { condition, defineSignal, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import type * as Activities from '../../activities/conversationTurnActivities';
import { CONVERSATION_TURN_READY, conversationTurnScope } from '../../utils/conversationTurn';

const { enqueueConversationTurnActivity } = proxyActivities<typeof Activities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', maximumInterval: '30 seconds' },
});

export async function waitForConversationTurn(input: unknown): Promise<void> {
  const scope = conversationTurnScope(input);
  if (!scope) return;
  const info = workflowInfo();
  // Ingress owns the entire child lifetime; avoid a second queue or a nested deadlock.
  if (info.parent?.workflowId.startsWith('conversation-ingress-')) return;
  let ready = false;
  setHandler(defineSignal<[string]>(CONVERSATION_TURN_READY), runId => {
    if (runId === info.runId) ready = true;
  });
  await enqueueConversationTurnActivity({ ...scope, taskQueue: info.taskQueue,
    turn: { workflowId: info.workflowId, runId: info.runId } });
  await condition(() => ready);
}