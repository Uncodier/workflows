import { getTemporalClient } from '../client';
import { createHash } from 'node:crypto';
import { CONVERSATION_TURN_ENQUEUE, CONVERSATION_TURN_READY, conversationQueueId, type ConversationTurn } from '../utils/conversationTurn';

export async function enqueueConversationTurnActivity(input: {
  siteId: string; conversationId: string; taskQueue: string; turn: ConversationTurn;
}): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.signalWithStart('conversationTurnQueueWorkflow', {
      workflowId: conversationQueueId(input.siteId, createHash('sha256').update(input.conversationId).digest('hex')),
      taskQueue: input.taskQueue,
      args: [],
      signal: CONVERSATION_TURN_ENQUEUE,
      signalArgs: [input.turn],
    });
  } finally { await client.connection.close(); }
}

/** Bind every operation to a run: a retry must never grant a later reused workflow ID. */
export async function grantConversationTurnActivity(turn: ConversationTurn): Promise<boolean> {
  const client = await getTemporalClient();
  try {
    const handle = client.workflow.getHandle(turn.workflowId, turn.runId);
    if ((await handle.describe()).status.name !== 'RUNNING') return false;
    try { await handle.signal(CONVERSATION_TURN_READY, turn.runId); }
    catch (error) {
      // Cancellation can race the grant. Only skip after verifying terminal state.
      if ((await handle.describe()).status.name === 'RUNNING') throw error;
      return false;
    }
    return true;
  } finally { await client.connection.close(); }
}

export async function isConversationTurnRunningActivity(turn: ConversationTurn): Promise<boolean> {
  const client = await getTemporalClient();
  try {
    return (await client.workflow.getHandle(turn.workflowId, turn.runId).describe()).status.name === 'RUNNING';
  } finally { await client.connection.close(); }
}