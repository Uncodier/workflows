/** Identity-only API contract. No recipient, sender, content, or routing hint. */
export interface RoutedWhatsAppTextRequest {
  site_id: string;
  conversation_id: string;
  message_id: string;
}

export interface RoutedWhatsAppTextReceipt {
  message_id: string; // Always the saved, local message ID.
  status: 'accepted' | 'template_pending' | 'failed' | 'needs_reconciliation' | 'skipped';
  success: boolean;
  connection_id?: string;
  provider?: 'zavu' | 'twilio';
  provider_message_id?: string;
  template_id?: string;
  attempt_id?: string; // CAS token returned by the read-only recovery endpoint.
  reconciliation_persisted?: boolean;
  recovery_action?: 'observe'; // Owner still running; only another receipt GET is allowed.
  reason?: string;
  skipped?: boolean;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0
    && !/^(unknown|null|undefined|none|n\/a|pending|placeholder|0+|00000000-0000-0000-0000-000000000000)$/i.test(value);
}

export function savedTextIdentity(input: Partial<RoutedWhatsAppTextRequest>): RoutedWhatsAppTextRequest | undefined {
  const { site_id, conversation_id, message_id } = input;
  return validId(site_id) && validId(conversation_id) && validId(message_id)
    ? { site_id, conversation_id, message_id } : undefined;
}

/** Validate *each* HTTP response before it can authorize a follow-up or a timer.
 * Only the API may change connections/templates after a definitive rejection.
 */
export function parseRoutedTextReceipt(value: unknown, messageId: string): RoutedWhatsAppTextReceipt {
  function invalid(): never { throw new Error('Invalid routed WhatsApp text receipt'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const { message_id, status, success, connection_id, provider, provider_message_id, template_id,
    attempt_id, reconciliation_persisted, recovery_action, reason, skipped } = value as Record<string, unknown>;
  if (message_id !== messageId || typeof success !== 'boolean'
    || (connection_id !== undefined && !validId(connection_id))
    || (provider !== undefined && provider !== 'zavu' && provider !== 'twilio')
    || (provider_message_id !== undefined && (!validId(provider_message_id) || provider_message_id === messageId))
    || (template_id !== undefined && !validId(template_id))
    || (attempt_id !== undefined && !validId(attempt_id))
    || (recovery_action !== undefined && (recovery_action !== 'observe' || status !== 'needs_reconciliation'
      || provider_message_id !== undefined || !validId(attempt_id) || !validId(connection_id) || !provider))
    || (reconciliation_persisted !== undefined && (status !== 'needs_reconciliation' || typeof reconciliation_persisted !== 'boolean'))
    || (reason !== undefined && typeof reason !== 'string')
    || (skipped !== undefined && skipped !== (status === 'skipped'))) return invalid();

  switch (status) {
    case 'accepted':
      if (!success || !connection_id || !provider_message_id) return invalid();
      break;
    case 'template_pending':
      if (!success || !connection_id || !template_id || provider_message_id !== undefined) return invalid();
      break;
    case 'skipped':
      if (!success) return invalid();
      break;
    case 'failed':
    case 'needs_reconciliation':
      if (success) return invalid();
      break;
    default: return invalid(); // In particular, no implicit or legacy_unconfigured fallback.
  }

  return { message_id, status, success, ...(connection_id !== undefined && { connection_id }),
    ...(provider !== undefined && { provider }), ...(provider_message_id !== undefined && { provider_message_id }),
    ...(template_id !== undefined && { template_id }), ...(attempt_id !== undefined && { attempt_id }),
    ...(reconciliation_persisted !== undefined && { reconciliation_persisted }), ...(recovery_action === 'observe' && { recovery_action }),
    ...(reason !== undefined && { reason }),
    ...(status === 'skipped' ? { skipped: true } : skipped === false ? { skipped: false } : {}) };
}

export type RoutedTextPollBinding = Required<Pick<RoutedWhatsAppTextReceipt, 'attempt_id' | 'provider' | 'connection_id' | 'template_id'>>;
export function routedTextPollBinding(r: RoutedWhatsAppTextReceipt): RoutedTextPollBinding | undefined {
  return r.status === 'template_pending' && validId(r.connection_id) && validId(r.template_id) && validId(r.attempt_id)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.attempt_id)
    && (r.provider === 'zavu' || r.provider === 'twilio')
    ? { connection_id: r.connection_id, template_id: r.template_id, attempt_id: r.attempt_id, provider: r.provider } : undefined;
}