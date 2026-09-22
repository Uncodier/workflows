import { resolveApprovedMessageDispatch } from '../src/temporal/workflows/helpers/approvedMessageDispatch';

describe('approved message dispatch', () => {
  it.each([
    ['whatsapp', undefined, 'whatsapp-child'],
    ['sms', undefined, 'generic-channel-child'],
    ['telegram', undefined, 'generic-channel-child'],
    ['voice', 'tts', 'generic-channel-child'],
    ['voice', undefined, 'generic-channel-child'],
    ['voice', 'agent_call', 'voice-call-child'],
    ['email', undefined, 'email-activity'],
  ])('routes %s/%s to %s', (channel, voiceMode, expected) => {
    expect(resolveApprovedMessageDispatch(channel, voiceMode)).toBe(expected);
  });
});
