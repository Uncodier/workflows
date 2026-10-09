import type { OutreachActivityKey } from './outreachActivity';

export interface OutreachMessage {
  id: string;
  role: string;
  created_at: string;
  custom_data?: Record<string, any> | null;
}

/** Waiting period after a confirmed send; the first contact keeps its existing initial threshold. */
export function outreachCooldownMs(unanswered: number, mode: 'progressive' | 'fixed', fixedDays?: number): number {
  if (unanswered < 1) return 0;
  const days = mode === 'fixed' ? fixedDays! : [1, 1, 3, 7, 14][Math.min(unanswered - 1, 4)];
  return days * 86400000;
}

export function isInboundReply(message: OutreachMessage): boolean {
  const data = message.custom_data || {};
  return message.role === 'user' && data.is_internal !== true && data.internal !== true
    && data.direction !== 'outbound' && !['system', 'notification'].includes(data.source);
}

export function confirmedMessageTime(message: OutreachMessage): number | undefined {
  const data = message.custom_data || {};
  if (message.role !== 'assistant' || !(data.status === 'sent' || data.delivery?.success === true || data.outreach_delivery?.state === 'sent')) return undefined;
  const timestamp = Date.parse(data.outreach_delivery?.sent_at || data.delivery?.timestamp || data.timestamp_sync?.delivery_timestamp || message.created_at);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function summarizeOutreachHistory(messages: OutreachMessage[]) {
  const lastInboundAt = messages.filter(isInboundReply).reduce((latest, message) => Math.max(latest, Date.parse(message.created_at) || 0), 0);
  let lastSentAt = 0;
  const sent = new Set<string>();
  for (const message of messages) {
    const data = message.custom_data || {};
    // Collections do not count toward the prospecting sequence or mark buyers cold.
    if (data.outreach_activity === 'invoices_due' || data.outreach_delivery?.activity === 'invoices_due') continue;
    const at = confirmedMessageTime(message);
    if (at === undefined) continue;
    lastSentAt = Math.max(lastSentAt, at);
    if (at <= lastInboundAt) continue;
    const externalId = data.outreach_delivery?.provider_message_id || data.delivery?.details?.message_id || data.external_message_id || data.message_id;
    sent.add(externalId || message.id);
  }
  return {
    hasInbound: lastInboundAt > 0, lastInboundAt, lastSentAt, unanswered: sent.size,
    uncertain: messages.some(message => message.custom_data?.outreach_delivery?.state === 'dispatching'),
    hasPending: messages.some(message => message.role === 'assistant'
      && ['pending', 'accepted', 'sending'].includes(message.custom_data?.status)
      && confirmedMessageTime(message) === undefined),
  };
}

export function evaluateOutreachHistory(messages: OutreachMessage[], activity: OutreachActivityKey, maxUnanswered: number,
  waitMs: number, now = Date.now(), createdAt = 0, cooldownMode: 'progressive' | 'fixed' = 'progressive', cooldownDays?: number) {
  const history = summarizeOutreachHistory(messages);
  const matchesAudience = activity === 'leads_initial_cold_outreach' ? !history.hasInbound : history.hasInbound;
  const lastContact = Math.max(history.lastSentAt, history.lastInboundAt, createdAt);
  const replyWindowElapsed = now - lastContact >= (history.unanswered ? outreachCooldownMs(history.unanswered, cooldownMode, cooldownDays) : waitMs);
  return {
    ...history, matchesAudience,
    shouldMarkCold: matchesAudience && history.unanswered >= maxUnanswered && replyWindowElapsed && !history.uncertain,
    eligible: matchesAudience && history.unanswered < maxUnanswered && replyWindowElapsed && !history.hasPending && !history.uncertain,
  };
}