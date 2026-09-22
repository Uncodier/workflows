export type ApprovedMessageDispatch =
  | 'email-activity'
  | 'whatsapp-child'
  | 'generic-channel-child'
  | 'voice-call-child';

export function resolveApprovedMessageDispatch(
  channel: string,
  voiceMode?: unknown
): ApprovedMessageDispatch {
  const normalizedChannel = channel.trim().toLowerCase();

  if (normalizedChannel === 'email') {
    return 'email-activity';
  }

  if (normalizedChannel === 'whatsapp') {
    return 'whatsapp-child';
  }

  if (normalizedChannel === 'voice' && voiceMode === 'agent_call') {
    return 'voice-call-child';
  }

  return 'generic-channel-child';
}
