export type ChannelHealthRecord = {
  channel: string;
  status: string;
  updated_at: string;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  reset_at?: string | null;
};

/** Chargeable work requires a positive outbound delivery signal within 24 hours. */
export function availableOutboundChannels(
  configured: { email: boolean; whatsapp: boolean },
  records: ChannelHealthRecord[],
  now: number = Date.now()
): { email: boolean; whatsapp: boolean } {
  const usable = (channel: string): boolean => records.some(record =>
    record.channel === channel && record.status === 'healthy' &&
    typeof record.last_success_at === 'string' &&
    Number.isFinite(Date.parse(record.last_success_at)) &&
    Date.parse(record.last_success_at) <= now &&
    now - Date.parse(record.last_success_at) < 24 * 60 * 60 * 1000 &&
    (!record.reset_at || (
      Number.isFinite(Date.parse(record.reset_at)) &&
      Date.parse(record.last_success_at) > Date.parse(record.reset_at)
    )) &&
    (!record.last_failure_at || (
      Number.isFinite(Date.parse(record.last_failure_at)) &&
      Date.parse(record.last_success_at) > Date.parse(record.last_failure_at)
    )) &&
    Number.isFinite(Date.parse(record.updated_at)) &&
    Date.parse(record.updated_at) <= now &&
    now - Date.parse(record.updated_at) < 24 * 60 * 60 * 1000
  );

  return {
    email: configured.email && usable('email'),
    whatsapp: configured.whatsapp && usable('whatsapp'),
  };
}