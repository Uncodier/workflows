// Real ApiService encoding/decoding; fetch is a stub, not a test server. No DB or credentials.
jest.mock('../src/config/config', () => ({ apiConfig: { baseUrl: 'https://offline.invalid', apiKey: 'fixture' } }));
import { readRoutedWhatsAppTextActivity, sendRoutedWhatsAppTextActivity, stopRoutedWhatsAppPollActivity } from '../src/temporal/activities/whatsappActivities';

const identity = { site_id: 'site', conversation_id: 'conversation', message_id: 'saved' };
const accepted = { message_id: 'saved', status: 'accepted', success: true,
  connection_id: 'connection', provider: 'zavu', provider_message_id: 'provider-1' };
const pending = { message_id: 'saved', status: 'template_pending', success: true,
  connection_id: 'alternate', provider: 'twilio', template_id: 'template' };
let fetchStub: jest.SpiedFunction<typeof fetch>;
beforeEach(() => { fetchStub = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Mocked lost response')); });
afterEach(() => fetchStub.mockRestore());

test.each([accepted, pending,
  { message_id: 'saved', status: 'skipped', success: true, skipped: true, reason: 'agent_snoozed' },
  { message_id: 'saved', status: 'failed', success: false, reason: 'no_eligible_route' },
  { message_id: 'saved', status: 'needs_reconciliation', success: false, connection_id: 'connection' },
])('POST only the saved identity, keep the handled $status outcome', async receipt => {
  fetchStub.mockResolvedValue(Response.json({ ...receipt, ignored: 'not part of the receipt' }, { status: 202 }));
  const stale = { ...identity, phone_number: 'NOT-THE-RECIPIENT', message: 'NOT-THE-CONTENT', from: 'NOT-THE-SENDER',
    connection_id: 'caller-hint', provider: 'twilio', template_id: 'caller-template' };
  await expect(sendRoutedWhatsAppTextActivity(stale)).resolves.toEqual(receipt);
  expect(fetchStub).toHaveBeenCalledTimes(1);
  const [[url, init]] = fetchStub.mock.calls;
  expect(url).toBe('https://offline.invalid/api/agents/whatsapp/sendRoutedText');
  expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
  expect(JSON.parse(String(init?.body))).toEqual(identity);
});

test.each([
  null, { success: true }, { success: true, data: accepted }, { ...accepted, success: false },
  { ...accepted, message_id: 'other' }, { ...accepted, connection_id: undefined }, { ...accepted, skipped: true },
  { ...accepted, provider: 'other' }, { ...accepted, status: 'sent' }, { ...accepted, status: 'legacy_unconfigured' },
  ...['saved', ' UNKNOWN ', 'unknown', 'null', 'N/A', '', '  ', undefined].map(provider_message_id => ({ ...accepted, provider_message_id })),
  { ...pending, message_id: 'other' }, { ...pending, success: false }, { ...pending, skipped: true },
  { ...pending, template_id: ' ' }, { ...pending, connection_id: 'unknown' },
  { success: true, message_id: 'saved', status: 'failed' }, { success: false, message_id: 'saved', status: 'skipped' },
])('invalid 2xx body %# cannot authorize delivery or a poll', async body => {
  fetchStub.mockResolvedValue(Response.json(body));
  await expect(sendRoutedWhatsAppTextActivity(identity)).rejects.toMatchObject({ nonRetryable: true, type: 'WHATSAPP_ROUTED_TEXT_UNCONFIRMED' });
  expect(fetchStub).toHaveBeenCalledTimes(1);
});

test.each([307, 400, 404, 409, 429, 503])('HTTP %i is not a handled outcome or a reason to resend', async status => {
  fetchStub.mockResolvedValue(Response.json(accepted, { status }));
  await expect(sendRoutedWhatsAppTextActivity(identity)).rejects.toMatchObject({ nonRetryable: true });
  expect(fetchStub).toHaveBeenCalledTimes(1);
});
test('invalid JSON and lost response are terminal, never a legacy fallback', async () => {
  fetchStub.mockResolvedValueOnce(new Response('not JSON'));
  for (let i = 1; i <= 2; i++) {
    await expect(sendRoutedWhatsAppTextActivity(identity)).rejects.toMatchObject({ nonRetryable: true });
    expect(fetchStub).toHaveBeenCalledTimes(i);
  }
});
test('invalid saved identity never reaches HTTP', async () => {
  await expect(sendRoutedWhatsAppTextActivity({ ...identity, conversation_id: ' ' })).rejects.toMatchObject({
    nonRetryable: true, type: 'WHATSAPP_ROUTED_TEXT_INVALID_INPUT' });
  expect(fetchStub).not.toHaveBeenCalled();
});

const binding = { attempt_id: '00000000-0000-4000-8000-000000000050', connection_id: pending.connection_id,
  template_id: pending.template_id, provider: 'twilio' as const };
test('poll recovery GET and PATCH never carry a send payload; only the scoped CAS can mark the poll', async () => {
  fetchStub.mockResolvedValueOnce(Response.json({ ...pending, ...binding }))
    .mockResolvedValueOnce(Response.json({ message_id: identity.message_id, status: 'needs_reconciliation', success: false, reconciliation_persisted: true }));
  await expect(readRoutedWhatsAppTextActivity(identity)).resolves.toMatchObject(binding);
  await expect(stopRoutedWhatsAppPollActivity({ ...identity, ...binding })).resolves.toMatchObject({ reconciliation_persisted: true });
  const [[url, read], [markerUrl, marker]] = fetchStub.mock.calls;
  expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual(identity);
  expect(read?.method).toBe('GET'); expect(read?.body).toBeUndefined();
  expect(markerUrl).toBe('https://offline.invalid/api/agents/whatsapp/sendRoutedText');
  expect(marker?.method).toBe('PATCH'); expect(JSON.parse(String(marker?.body))).toEqual({ ...identity, ...binding });
});
test('a partial GET receipt cannot unlock polling and an invalid stop token cannot issue a request', async () => {
  fetchStub.mockResolvedValueOnce(Response.json(pending));
  await expect(readRoutedWhatsAppTextActivity(identity)).rejects.toThrow('Unbound');
  await expect(stopRoutedWhatsAppPollActivity({ ...identity, ...binding, attempt_id: '' })).rejects.toThrow();
  expect(fetchStub).toHaveBeenCalledTimes(1);
});