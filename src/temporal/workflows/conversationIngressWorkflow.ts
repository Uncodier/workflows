import { condition, continueAsNew, defineSignal, isCancellation, ParentClosePolicy, setHandler, startChild } from '@temporalio/workflow';

export interface ConversationMessageSubmission {
  workflowId: string;
  workflowType: 'customerSupportMessageWorkflow' | 'whatsappMessageWorkflow';
  args: unknown[];
  taskQueue: string;
}

/** The signal is the acceptance boundary, before any per-message worker can run. */
export async function conversationIngressWorkflow(
  pending: ConversationMessageSubmission[] = [], admittedIds: string[] = [],
): Promise<void> {
  const admitted = new Set([...admittedIds, ...pending.map(message => message.workflowId)]);
  setHandler(defineSignal<[ConversationMessageSubmission]>('submitConversationMessage'), message => {
    if (!message?.workflowId || !message.taskQueue || !Array.isArray(message.args) ||
        !['customerSupportMessageWorkflow', 'whatsappMessageWorkflow'].includes(message.workflowType) ||
        admitted.has(message.workflowId)) return;
    admitted.add(message.workflowId);
    pending.push(message);
  });
  for (let completed = 0; completed < 100; completed++) {
    if (!await condition(() => pending.length > 0, '1 hour') && pending.length === 0) return;
    const message = pending.shift()!;
    const handle = await startChild(message.workflowType, {
      workflowId: message.workflowId, taskQueue: message.taskQueue,
      args: message.args,
      // No incoming request cancels or replaces older work. Explicit cancellation
      // targets the child, and is observed by result() before advancing the queue.
      parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    });
    try { await handle.result(); }
    catch (error) {
      if (isCancellation(error)) throw error;
      // A settled failed/canceled message must not discard the rest of the inbox.
      // Starting/identity errors above remain fail-closed, never run in parallel.
    }
  }
  await continueAsNew<typeof conversationIngressWorkflow>(pending, [...admitted].slice(-1000));
}