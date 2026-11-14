import { outboundMediaFields, customerSupportMedia } from '../src/temporal/workflows/helpers/outboundMedia';

test.each(['image', 'video', 'audio', 'document'])('preserves canonical %s metadata exactly', message_type => {
  const media = { message_type, media_url: 'https://assets.example.test/file', mime_type: `${message_type}/example` };
  expect(outboundMediaFields(media)).toEqual(media);
  expect(customerSupportMedia({ messages: { assistant: { custom_data: media } } })).toEqual(media);
});
test.each([
  { media_url: 'https://assets.example.test/file' },
  { message_type: 'image' },
  { message_type: 'text', media_url: 'https://assets.example.test/file' },
  { message_type: 'image', media_url: 'http://assets.example.test/file' },
  { message_type: 'image', media_url: 'https://assets.example.test/file', mime_type: 123 },
])('refuses malformed explicit media rather than returning text fields: %j', media => {
  expect(() => outboundMediaFields(media)).toThrow();
});
test('does not attach inbound user media to an assistant text reply', () => {
  expect(customerSupportMedia({ messages: { user: { message_type: 'image', media_url: 'https://assets.example.test/input' },
    assistant: { content: 'Text reply' } } })).toEqual({});
});