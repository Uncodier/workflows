import { isOutreachChannelKey } from './outreachConfiguration';

function nonDirectIdentity(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  return Object.keys(data).some(key => key.startsWith('outstand_') || ['comment_id', 'post_id', 'social_comment_id'].includes(key))
    || /outstand|comment/i.test(String(data.source || '')) || /outstand|comment/i.test(String(data.provider || ''))
    || /comment/i.test(String(data.type || ''));
}

/** Mirrors API outreach/recipients: never guess a platform identity from a phone or URL. */
export function hasOutreachRecipient(lead: any, channel: string, conversations: any[] = [], siteId = lead?.site_id): boolean {
  if (!lead || !isOutreachChannelKey(channel) || (lead.site_id && lead.site_id !== siteId)) return false;
  if (channel === 'email') return typeof lead.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)
    && lead.email !== 'no-email@example.com';
  if (['whatsapp', 'sms', 'voice'].includes(channel)) {
    if (typeof lead.phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(lead.phone)) return false;
    return channel !== 'voice' || (lead.do_not_call !== true && lead.voice_call_consent_status === 'granted'
      && typeof lead.voice_call_consent_at === 'string' && Number.isFinite(Date.parse(lead.voice_call_consent_at)));
  }
  const keys = ['channel_user_id', 'chat_id', 'external_user_id', 'recipient_id', 'recipient', 'user_id', 'username', 'id'];
  const own = (value: any, key: string) => value && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  const identity = (value: unknown): boolean => typeof value === 'string' && /^[a-zA-Z0-9_@.-]{1,128}$/.test(value)
    && value !== '.' && !value.includes('..');
  const channelIdentity = (value: any): boolean => identity(value) || (!!value && typeof value === 'object' && !Array.isArray(value)
    && !nonDirectIdentity(value) && (!value.channel || value.channel === channel) && keys.some(key => identity(own(value, key))));
  const matching = conversations.filter(conversation => {
    const data = conversation.custom_data || {};
    return conversation.site_id === siteId && conversation.lead_id === lead.id && conversation.channel === channel
      && (!data.channel || data.channel === channel) && !nonDirectIdentity(data);
  });
  if (matching.some(conversation => {
    const data = conversation.custom_data || {};
    return channelIdentity(own(data, channel)) || channelIdentity(own(data, 'identities')?.[channel])
      || keys.filter(key => key !== 'id').some(key => identity(own(data, key)))
      || identity(data.phone) || identity(data.phone_number);
  })) return true;
  const socialOnly = nonDirectIdentity(lead.metadata)
    || conversations.some(conversation => conversation.site_id === siteId && conversation.lead_id === lead.id
      && conversation.channel === channel && nonDirectIdentity(conversation.custom_data))
    || (lead.metadata?.social_network === channel && !!lead.metadata?.social_handle);
  if (!socialOnly && channelIdentity(own(lead.social_networks, channel))) return true;
  // Older channel webhooks stored their source identity in phone. Use it only
  // when the lead origin corroborates the channel, never just because it exists.
  return !socialOnly && lead.origin === channel && identity(lead.phone);
}