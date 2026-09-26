import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockPrepare = jest.fn<(...args: any[]) => Promise<any>>();
const mockAdvance = jest.fn<(...args: any[]) => Promise<any>>();
const mockResult = jest.fn<(...args: any[]) => Promise<any>>();
const mockSleep = jest.fn<(...args: any[]) => Promise<void>>();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    prepareChannelGuidanceActivity: mockPrepare,
    advanceChannelGuidanceActivity: mockAdvance,
    resultChannelGuidanceActivity: mockResult,
  }),
  sleep: mockSleep,
  CancellationScope: { withTimeout: async (_timeout: number, fn: () => Promise<any>) => fn() },
  isCancellation: (error: any) => error?.name === 'CancelledFailure',
}));

import { runChannelGuidance } from '../src/temporal/workflows/helpers/runChannelGuidance';

const websiteData = {
  site_id: 'site-1',
  origin_message_id: 'inbound-1',
  message: 'Could you help?',
  conversation_id: 'conversation-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  // The deadline timer is never reached in tests unless explicitly simulated.
  mockSleep.mockImplementation(async (duration: number) => {
    if (duration === 240_000) return new Promise<void>(() => {});
  });
  mockPrepare.mockResolvedValue({ runs: [{ runPlanId: 'plan-1', status: 'pending' }] });
  mockAdvance.mockResolvedValue({ status: 'completed' });
  mockResult.mockResolvedValue({ guidance: 'Brief, bounded advice' });
});

describe('runChannelGuidance', () => {
  it('prepares website_chat as web and passes only completed run IDs', async () => {
    await expect(runChannelGuidance(websiteData, { origin: 'website_chat' })).resolves.toEqual(['plan-1']);
    expect(mockPrepare).toHaveBeenCalledWith({
      siteId: 'site-1', messageId: 'inbound-1', channel: 'web',
      conversationId: 'conversation-1', message: 'Could you help?',
    });
    expect(mockAdvance).toHaveBeenCalledWith({ siteId: 'site-1', messageId: 'inbound-1', runPlanId: 'plan-1' });
    expect(mockResult).toHaveBeenCalledWith({ siteId: 'site-1', messageId: 'inbound-1', channel: 'web', runPlanIds: ['plan-1'] });
  });

  it('takes WhatsApp provider id/content even without a conversation', async () => {
    await runChannelGuidance({ whatsappData: {
      siteId: 'site-2', messageId: 'provider-message-1', messageContent: 'Hi',
    } }, { origin: 'whatsapp' });
    expect(mockPrepare).toHaveBeenCalledWith({
      siteId: 'site-2', messageId: 'provider-message-1', channel: 'whatsapp', message: 'Hi',
    });
  });

  it('does not invent identifiers for legacy emails without a provider id', async () => {
    await expect(runChannelGuidance({ site_id: 'site-3', analysis_id: 'analysis-1', original_text: 'Help' },
      { origin: 'email' })).resolves.toEqual([]);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('honors explicit email and social origin message ids', async () => {
    await runChannelGuidance({ site_id: 'site-1', original_text: 'Email content', origin_message_id: 'email-1' },
      { origin: 'email' });
    expect(mockPrepare).toHaveBeenCalledWith({ siteId: 'site-1', messageId: 'email-1', channel: 'email', message: 'Email content' });
    await runChannelGuidance({ site_id: 'site-1', message: 'Comment', origin_message_id: 'social-1' },
      { origin: 'instagram' });
    expect(mockPrepare).toHaveBeenCalledWith({ siteId: 'site-1', messageId: 'social-1', channel: 'instagram', message: 'Comment' });
  });

  it('handles ten prepared runs, never silently dropping the ninth or tenth', async () => {
    mockPrepare.mockResolvedValue({ runs: Array.from({ length: 10 }, (_, i) => ({ runPlanId: `plan-${i}`, status: 'completed' })) });
    const ids = await runChannelGuidance(websiteData, { origin: 'web' });
    expect(ids).toHaveLength(10);
    expect(ids[9]).toBe('plan-9');
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('fails closed if prepare supplies more than the shared 10-run cap', async () => {
    mockPrepare.mockResolvedValue({ runs: Array.from({ length: 11 }, (_, i) => ({ runPlanId: `plan-${i}`, status: 'completed' })) });
    await expect(runChannelGuidance(websiteData, { origin: 'web' })).resolves.toEqual([]);
    expect(mockResult).not.toHaveBeenCalled();
  });

  it('limits simultaneous advance calls to two, polling busy runs before completion', async () => {
    mockPrepare.mockResolvedValue({ runs: ['a', 'b', 'c'].map(runPlanId => ({ runPlanId, status: 'pending' })) });
    let active = 0;
    let peak = 0;
    let firstBusy = true;
    mockAdvance.mockImplementation(async ({ runPlanId }: { runPlanId: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      if (runPlanId === 'a' && firstBusy) {
        firstBusy = false;
        return { status: 'already_running' };
      }
      return { status: 'completed' };
    });
    await expect(runChannelGuidance(websiteData, { origin: 'web' })).resolves.toEqual(['a', 'b', 'c']);
    expect(peak).toBeLessThanOrEqual(2);
    expect(mockSleep).toHaveBeenCalledWith(4_000);
  });

  it('forwards completed runs only and never waits for failed runs', async () => {
    mockPrepare.mockResolvedValue({ runs: [{ runPlanId: 'done', status: 'completed' }, { runPlanId: 'bad', status: 'pending' }] });
    mockAdvance.mockResolvedValue({ status: 'failed' });
    expect(await runChannelGuidance(websiteData, { origin: 'web' })).toEqual(['done']);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
    expect(mockResult).toHaveBeenCalledWith({ siteId: 'site-1', messageId: 'inbound-1', channel: 'web', runPlanIds: ['done'] });
  });

  it('fails open when prepare, advance, or result fails', async () => {
    mockPrepare.mockRejectedValue(new Error('unavailable'));
    expect(await runChannelGuidance(websiteData, { origin: 'web' })).toEqual([]);
    mockPrepare.mockResolvedValue({ runs: [{ runPlanId: 'pending', status: 'pending' }] });
    mockAdvance.mockRejectedValue(new Error('unavailable'));
    expect(await runChannelGuidance(websiteData, { origin: 'web' })).toEqual([]);
    mockAdvance.mockResolvedValue({ status: 'completed' });
    mockResult.mockRejectedValue(new Error('unavailable'));
    expect(await runChannelGuidance(websiteData, { origin: 'web' })).toEqual([]);
    mockResult.mockResolvedValue({ guidance: '' });
    expect(await runChannelGuidance(websiteData, { origin: 'web' })).toEqual([]);
  });
});

it('catches the four-minute cancellation and fails open without forwarding run IDs', async () => {
  const { CancellationScope } = jest.requireMock('@temporalio/workflow') as {
    CancellationScope: { withTimeout: jest.Mock };
  };
  const previous = CancellationScope.withTimeout;
  CancellationScope.withTimeout = jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValue(
    Object.assign(new Error('deadline'), { name: 'CancelledFailure' })
  );
  try {
    await expect(runChannelGuidance(websiteData, { origin: 'web' })).resolves.toEqual([]);
    expect(CancellationScope.withTimeout).toHaveBeenCalledWith(240_000, expect.any(Function));
    expect(mockResult).not.toHaveBeenCalled();
  } finally {
    CancellationScope.withTimeout = previous;
  }
});
