import { defaultPayloadConverter, type Payload } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { sendCustomerSupportMessageActivity } from '../src/temporal/activities/sendCustomerSupportMessageActivity';
import { sendChannelMessageFromAgentActivity } from '../src/temporal/activities/channelActivities';
import { channelHistories, type Scenario } from './fixtures/channel-replay/scenarios';

// Real activities and ApiService HTTP encoding/decoding; the only outbound
// transport is a local fetch stub. Never construct the DB client or read credentials.
jest.mock('../src/config/config', () => ({ apiConfig: { baseUrl: 'https://offline.invalid', apiKey: 'fixture' } }));
jest.mock('../src/temporal/activities/automationSnoozeActivities', () => ({
  checkConversationAutomationActivity: async () => ({ success: true }),
}));
const value = (p: Payload) => defaultPayloadConverter.fromPayload(p);
function scheduled(history: temporal.api.history.v1.History, name: string) {
  const event = history.events.find(e => e.activityTaskScheduledEventAttributes?.activityType?.name === name)!;
  const args = event.activityTaskScheduledEventAttributes!.input!.payloads!.map(value);
  const end = history.events.find(e => String(e.activityTaskCompletedEventAttributes?.scheduledEventId) === String(event.eventId));
  return { args, result: end?.activityTaskCompletedEventAttributes?.result?.payloads?.map(value)[0] };
}

const scenarios: Scenario[] = ['accepted', 'native media accepted', 'activity no receipt', 'generation timeout', 'send timeout', 'draft', 'disabled'];
it.each(scenarios)('matches activity HTTP boundaries to the replayed channel contract: %s', async scenario => {
  const { history, child } = channelHistories(scenario);
  const generate = scheduled(history, 'sendCustomerSupportMessageActivity');
  const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body));
    posted.push({ path, body });
    if (path === '/api/agents/customerSupport/message') {
      if (scenario === 'generation timeout') throw new Error('Simulated response loss after generation');
      return Response.json(generate.result);
    }
    if (path === '/api/agents/tools/sendChannelMessage') {
      if (scenario === 'send timeout') throw new Error('Simulated response loss after send');
      if (scenario === 'activity no receipt') return Response.json({ success: true });
      return Response.json({ success: true, messageId: 'provider-a', status: 'queued' });
    }
    throw new Error('Unexpected fixture URL');
  });
  try {
    const [request, base] = generate.args as Parameters<typeof sendCustomerSupportMessageActivity>;
    const generated = sendCustomerSupportMessageActivity(request, base);
    if (scenario === 'generation timeout') await expect(generated).rejects.toMatchObject({ type: 'CUSTOMER_SUPPORT_API_FAILURE' });
    else await expect(generated).resolves.toEqual(generate.result);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ path: '/api/agents/customerSupport/message', body: { channel_delivery: true,
      origin: 'telegram', origin_message_id: 'incoming-a', message: 'Hello', site_id: 'site-a',
      custom_data: { source: 'zavu_inbound_message', connection_id: 'connection-a', zavu_sender_id: 'sender-a' } } });
    expect(posted[0].body).not.toHaveProperty('agentId');
    if (!child?.history) return;
    const send = scheduled(child.history, 'sendChannelMessageFromAgentActivity');
    const [params] = send.args as Parameters<typeof sendChannelMessageFromAgentActivity>;
    const delivery = sendChannelMessageFromAgentActivity(params);
    if (scenario === 'send timeout') await expect(delivery).rejects.toMatchObject({ type: 'CHANNEL_API_FAILURE' });
    else if (scenario === 'activity no receipt') await expect(delivery).rejects.toMatchObject({ type: 'CHANNEL_RECEIPT_UNCONFIRMED', nonRetryable: true });
    else await expect(delivery).resolves.toEqual(send.result);
    expect(posted).toHaveLength(2);
    const { delivery_receipt_required, ...expectedWireBody } = params;
    expect(delivery_receipt_required).toBe(true);
    expect(posted[1]).toEqual({ path: '/api/agents/tools/sendChannelMessage', body: expectedWireBody });
  } finally { fetch.mockRestore(); }
});
