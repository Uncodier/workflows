import { isCancellation, patched, proxyActivities, sleep } from '@temporalio/workflow';
import type { reconcileTemplateDeliveryActivity, markTemplateReconciliationRequiredActivity } from '../../activities/channelActivities';
import { isTemplatePending, TEMPLATE_POLL_DELAYS, RECOVERABLE_TEMPLATE_POLL_DELAYS, validateTemplateDelivery, type TemplateDeliveryMetadata, type TemplateRecoveryRequest } from '../../utils/templateDelivery';

const { reconcileTemplateDeliveryActivity: reconcile } = proxyActivities<{ reconcileTemplateDeliveryActivity: typeof reconcileTemplateDeliveryActivity }>({
  startToCloseTimeout: '30 seconds', scheduleToCloseTimeout: '3 minutes',
  retry: { initialInterval: '5 seconds', maximumInterval: '30 seconds', maximumAttempts: 4 },
});
const { markTemplateReconciliationRequiredActivity: markUnconfirmed } = proxyActivities<{
  markTemplateReconciliationRequiredActivity: typeof markTemplateReconciliationRequiredActivity
}>({ startToCloseTimeout: '30 seconds', scheduleToCloseTimeout: '2 minutes', retry: { maximumAttempts: 3 } });

/** Not a retry loop: only the API's durable pending receipt permits resumption. */
export async function pollTemplateDelivery<T extends TemplateDeliveryMetadata & { success: boolean; messageId?: string; skipped?: boolean }>(
  send: () => Promise<T>, messageId: string, recoveryRequest?: TemplateRecoveryRequest,
): Promise<T> {
  const recoverable = patched('template-poll-read-reconciliation-v1');
  let result = await send();
  if (result.skipped) return result;
  validateTemplateDelivery(result, messageId);
  const needsReconciliation = async (): Promise<T> => {
    let persisted = false;
    if (recoveryRequest && result.template_id) {
      try {
        await markUnconfirmed({ site_id: recoveryRequest.site_id, conversation_id: recoveryRequest.conversation_id,
          message_id: messageId, template_id: result.template_id });
        persisted = true;
      } catch (error) {
        if (isCancellation(error)) throw error;
      }
    }
    return { ...result, success: false, status: 'needs_reconciliation', template_pending: false,
      needs_reconciliation: true, reconciliation_persisted: persisted };
  };
  for (const delay of recoverable ? RECOVERABLE_TEMPLATE_POLL_DELAYS : TEMPLATE_POLL_DELAYS) {
    if (!isTemplatePending(result)) return result;
    await sleep(delay);
    try {
      const next = await send();
      if (next.skipped) return next;
      validateTemplateDelivery(next, messageId);
      result = next; // Keep the prior durable pending receipt if this poll fails.
    } catch (error) {
      if (!recoverable || isCancellation(error)) throw error;
      const unconfirmed = { ...result, success: false, status: 'needs_reconciliation',
        template_pending: false, needs_reconciliation: true };
      if (!recoveryRequest) return needsReconciliation();
      try {
        const saved = await reconcile(recoveryRequest);
        if ((saved.local_message_id || saved.message_id) !== messageId || saved.template_id !== result.template_id) return needsReconciliation();
        const state = saved.template_state || saved.template_delivery?.state;
        if (saved.recovery_action === 'resume' && ['pending', 'ready'].includes(String(state))
          && saved.status !== 'failed' && saved.delivery_status !== 'failed') {
          result = { ...result, ...saved, success: true, status: 'template_pending', template_pending: true };
          validateTemplateDelivery(result, messageId);
          // Next bounded timer is the only path back to POST, never an activity retry.
          continue;
        }
        if (saved.recovery_action === 'complete' && ['accepted', 'sent', 'delivered', 'read'].includes(String(state))
          && saved.status !== 'failed' && saved.delivery_status !== 'failed'
          && (saved.messageId || (saved.message_id !== messageId && saved.message_id))) {
          return { ...result, ...saved, messageId: saved.messageId || saved.message_id,
            success: true, status: 'sent', template_pending: false, template_used: true };
        }
        return { ...unconfirmed, ...saved, success: false, template_pending: false,
          status: ['rejected', 'failed'].includes(String(state)) || saved.delivery_status === 'failed'
            ? 'failed' : 'needs_reconciliation',
          needs_reconciliation: !['rejected', 'failed'].includes(String(state)) && saved.delivery_status !== 'failed' };
      } catch (readError) {
        if (isCancellation(readError)) throw readError;
        return needsReconciliation();
      }
    }
  }
  if (recoverable && isTemplatePending(result)) return { ...await needsReconciliation(), polling_exhausted: true };
  return isTemplatePending(result)
    ? { ...result, success: false, polling_exhausted: true }
    : result;
}