import { isCancellation, patched, proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from '../../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../../config/timeouts';
import { RECOVERABLE_TEMPLATE_POLL_DELAYS } from '../../utils/templateDelivery';
import { parseRoutedTextReceipt, routedTextPollBinding, type RoutedWhatsAppTextReceipt, type RoutedWhatsAppTextRequest } from '../../utils/routedWhatsAppText';

const { sendRoutedWhatsAppTextActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  scheduleToCloseTimeout: '3 minutes', // Also bound polling if the activity queue is unavailable.
  retry: { maximumAttempts: 1 },
});

const { updateConversationStatusAfterFollowUpActivity, updateTaskStatusToCompletedActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS, retry: RETRY_POLICIES.NETWORK,
});

const { readRoutedWhatsAppTextActivity, stopRoutedWhatsAppPollActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds', scheduleToCloseTimeout: '2 minutes', retry: { maximumAttempts: 4, initialInterval: '4 seconds' },
});

/** A lost send response is not evidence of rejection. Only a stored, scoped,
 * idle template receipt can authorize the next timer. No resend inside recovery. */
async function recover(request: RoutedWhatsAppTextRequest, previous: RoutedWhatsAppTextReceipt | undefined,
  lastPoll: boolean, reason: string): Promise<RoutedWhatsAppTextReceipt> {
  const stopped: RoutedWhatsAppTextReceipt = { ...previous, message_id: request.message_id, success: false,
    status: 'needs_reconciliation', reconciliation_persisted: false, reason };
  const matchesPrevious = (r: RoutedWhatsAppTextReceipt) => !previous ||
    (r.connection_id === previous.connection_id && r.template_id === previous.template_id && (!previous.provider || r.provider === previous.provider));
  try {
    const saved = parseRoutedTextReceipt(await readRoutedWhatsAppTextActivity(request), request.message_id);
    if (saved.status !== 'template_pending') return saved; // Including an accepted result written during the timeout.
    const binding = routedTextPollBinding(saved);
    if (!binding) return stopped;
    // If an in-flight API call advanced to another connection, do not resume
    // it from this workflow. Hand its current idle receipt to reconciliation.
    if (!lastPoll && matchesPrevious(saved)) return saved;
    const marked = parseRoutedTextReceipt(await stopRoutedWhatsAppPollActivity({ ...request, ...binding }), request.message_id);
    return marked.status === 'template_pending' ? stopped : marked;
  } catch (error) {
    if (isCancellation(error)) throw error;
  }
  // A previous successful send may have supplied the attempt token before a
  // read outage. CAS makes this safe even if that poll subsequently advanced.
  const binding = previous && routedTextPollBinding(previous);
  if (binding) {
    try {
      const marked = parseRoutedTextReceipt(await stopRoutedWhatsAppPollActivity({ ...request, ...binding }), request.message_id);
      if (marked.status !== 'template_pending') return marked;
    } catch (error) { if (isCancellation(error)) throw error; }
  }
  return stopped;
}

/** Do not retry sends on error. Only a validated, durable pending receipt allows the
 * same identity to be presented to the router again, through its 24h deadline.
 * A different connection/template in a later receipt is the API's decision.
 */
export async function routeSavedWhatsAppText(request: RoutedWhatsAppTextRequest): Promise<RoutedWhatsAppTextReceipt> {
  const useRecovery = patched('whatsapp-routed-text-poll-recovery-v1');
  let pending: RoutedWhatsAppTextReceipt | undefined;
  let observing = false;
  for (let poll = 0; ; poll++) {
    const lastPoll = poll === RECOVERABLE_TEMPLATE_POLL_DELAYS.length;
    let result: RoutedWhatsAppTextReceipt;
    if (observing) {
      result = await recover(request, pending, lastPoll, 'routed_text_receipt_unconfirmed');
    } else {
      try {
        result = parseRoutedTextReceipt(await sendRoutedWhatsAppTextActivity(request), request.message_id);
      } catch (error) {
        if (isCancellation(error)) throw error;
        if (!useRecovery) return { ...pending, message_id: request.message_id, success: false, status: 'needs_reconciliation',
          reason: 'routed_text_receipt_unconfirmed' };
        result = await recover(request, pending, lastPoll, 'routed_text_receipt_unconfirmed');
      }
    }
    observing = useRecovery && result.recovery_action === 'observe';
    if (observing) {
      if (lastPoll) return { ...result, recovery_action: undefined, reconciliation_persisted: false, reason: 'routed_text_attempt_still_active' };
      await sleep(RECOVERABLE_TEMPLATE_POLL_DELAYS[poll]);
      continue; // Never POST on a timer for an in-flight or late HTTP attempt.
    }
    if (result.status !== 'template_pending') return result;
    pending = result;
    if (lastPoll) {
      if (useRecovery) return recover(request, pending, true, 'template_polling_exhausted');
      return { ...pending, success: false, status: 'needs_reconciliation', reason: 'template_polling_exhausted' };
    }
    await sleep(RECOVERABLE_TEMPLATE_POLL_DELAYS[poll]);
  }
}

/** Only accepted approved sends reach this bookkeeping. Do not even run the
 * legacy message timestamp update: it replaces the whole custom_data snapshot.
 */
export async function completeRoutedWhatsAppFollowUp({ site_id, conversation_id, message_id }: RoutedWhatsAppTextRequest,
  lead_id: string, response_data: Record<string, unknown> = {}): Promise<void> {
  try {
    await updateConversationStatusAfterFollowUpActivity({ conversation_id, lead_id, site_id, response_data,
      additional_data: { message_ids: [message_id], conversation_ids: [conversation_id] } });
    await updateTaskStatusToCompletedActivity({ lead_id, site_id, stage: 'awareness', status: 'completed',
      notes: 'Task completed after successful whatsapp message delivery via sendApprovedMessagesWorkflow' });
  } catch (error) {
    if (isCancellation(error)) throw error;
    console.warn('Post-acceptance WhatsApp follow-up update failed; keeping the API receipt');
  }
}