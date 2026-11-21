import { epoch, History, maxAttemptsReached, rejected, rejectedFailure, senderRun, supportRun, timedOut, timeoutFailure } from './history';

// The API's customerSupportMessageWorkflow input *as a child of the FIFO ingress*.
// IDs, contacts and payloads are invented. No activities/providers implement these results.
export const supportId = 'channel-message-offline';
export const newPatch = 'zavu-channel-delivery-outcome-v1';
const pinnedPatch = 'zavu-saved-channel-reply-v1';
const parentMarkers = ['conversation-turn-fifo-v1', 'customer-support-channel-guidance-v1',
  'customer-support-response-format-v1', 'customer-support-outbound-media-v1'];
export const senderType = 'sendChannelMessageFromAgentWorkflow';
const supportType = 'customerSupportMessageWorkflow';
const senderPatch = 'send-channel-outbound-media-v1';
const route = { source: 'zavu_inbound_message', connection_id: 'connection-a', channel: 'telegram',
  zavu_sender_id: 'sender-a', zavu_from: 'contact-b', attachments: [] };
const inbound = { site_id: 'site-a', userId: 'owner-a', message: 'Hello', name: 'Contact', phone: 'contact-b',
  origin: 'telegram', origin_message_id: 'incoming-a', channel_delivery: true, website_chat_origin: false, custom_data: route };
const base = { origin: 'telegram', origin_message_id: 'incoming-a' };
const guidance = { siteId: 'site-a', messageId: 'incoming-a', channel: 'telegram', message: 'Hello' };
const inboundUser = { message_id: 'saved-user-a', content: 'Hello' };
const media = { message_type: 'image', media_url: 'https://example.invalid/file.png', mime_type: 'image/png' };
const generated = { site_id: 'site-a', agent_id: 'responder-a', conversation_id: 'conversation-a', lead_id: 'lead-a' };
const generation = 'sendCustomerSupportMessageActivity';
const send = 'sendChannelMessageFromAgentActivity';
const prepare = 'prepareChannelGuidanceActivity';
const supportParent = { workflowId: 'conversation-ingress-site-a-offline', runId: '33333333-3333-4333-8333-333333333333', initiatedId: 6 };

export type Scenario = 'old unpinned' | 'old pinned' | 'old pinned send failed' | 'accepted' | 'native media accepted'
  | 'send timeout' | 'activity no receipt' | 'legacy child no receipt' | 'generation timeout' | 'draft' | 'disabled';

