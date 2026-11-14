export interface OutboundMediaFields {
  message_type?: 'text' | 'image' | 'video' | 'audio' | 'document';
  media_url?: string;
  mime_type?: string;
}

/** Pure/deterministic shape validation. The API owns public DNS and channel capabilities. */
export function outboundMediaFields(value: any): OutboundMediaFields {
  if (!value || (value.media_url === undefined && value.mime_type === undefined
    && (value.message_type === undefined || value.message_type === 'text'))) return {};
  if (!['image', 'video', 'audio', 'document'].includes(value.message_type)
    || typeof value.media_url !== 'string' || !value.media_url.trim()) throw new Error('INVALID_OUTBOUND_MEDIA');
  const url = new URL(value.media_url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('INVALID_OUTBOUND_MEDIA');
  if (value.mime_type !== undefined && (typeof value.mime_type !== 'string'
    || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value.mime_type))) throw new Error('INVALID_OUTBOUND_MEDIA');
  return { message_type: value.message_type, media_url: value.media_url,
    ...(value.mime_type !== undefined ? { mime_type: value.mime_type } : {}) };
}

/** Assistant metadata wins; never attach the inbound user's media to the outgoing reply. */
export function customerSupportMedia(data: any): OutboundMediaFields {
  const assistant = data?.messages?.assistant;
  for (const candidate of [assistant, assistant?.custom_data, data]) {
    if (candidate && (candidate.message_type !== undefined || candidate.media_url !== undefined || candidate.mime_type !== undefined)) {
      return outboundMediaFields(candidate);
    }
  }
  return {};
}