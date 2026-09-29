const mockFetchSites = jest.fn();
const mockFetchCompleteSettings = jest.fn();
const mockGetConnectionStatus = jest.fn();
const mockStartWorkflow = jest.fn();
const mockSaveCronStatus = jest.fn();

jest.mock('../src/temporal/client', () => ({
  getTemporalClient: async () => ({ workflow: { start: mockStartWorkflow } }),
}));
jest.mock('../src/config/config', () => ({ temporalConfig: { taskQueue: 'test-queue' } }));
jest.mock('../src/temporal/services', () => ({}));
jest.mock('../src/temporal/activities/cronActivities', () => ({ saveCronStatusActivity: mockSaveCronStatus }));
jest.mock('../src/temporal/activities/supabaseActivities', () => ({}));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {} }));
jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({
    fetchSites: mockFetchSites, fetchCompleteSettings: mockFetchCompleteSettings,
    getConnectionStatus: mockGetConnectionStatus,
  }),
}));

import {
  executeDailyStandUpWorkflowsActivity,
  scheduleIndividualDailyStandUpsActivity,
} from '../src/temporal/activities/workflowSchedulingActivities';
import { nextDailyStandUpRun } from '../src/temporal/utils/dailyStandUpScheduling';
import { DAILY_WORKFLOW_REUSE_POLICY } from '../src/temporal/utils/workflowIdHelper';

const key = 'daily_resume_and_stand_up';
const site = { id: 'site-1', name: 'Test site', user_id: 'user-1' };
const settings = (weekdays: number[] = [2], timezone = 'UTC', days: any = {}) => ({
  site_id: site.id,
  activities: { [key]: { status: 'active', weekdays, report_sections: ['sales', 'orders'] } },
  business_hours: [{ timezone, days }],
});

