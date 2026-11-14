import { condition, continueAsNew, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type * as Activities from '../activities/conversationTurnActivities';
import { CONVERSATION_TURN_ENQUEUE, type ConversationTurn } from '../utils/conversationTurn';

const { grantConversationTurnActivity, isConversationTurnRunningActivity } = proxyActivities<typeof Activities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', maximumInterval: '30 seconds' },
});

/** Signal history is the durable FIFO admission order across all workers. */
export async function conversationTurnQueueWorkflow(
  pending: ConversationTurn[] = [], seenRunIds: string[] = [], active?: ConversationTurn,
): Promise<void> {
  const seen = new Set([...seenRunIds, ...pending.map(turn => turn.runId)]);
  setHandler(defineSignal<[ConversationTurn]>(CONVERSATION_TURN_ENQUEUE), turn => {
    if (!turn?.workflowId || !turn.runId || seen.has(turn.runId)) return;
    seen.add(turn.runId);
    pending.push(turn);
  });
  let checks = 0;
  for (let completed = 0; completed < 100; completed++) {
    if (!active) {
      if (!await condition(() => pending.length > 0, '1 hour') && pending.length === 0) return;
      const turn = pending.shift()!;
      if (!await grantConversationTurnActivity(turn)) continue;
      active = turn;
    }
    if (active) {
      // No expiring lease: slow generation/delivery cannot let the next turn overtake.
      while (await isConversationTurnRunningActivity(active)) {
        if (++checks >= 500) {
          // Carry ownership, not just pending entries, across history rollover.
          await continueAsNew<typeof conversationTurnQueueWorkflow>(pending, [...seen].slice(-1000), active);
        }
        await sleep('1 second');
      }
      active = undefined;
    }
  }
  await continueAsNew<typeof conversationTurnQueueWorkflow>(pending, [...seen].slice(-1000));
}