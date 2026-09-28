import { validateCommunicationChannelsActivity } from './validate';

export class OutboundChannelUnavailable extends Error {
  constructor() { super('No available outbound channel'); }
}

export function isOutboundChannelUnavailable(error: unknown): error is OutboundChannelUnavailable {
  return error instanceof OutboundChannelUnavailable;
}

/** Cheap, server-side last line of defense before chargeable outbound AI calls. */
export async function assertOutboundChannelAvailable(siteId: string): Promise<void> {
  const result = await validateCommunicationChannelsActivity({
    site_id: siteId,
    requireHealthyOutbound: true,
  });
  if (!result.success) throw new Error('Outbound channel health unavailable');
  if (!result.hasAnyChannel) throw new OutboundChannelUnavailable();
}