export function channelHistories(scenario: Scenario) {
  const pinned = scenario !== 'old unpinned';
  const strict = !scenario.startsWith('old');
  const isMedia = scenario === 'native media accepted';
  const saved = { ...generated, messages: { assistant: { message_id: 'saved-reply-a', content: 'Reply', ...(isMedia ? media : {}) }, user: inboundUser } };
  const disabled = { conversation_id: 'conversation-a', agent_disabled: true, response_skipped: true, messages: { user: inboundUser } };
  const data = scenario === 'disabled' ? disabled : saved;
  const requireApproval = scenario === 'draft';
  const input = { ...inbound, ...(requireApproval ? { require_approval: true } : {}) };
  const h = new History(supportType, supportRun, [input, base], supportParent);
  parentMarkers.forEach(id => h.patch(id));
  h.upsert({ site_id: ['site-a'] });
  if (pinned) h.patch(pinnedPatch);
  if (strict) h.patch(newPatch);
  const timer = h.timer(240);
  h.activity(prepare, [guidance], { runs: [] }, 15, 1, 10);
  h.cancelTimer(timer);
  const request = { summary: 'Hello', original_text: 'Hello', original_subject: 'Contact',
    contact_info: { name: 'Contact', phone: 'contact-b', email: '', company: '' }, site_id: 'site-a', user_id: 'owner-a',
    lead_notification: 'none', analysis_id: 'telegram-incoming-a', priority: 'medium', intent: 'inquiry', potential_value: 'medium',
    channel_delivery: true, require_approval: requireApproval, custom_data: route, origin_message_id: 'incoming-a', channel_guidance_run_plan_ids: [] };
  const generationArgs = [request, base];
  h.activity(generation, generationArgs, scenario === 'generation timeout' ? timedOut : { success: true, data }, 300, strict ? 1 : 4, 10);
  const activityCommands = [{ activity: prepare, args: [guidance], attempts: 1 },
    { activity: generation, args: generationArgs, attempts: strict ? 1 : 4 }];
  const patches = [...parentMarkers, ...(pinned ? [pinnedPatch] : []), ...(strict ? [newPatch] : [])];
  const parentOnly = (returned: unknown) => ({ history: h.close({ result: returned }), activityCommands, patches, returned, child: undefined });
  const v1 = { version: 1 };
  if (scenario === 'generation timeout') return parentOnly({ success: false, data: { processed: false, channelMessageSent: false,
    deliveryOutcome: { ...v1, state: 'unknown', stage: 'generation', reason: 'generation_unconfirmed' } } });
  if (scenario === 'disabled' || scenario === 'draft') return parentOnly({ success: true, data: { ...data, processed: true, channelMessageSent: false,
    deliveryOutcome: { ...v1, conversationId: 'conversation-a', ...(scenario === 'disabled' ? {
      state: 'suppressed', stage: 'generation', reason: 'agent_disabled' } : {
      state: 'draft', stage: 'delivery', messageId: 'saved-reply-a', reason: 'approval_required' }) } } });

  const id = pinned ? 'send-channel-reply-saved-reply-a' : 'send-telegram-agent-incoming-a';
  const senderArgs = { channel: 'telegram', ...(strict ? { delivery_receipt_required: true } : {}), to: 'contact-b', message: 'Reply',
    ...(isMedia ? media : {}), site_id: 'site-a', ...(pinned ? { agent_id: 'responder-a' } : {}), conversation_id: 'conversation-a', lead_id: 'lead-a',
    message_id: 'saved-reply-a', custom_data: pinned ? { ...route, origin_message_id: 'incoming-a' } : route };
  const missingStatus = scenario === 'activity no receipt';
  const failed = scenario === 'send timeout' || scenario === 'old pinned send failed' || missingStatus;
  // In the old failure case model a terminal non-retryable rejection (rather
  // than a timeout, which would be retried by the old network policy).
  const noReceipt = scenario === 'legacy child no receipt';
  const accepted = strict && !failed && !noReceipt;
  const elapsed = scenario === 'send timeout' ? 120_000 : 15;
  const senderStarted = epoch + 20;
  const senderResult = { success: true, messageId: 'provider-a', ...(accepted ? { status: 'queued' } : {}), recipient: 'contact-b',
    executionTime: `${elapsed}ms`, timestamp: new Date(senderStarted + elapsed).toISOString() };
  const rejection = missingStatus ? { message: 'Original response has no verifiable provider acceptance',
    applicationFailureInfo: { type: 'CHANNEL_RECEIPT_UNCONFIRMED', nonRetryable: true } } : rejectedFailure;
  const timeout = scenario === 'send timeout';
  const failure = { message: timeout ? 'Activity task timed out' : 'Activity task failed', cause: timeout ? timeoutFailure : rejection,
    activityFailureInfo: { activityType: { name: send }, activityId: '1', retryState: timeout ? maxAttemptsReached : 'RETRY_STATE_NON_RETRYABLE_FAILURE',
      scheduledEventId: 8, startedEventId: 9, identity: timeout ? '' : 'offline-replay' } };
  const terminal = failed ? { failure } : { result: senderResult };
  const initiatedId = h.child(id, senderArgs, terminal, elapsed);
  const delivery = { ...v1, stage: 'delivery', messageId: 'saved-reply-a', conversationId: 'conversation-a', sendWorkflowId: id };
  const returned = strict ? { success: accepted, data: { ...data, processed: accepted, channelMessageSent: accepted, channelWorkflowId: id,
    deliveryOutcome: accepted ? { ...delivery, state: 'accepted', reason: 'provider_accepted', providerMessageId: 'provider-a', status: 'queued' }
      : { ...delivery, state: 'unknown', reason: noReceipt ? 'receipt_unconfirmed' : 'send_unconfirmed' } } }
    : { success: true, data: { ...data, processed: true, reason: 'telegram message processed for customer support', channelMessageSent: !failed, channelWorkflowId: id } };
  // A legacy child completion without a receipt is a parent-only fault fixture.
  const childHistory = () => {
    const s = new History(senderType, senderRun, [senderArgs], { workflowId: supportId, runId: supportRun, initiatedId }, senderStarted);
    s.patch(senderPatch);
    s.upsert({ site_id: ['site-a'], ...(pinned ? { user_id: ['responder-a'] } : {}), lead_id: ['lead-a'] });
    s.activity(send, [senderArgs], failed ? (timeout ? timedOut : rejected) : { success: true, messageId: 'provider-a', ...(strict ? { status: 'queued' } : {}) },
      120, strict ? 1 : 3, elapsed, rejection);
    return s.close(terminal);
  };
  return { history: h.close({ result: returned }), activityCommands, patches, returned,
    child: { id, args: [senderArgs], activity: send, attempts: strict ? 1 : 3, terminal, patch: senderPatch,
      history: noReceipt ? undefined : childHistory() } };
}
