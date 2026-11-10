/** Shared wire contract; no workflow/activity runtime dependencies. */
export interface TemplateDeliveryMetadata {
  status?: string;
  delivery_format?: 'text' | 'audio' | 'template';
  requested_response_format?: 'text' | 'audio';
  template_used?: boolean;
  template_pending?: boolean;
  retry_after_seconds?: number;
  message_id?: string;
  local_message_id?: string;
  template_id?: string;
  polling_exhausted?: boolean;
  needs_reconciliation?: boolean;
  reconciliation_persisted?: boolean;
  recovery_action?: 'resume' | 'complete' | 'stop';
  delivery_status?: string;
  template_state?: string;
  template_delivery?: Record<string, unknown>;
}

export interface TemplateRecoveryRequest {
  site_id: string;
  conversation_id?: string;
  message_id: string;
}

export interface TemplateRecoveryResult extends TemplateDeliveryMetadata {
  success: boolean;
  recovery_action: 'resume' | 'complete' | 'stop';
  messageId?: string;
}

// Preserve the initial approval cadence, then reach the API's 24h deadline so
// ordinary slow approvals do not remain stranded after the first 7h31m.
export const TEMPLATE_POLL_DELAYS = ['1 minute', '30 minutes', '1 hour', '6 hours', '8 hours', '9 hours'] as const;

// New patch only: never leave a >1h blind interval near the approval deadline.
// 24h31m total; API must check provider approval before applying its timeout.
export const RECOVERABLE_TEMPLATE_POLL_DELAYS = ['1 minute', '30 minutes', ...Array<'1 hour'>(24).fill('1 hour')] as const;

export function templateDeliveryMetadata(value: TemplateDeliveryMetadata): TemplateDeliveryMetadata {
  const result: TemplateDeliveryMetadata = {};
  for (const key of ['status', 'delivery_format', 'requested_response_format', 'template_used',
    'template_pending', 'retry_after_seconds', 'message_id', 'template_id', 'polling_exhausted',
    'needs_reconciliation', 'reconciliation_persisted', 'recovery_action', 'delivery_status', 'template_state', 'template_delivery', 'local_message_id'] as const) {
    if (value[key] !== undefined) Object.assign(result, { [key]: value[key] });
  }
  return result;
}

/** Only an explicit, matching pending receipt authorizes another HTTP call. */
export function isTemplatePending(value: TemplateDeliveryMetadata): boolean {
  return value.status === 'template_pending' || value.template_pending === true;
}

export function validateTemplateDelivery(
  value: TemplateDeliveryMetadata & { success?: boolean; template_required?: boolean; messageId?: string },
  messageId: string,
): void {
  if (value.success !== true || value.template_required) throw new Error('Audio delivery was not confirmed');
  if (isTemplatePending(value)) {
    if (value.success !== true || value.status !== 'template_pending' || value.template_pending !== true
      || value.delivery_format !== 'template' || value.requested_response_format !== 'audio'
      || value.message_id !== messageId || !value.template_id?.trim()) {
      throw new Error('Invalid pending template receipt; reconcile before retry');
    }
    return;
  }
  if (value.delivery_format === 'template') {
    if (value.status !== 'sent' || value.template_used !== true || !(value.messageId || value.message_id)) {
      throw new Error('Template dispatch is not confirmed; reconcile before retry');
    }
  } else if (value.status && value.status !== 'sent' && value.status !== 'delivered') {
    throw new Error('Audio dispatch is not confirmed; reconcile before retry');
  }
  if (!(value.messageId || value.message_id)) throw new Error('Missing delivery receipt; reconcile before retry');
}