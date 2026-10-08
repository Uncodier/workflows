const activityOptions: unknown[] = [];
const mockActivities = {
  fetchSitesNeedingInitializationActivity: jest.fn(),
  initializeSiteCreditsActivity: jest.fn(),
  fetchSitesDueForCreditRenewalActivity: jest.fn(),
  renewSiteCreditsActivity: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: unknown) => { activityOptions.push(options); return mockActivities; },
}));

import { dailyCreditRenewalWorkflow } from '../src/temporal/workflows/dailyCreditRenewalWorkflow';

describe('daily credit renewal orchestration', () => {
  it('bounds activity retries so a persistently failing site cannot block later sites', () => {
    expect(activityOptions).toEqual([expect.objectContaining({
      startToCloseTimeout: '5m',
      scheduleToCloseTimeout: '15m',
      retry: expect.objectContaining({ maximumAttempts: 3 }),
    })]);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockActivities.fetchSitesNeedingInitializationActivity.mockResolvedValue([]);
    mockActivities.fetchSitesDueForCreditRenewalActivity.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  it('counts only real grants/resets, not RPC no-ops', async () => {
    mockActivities.fetchSitesNeedingInitializationActivity.mockResolvedValue(['new', 'existing']);
    mockActivities.initializeSiteCreditsActivity
      .mockResolvedValueOnce({ success: true, outcome: 'initialized' })
      .mockResolvedValueOnce({ success: true, outcome: 'already_initialized' });
    const outcomes = ['reset', 'not_due', 'stale_period', 'stripe_managed', 'inactive'];
    mockActivities.fetchSitesDueForCreditRenewalActivity.mockResolvedValue(
      outcomes.map((outcome) => ({ site_id: outcome }))
    );
    for (const outcome of outcomes) {
      mockActivities.renewSiteCreditsActivity.mockResolvedValueOnce({ success: true, outcome });
    }

    await expect(dailyCreditRenewalWorkflow()).resolves.toEqual({
      processed: 1, errors: 0, initialized: 1, initErrors: 0,
    });
    expect(mockActivities.renewSiteCreditsActivity).toHaveBeenCalledTimes(5);
  });

  it('does not lose later sites when an activity fails', async () => {
    mockActivities.fetchSitesNeedingInitializationActivity.mockResolvedValue(['bad-init']);
    mockActivities.initializeSiteCreditsActivity.mockRejectedValue(new Error('RPC unavailable'));
    mockActivities.fetchSitesDueForCreditRenewalActivity.mockResolvedValue([
      { site_id: 'bad-renewal' }, { site_id: 'good-renewal' },
    ]);
    mockActivities.renewSiteCreditsActivity
      .mockRejectedValueOnce(new Error('RPC unavailable'))
      .mockResolvedValueOnce({ success: true, outcome: 'reset' });

    await expect(dailyCreditRenewalWorkflow()).resolves.toEqual({
      processed: 1, errors: 1, initialized: 0, initErrors: 1,
    });
  });

  it('retains command arguments and counts historical activity results during replay', async () => {
    mockActivities.fetchSitesNeedingInitializationActivity.mockResolvedValue(['legacy-init']);
    mockActivities.initializeSiteCreditsActivity.mockResolvedValue(undefined);
    const site = {
      site_id: 'legacy-site', plan: 'startup', credits_available: 75,
      stripe_subscription_id: null,
    };
    mockActivities.fetchSitesDueForCreditRenewalActivity.mockResolvedValue([site]);
    mockActivities.renewSiteCreditsActivity.mockResolvedValue({ success: true, oldCredits: 75, newCredits: 175 });

    await expect(dailyCreditRenewalWorkflow()).resolves.toEqual({
      processed: 1, errors: 0, initialized: 1, initErrors: 0,
    });
    expect(mockActivities.renewSiteCreditsActivity).toHaveBeenCalledWith(
      site.site_id, site.plan, site.credits_available, site.stripe_subscription_id
    );
  });

  it('fails discovery errors rather than treating renewal as successful', async () => {
    mockActivities.fetchSitesDueForCreditRenewalActivity.mockRejectedValue(new Error('Discovery unavailable'));
    await expect(dailyCreditRenewalWorkflow()).rejects.toThrow('Discovery unavailable');
  });
});