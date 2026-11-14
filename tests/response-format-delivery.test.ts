jest.mock('../src/temporal/activities/automationSnoozeActivities', () => ({
  checkConversationAutomationActivity: jest.fn(async () => ({ success: true })),
}));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: jest.fn() } }));
import { apiService } from '../src/temporal/services/apiService';
import { sendEmailFromAgentActivity } from '../src/temporal/activities/emailActivities';
import { sendWhatsAppFromAgentActivity } from '../src/temporal/activities/whatsappActivities';
import { sendChannelMessageFromAgentActivity } from '../src/temporal/activities/channelActivities';
import { sendCustomerSupportMessageActivity } from '../src/temporal/activities/sendCustomerSupportMessageActivity';
import { buildWhatsAppSendParams } from '../src/temporal/workflows/helpers/buildWhatsAppSendParams';
import { customerSupportResponseFormat, responseFormatFields } from '../src/temporal/workflows/helpers/responseFormat';

const post = apiService.post as jest.Mock;
const messageId = '11111111-1111-4111-8111-111111111111';
const common = { site_id: 'site', message: 'Hello', message_id: messageId, conversation_id: 'conversation' };
const senders = [
  (extra: any) => sendWhatsAppFromAgentActivity({ ...common, phone_number: '+15555550100', ...extra }),
  (extra: any) => sendChannelMessageFromAgentActivity({ ...common, channel: 'telegram', to: '123', ...extra }),
];
it('forwards media-only email canonical fields and makes timeouts terminal', async () => {
  const params = { site_id: 'site', email: 'recipient@example.test', subject: 'File', message: '',
    message_type: 'document' as const, media_url: 'https://assets.example.test/a.pdf', mime_type: 'application/pdf' };
  post.mockResolvedValueOnce({ success: true, data: { success: true, status: 'sent', email_id: '<receipt@example.test>' } });
  await sendEmailFromAgentActivity(params);
  expect(post).toHaveBeenCalledWith('/api/agents/tools/sendEmail', expect.objectContaining(params));
  post.mockReset().mockRejectedValueOnce(new Error('timeout'));
  await expect(sendEmailFromAgentActivity(params)).rejects.toMatchObject({ nonRetryable: true, type: 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN' });
  expect(post).toHaveBeenCalledTimes(1);
});
beforeEach(() => { post.mockReset(); post.mockResolvedValue({ success: true, data: { message_id: messageId } }); });

describe.each(senders)('explicit delivery format %#', send => {
  it.each(['image', 'video', 'audio', 'document'])('forwards media-only %s canonical metadata unchanged', async message_type => {
    const media = { message_type, media_url: 'https://assets.example.test/media', mime_type: message_type === 'document' ? 'application/pdf' : `${message_type}/example` };
    await send({ message: '', ...media });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({ message: '', ...media });
  });
  it('makes ambiguous media timeout terminal and never retries as text', async () => {
    post.mockRejectedValue(new Error('timeout'));
    await expect(send({ message: '', message_type: 'image', media_url: 'https://assets.example.test/a.jpg' }))
      .rejects.toMatchObject({ nonRetryable: true, type: 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN' });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('rejects media template substitution', async () => {
    post.mockResolvedValue({ success: true, data: { template_required: true } });
    await expect(send({ message: '', message_type: 'image', media_url: 'https://assets.example.test/a.jpg' })).rejects.toMatchObject({ nonRetryable: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(['text', 'audio'])('forwards %s and preserves message_id', async response_format => {
    await send({ response_format });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({ response_format, message_id: messageId });
  });
  it('omits format for legacy delivery', async () => {
    await send({});
    expect(post.mock.calls[0][1]).not.toHaveProperty('response_format');
  });
  it('rejects audio without message_id before HTTP', async () => {
    await expect(send({ response_format: 'audio', message_id: undefined }))
      .rejects.toMatchObject({ nonRetryable: true, type: 'AUDIO_MESSAGE_ID_REQUIRED' });
    expect(post).not.toHaveBeenCalled();
  });
  it('does not retry an ambiguous audio send', async () => {
    post.mockRejectedValue(new Error('timeout'));
    await expect(send({ response_format: 'audio' })).rejects.toMatchObject({ nonRetryable: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('does not accept template_required as audio success', async () => {
    post.mockResolvedValue({ success: true, data: { template_required: true } });
    await expect(send({ response_format: 'audio' })).rejects.toMatchObject({ nonRetryable: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

it('forwards explicit support format and retains the API selection', async () => {
  const data = { response_format: 'audio', messages: { assistant: { content: 'Hello', message_id: messageId } } };
  post.mockResolvedValue({ success: true, data });
  await expect(sendCustomerSupportMessageActivity({ message: 'Help', site_id: 'site', response_format: 'audio' }, { origin: 'telegram' }))
    .resolves.toEqual({ success: true, data });
  expect(post.mock.calls[0][1]).toMatchObject({ response_format: 'audio' });
});

it('propagates support selection only under the replay patch and honors explicit override', () => {
  const args = { csResponse: { response_format: 'audio' as const, messages: { assistant: { content: 'Hello', message_id: messageId } } },
    whatsappData: { phoneNumber: '+15555550100', siteId: 'site' } };
  expect(buildWhatsAppSendParams(args)).not.toHaveProperty('response_format');
  expect(buildWhatsAppSendParams({ ...args, useResponseFormat: true }))
    .toMatchObject({ response_format: 'audio', message_id: messageId });
  expect(buildWhatsAppSendParams({ ...args, useResponseFormat: true, response_format: 'text' }))
    .toMatchObject({ response_format: 'text' });
  expect(customerSupportResponseFormat({ messages: { assistant: { response_format: 'audio' } } })).toBe('audio');
  expect(responseFormatFields(undefined)).toEqual({});
});

it('preserves original saved audio content without trimming', () => {
  const content = '  Spoken reply\n';
  expect(buildWhatsAppSendParams({
    useResponseFormat: true,
    csResponse: { response_format: 'audio', messages: { assistant: { content, message_id: messageId } } },
    whatsappData: { phoneNumber: '+15555550100', siteId: 'site' },
  })).toHaveProperty('message', content);
});

it('accepts media-only support responses and preserves canonical fields under the new replay patch', async () => {
  const media = { message_type: 'image' as const, media_url: 'https://assets.example.test/a.jpg', mime_type: 'image/jpeg' };
  const data = { messages: { assistant: { content: '', message_id: messageId, custom_data: media } } };
  post.mockResolvedValue({ success: true, data });
  await expect(sendCustomerSupportMessageActivity({ message: 'Help', site_id: 'site' }, { origin: 'telegram' }))
    .resolves.toEqual({ success: true, data });
  const args = { csResponse: data, whatsappData: { phoneNumber: '+15555550100', siteId: 'site' } };
  expect(buildWhatsAppSendParams(args)).toBeNull();
  expect(buildWhatsAppSendParams({ ...args, useOutboundMedia: true })).toMatchObject({ message: '', message_id: messageId, ...media });
});