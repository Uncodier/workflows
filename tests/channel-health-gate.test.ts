import { availableOutboundChannels } from '../src/temporal/activities/daily-prospection/outboundHealth';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const recent = new Date(NOW - 60_000).toISOString();
const stale = new Date(NOW - 25 * 60 * 60_000).toISOString();

describe('outbound channel health gate', () => {
  const configured = { email: true, whatsapp: true };

  it('requires a successful outbound delivery within 24 hours', () => {
    expect(availableOutboundChannels(configured, [], NOW)).toEqual({ email: false, whatsapp: false });
    expect(availableOutboundChannels(configured, [
      { channel: 'email', status: 'healthy', updated_at: recent, last_success_at: stale },
      { channel: 'whatsapp', status: 'healthy', updated_at: recent, last_success_at: recent },
    ], NOW)).toEqual({ email: false, whatsapp: true });
  });

  it('does not make a disabled channel available even with a good history', () => {
    expect(availableOutboundChannels({ email: false, whatsapp: true }, [
      { channel: 'email', status: 'healthy', updated_at: recent, last_success_at: recent },
    ], NOW)).toEqual({ email: false, whatsapp: false });
  });

  it('does not use a channel with an unhealthy verdict or future/stale timestamp', () => {
    expect(availableOutboundChannels(configured, [
      { channel: 'email', status: 'unhealthy', updated_at: recent, last_success_at: recent },
      { channel: 'whatsapp', status: 'healthy', updated_at: stale, last_success_at: recent },
    ], NOW)).toEqual({ email: false, whatsapp: false });
  });

  it('does not assume a degraded channel can fund new AI work', () => {
    expect(availableOutboundChannels(configured, [
      { channel: 'email', status: 'degraded', updated_at: recent, last_success_at: recent },
    ], NOW)).toEqual({ email: false, whatsapp: false });
  });

  it('does not infer health from inbound events or unknown observation', () => {
    expect(availableOutboundChannels(configured, [
      { channel: 'email', status: 'unknown', updated_at: recent, last_success_at: recent },
    ], NOW)).toEqual({ email: false, whatsapp: false });
  });

  it('requires a success after the latest recorded failure', () => {
    expect(availableOutboundChannels(configured, [
      { channel: 'email', status: 'healthy', updated_at: recent,
        last_success_at: new Date(NOW - 120_000).toISOString(), last_failure_at: recent },
    ], NOW)).toEqual({ email: false, whatsapp: false });
  });

  it('requires fresh proof after a reconfiguration', () => {
    expect(availableOutboundChannels(configured, [
      { channel: 'email', status: 'healthy', updated_at: recent,
        last_success_at: new Date(NOW - 120_000).toISOString(), reset_at: recent },
      { channel: 'whatsapp', status: 'healthy', updated_at: recent,
        last_success_at: recent, reset_at: new Date(NOW - 120_000).toISOString() },
    ], NOW)).toEqual({ email: false, whatsapp: true });
  });

});