describe('next configured local Daily Standup', () => {
  it.each([
    ['selected Tuesday', '2026-09-29T08:00:00Z', 'UTC', [2], '2026-09-29T09:00:00.000Z'],
    ['exact opening', '2026-09-29T09:00:00Z', 'UTC', [2], '2026-09-29T09:00:00.000Z'],
    ['opening just passed', '2026-09-29T09:00:00.001Z', 'UTC', [2], '2026-10-06T09:00:00.000Z'],
    ['next selected day, not tomorrow', '2026-09-29T10:00:00Z', 'UTC', [2, 5], '2026-10-02T09:00:00.000Z'],
    ['closed selected Saturday', '2026-10-03T08:00:00Z', 'UTC', [6], '2026-10-03T09:00:00.000Z'],
    ['closed selected Sunday', '2026-10-04T08:00:00Z', 'UTC', [0], '2026-10-04T09:00:00.000Z'],
    ['local day ahead of UTC', '2026-09-28T14:00:00Z', 'Pacific/Kiritimati', [2], '2026-09-28T19:00:00.000Z'],
    ['local day behind UTC', '2026-09-29T01:00:00Z', 'America/Los_Angeles', [1], '2026-10-05T16:00:00.000Z'],
    ['quarter-hour offset', '2026-09-29T02:00:00Z', 'Asia/Kathmandu', [2], '2026-09-29T03:15:00.000Z'],
    ['fall-back DST', '2026-10-31T20:00:00Z', 'America/New_York', [0], '2026-11-01T14:00:00.000Z'],
    ['spring-forward DST', '2026-03-07T20:00:00Z', 'America/New_York', [0], '2026-03-08T13:00:00.000Z'],
    ['half-hour DST', '2026-10-03T21:00:00Z', 'Australia/Lord_Howe', [0], '2026-10-03T22:00:00.000Z'],
  ])('%s', (_label, now, timezone, weekdays, expected) => {
    expect(nextDailyStandUpRun(settings(weekdays, timezone), new Date(now))?.targetTime.toISOString()).toBe(expected);
  });

  it.each([
    { enabled: true, start: '10:30', end: '18:00' },
    { enabled: true, open: '10:30', close: '18:00' },
    { start: '10:30', end: '18:00' },
  ])('uses the selected day opening (%j)', day => {
    expect(nextDailyStandUpRun(settings([2], 'UTC', { tuesday: day }), new Date('2026-09-29T08:00:00Z')))
      .toMatchObject({ targetTime: new Date('2026-09-29T10:30:00Z'), scheduledTime: '10:30', fallbackUsed: false });
  });

  it('uses the next selected day opening, not today’s opening', () => {
    const config = settings([2, 5], 'UTC', {
      tuesday: { enabled: true, start: '08:30' }, friday: { enabled: true, start: '11:00' },
    });
    expect(nextDailyStandUpRun(config, new Date('2026-09-29T09:00:00Z'))?.targetTime.toISOString()).toBe('2026-10-02T11:00:00.000Z');
  });

  it('supports legacy direct day objects', () => {
    const config = { ...settings(), business_hours: { timezone: 'UTC', tuesday: { open: '10:30' } } };
    expect(nextDailyStandUpRun(config, new Date('2026-09-29T08:00:00Z'))?.targetTime.toISOString()).toBe('2026-09-29T10:30:00.000Z');
  });

  it.each([
    undefined, {}, { enabled: false, start: '10:30' },
    { enabled: true, start: '24:00' }, { enabled: true, open: '09:60' },
    { enabled: true, start: null }, { enabled: true, start: 'bad' },
  ])('falls back to 09:00 on an explicitly selected weekend with unusable hours (%j)', day => {
    expect(nextDailyStandUpRun(settings([6], 'UTC', { saturday: day }), new Date('2026-10-03T08:00:00Z')))
      .toMatchObject({ targetTime: new Date('2026-10-03T09:00:00Z'), fallbackUsed: true });
  });

  it('uses the first valid minute when a selected opening falls in a DST gap', () => {
    const config = settings([0], 'America/New_York', { sunday: { enabled: true, start: '02:30' } });
    expect(nextDailyStandUpRun(config, new Date('2026-03-08T05:00:00Z'))?.targetTime.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
});

describe('Daily Standup scheduling activities', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T08:00:00Z'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchSites.mockResolvedValue([site]);
    mockFetchCompleteSettings.mockResolvedValue([settings()]);
    mockGetConnectionStatus.mockResolvedValue(true);
    mockStartWorkflow.mockImplementation(async (_type, options) => ({ workflowId: options.workflowId }));
    mockSaveCronStatus.mockResolvedValue(undefined);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('reloads complete settings, ignores stale analysis/map/timezone, and does not snapshot report sections', async () => {
    mockFetchCompleteSettings.mockResolvedValue([settings([2], 'America/New_York', { tuesday: { enabled: true, start: '10:30' } })]);
    const result = await scheduleIndividualDailyStandUpsActivity({ openSites: [] }, {
      activitiesMap: { [site.id]: { [key]: { status: 'inactive' } } }, timezone: 'UTC', parentScheduleId: 'parent',
    });
    expect(result).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockFetchCompleteSettings).toHaveBeenCalledWith([site.id]);
    const [workflow, options] = mockStartWorkflow.mock.calls[0];
    expect(workflow).toBe('delayedExecutionWorkflow');
    expect(options).toMatchObject({
      workflowId: 'daily-standup-timer-site-1-2026-09-29-1030', workflowIdReusePolicy: DAILY_WORKFLOW_REUSE_POLICY,
      workflowRunTimeout: '48h', taskQueue: 'test-queue',
    });
    expect(options.args[0]).toMatchObject({ targetWorkflow: 'dailyStandUpWorkflow', delayMs: 6.5 * 3600000 });
    expect(options.args[0].targetArgs[0]).toMatchObject({
      site_id: site.id, userId: site.user_id,
      additionalData: { targetTimeUTC: '2026-09-29T14:30:00.000Z', timezone: 'America/New_York', parentScheduleId: 'parent' },
    });
    expect(JSON.stringify(options.args)).not.toMatch(/reportSections|report_sections/);
    expect(mockSaveCronStatus).toHaveBeenCalledWith(expect.objectContaining({
      siteId: site.id, workflowId: options.workflowId, nextRun: '2026-09-29T14:30:00.000Z', status: 'SCHEDULED',
    }));
  });

  it('uses the target local date in the workflow ID across UTC rollover', async () => {
    jest.setSystemTime(new Date('2026-09-28T14:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings([2], 'Pacific/Kiritimati')]);
    await scheduleIndividualDailyStandUpsActivity(undefined);
    expect(mockStartWorkflow.mock.calls[0][1].workflowId).toBe('daily-standup-timer-site-1-2026-09-29-0900');
    expect(mockSaveCronStatus.mock.calls[0][0].nextRun).toBe('2026-09-28T19:00:00.000Z');
  });

  it('defaults missing weekdays to Monday/Friday and timezone to Mexico', async () => {
    mockFetchCompleteSettings.mockResolvedValue([{ site_id: site.id, activities: { [key]: { status: 'active' } } }]);
    await scheduleIndividualDailyStandUpsActivity(undefined, { timezone: 'UTC' });
    expect(mockSaveCronStatus.mock.calls[0][0].nextRun).toBe('2026-10-02T15:00:00.000Z');
  });

  it('preserves enough timeout for a weekly selection across a 169-hour DST week', async () => {
    jest.setSystemTime(new Date('2026-10-25T13:00:00.001Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings([0], 'America/New_York')]);
    await scheduleIndividualDailyStandUpsActivity(undefined);
    expect(mockSaveCronStatus.mock.calls[0][0].nextRun).toBe('2026-11-01T14:00:00.000Z');
    const options = mockStartWorkflow.mock.calls[0][1];
    expect(options.workflowRunTimeout).toBe('171h');
    expect(parseInt(options.workflowRunTimeout) * 3600000).toBeGreaterThan(options.args[0].delayMs);
  });

  it('treats an existing timer as successfully scheduled without creating another ID', async () => {
    mockStartWorkflow.mockRejectedValue(new Error('Workflow execution already started'));
    expect(await scheduleIndividualDailyStandUpsActivity(undefined)).toMatchObject({ scheduled: 1, failed: 0 });
    expect(mockStartWorkflow).toHaveBeenCalledTimes(1);
  });

  describe.each(['timer', 'direct', 'dry-run'])('%s eligibility', mode => {
    const run = () => mode === 'timer' ? scheduleIndividualDailyStandUpsActivity({ openSites: [] }, {
      activitiesMap: { [site.id]: { [key]: { status: 'active' } } },
    }) : executeDailyStandUpWorkflowsActivity({ dryRun: mode === 'dry-run', businessHoursAnalysis: { openSites: [] } });

    it.each([
      ['inactive', { status: 'inactive' }], ['default', { status: 'default' }], ['missing status', {}],
      ['empty weekdays', { status: 'active', weekdays: [] }], ['invalid weekday', { status: 'active', weekdays: [7] }],
      ['empty sections', { status: 'active', report_sections: [] }], ['invalid section', { status: 'active', report_sections: ['secret'] }],
    ])('fails closed for %s despite embedded active settings', async (_label, config) => {
      mockFetchSites.mockResolvedValue([{ ...site, settings: settings() }]);
      mockFetchCompleteSettings.mockResolvedValue([{ ...settings(), activities: { [key]: config } }]);
      expect(await run()).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('fails closed for missing settings', async () => {
      mockFetchCompleteSettings.mockResolvedValue([]);
      expect(await run()).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('fails closed for an invalid site timezone', async () => {
      mockFetchCompleteSettings.mockResolvedValue([settings([2], 'Invalid/Zone')]);
      expect(await run()).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('does not dispatch when complete settings cannot be read', async () => {
      mockFetchCompleteSettings.mockRejectedValue(new Error('Settings unavailable'));
      expect(await run()).toMatchObject({ scheduled: 0, failed: 1, errors: ['Settings unavailable'] });
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });
  });

  it('direct execution honors an explicit closed weekend outside the openSites list', async () => {
    jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings([6])]);
    expect(await executeDailyStandUpWorkflowsActivity({ businessHoursAnalysis: { openSites: [{ siteId: 'other-site' }] } }))
      .toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow.mock.calls[0][0]).toBe('dailyStandUpWorkflow');
    expect(mockStartWorkflow.mock.calls[0][1].workflowId).toBe('daily-standup-site-1-2026-10-03');
  });

  it('direct execution uses the current local day for eligibility and workflow ID', async () => {
    jest.setSystemTime(new Date('2026-09-29T01:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings([1], 'America/Los_Angeles')]);
    expect(await executeDailyStandUpWorkflowsActivity()).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow.mock.calls[0][1].workflowId).toBe('daily-standup-site-1-2026-09-28');
    mockStartWorkflow.mockClear();
    mockFetchCompleteSettings.mockResolvedValue([settings([2], 'America/Los_Angeles')]);
    expect(await executeDailyStandUpWorkflowsActivity()).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('testMode still forces dry run after validating the selected weekday', async () => {
    expect(await executeDailyStandUpWorkflowsActivity({ testMode: true })).toMatchObject({ scheduled: 1 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });
});