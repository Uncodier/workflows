const mockFetchSites = jest.fn();
const mockFetchCompleteSettings = jest.fn();
const mockGetConnectionStatus = jest.fn();
const mockStartWorkflow = jest.fn();
const mockFrom = jest.fn();

jest.mock('../src/temporal/client', () => ({
  getTemporalClient: async () => ({ workflow: { start: mockStartWorkflow } }),
}));
jest.mock('../src/config/config', () => ({ temporalConfig: { taskQueue: 'test-queue' } }));
jest.mock('../src/temporal/services', () => ({}));
jest.mock('../src/temporal/activities/cronActivities', () => ({}));
jest.mock('../src/temporal/activities/supabaseActivities', () => ({}));
jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({
    fetchSites: mockFetchSites,
    fetchCompleteSettings: mockFetchCompleteSettings,
    getConnectionStatus: mockGetConnectionStatus,
  }),
}));
jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: { from: mockFrom },
}));

import {
  executeDailyProspectionWorkflowsActivity,
  scheduleIndividualDailyProspectionActivity,
  scheduleLeadQualificationActivity,
} from '../src/temporal/activities/workflowSchedulingActivities';
import {
  localOutreachDay,
  nextOutreachRun,
  outreachTimezone,
} from '../src/temporal/utils/outreachConfiguration';
import { nextDailyStandUpRun } from '../src/temporal/utils/dailyStandUpScheduling';

const followup = 'leads_follow_up';
const cold = 'leads_initial_cold_outreach';
const site = { id: 'site-1', name: 'Test site', user_id: 'user-1' };
const activeConfig = { status: 'active', all_segments: true, channel_accounts: { email: ['email'] }, weekdays: [0] };
const settings = (config: Record<string, unknown> = activeConfig, timezone = 'America/New_York') => ({
  site_id: site.id,
  business_hours: [{ timezone }],
  channels: { email: { status: 'synced', email: 'sender@example.org' } },
  activities: { [followup]: config, [cold]: config },
});

describe('next outreach run at local 09:00', () => {
  it.each([
    ['same selected day', '2026-09-28T08:59:59.999Z', 'UTC', [1], '2026-09-28T09:00:00.000Z'],
    ['exact target instant', '2026-09-28T09:00:00.000Z', 'UTC', [1], '2026-09-28T09:00:00.000Z'],
    ['target has passed', '2026-09-28T09:00:00.001Z', 'UTC', [1], '2026-10-05T09:00:00.000Z'],
    ['fall-back DST weekend', '2026-10-31T20:00:00Z', 'America/New_York', [0], '2026-11-01T14:00:00.000Z'],
    ['quarter-hour offset', '2026-09-29T02:00:00Z', 'Asia/Kathmandu', [2], '2026-09-29T03:15:00.000Z'],
    ['half-hour DST shift', '2026-10-03T21:00:00Z', 'Australia/Lord_Howe', [0], '2026-10-03T22:00:00.000Z'],
    ['local date ahead of UTC', '2026-09-28T14:00:00Z', 'Pacific/Kiritimati', [2], '2026-09-28T19:00:00.000Z'],
    ['single weekday spanning fall-back', '2026-10-25T13:00:00.001Z', 'America/New_York', [0], '2026-11-01T14:00:00.000Z'],
  ])('%s', (_label, timestamp, timezone, weekdays, expected) => {
    const now = new Date(timestamp);
    const next = nextOutreachRun(now, timezone, weekdays);
    expect(next?.toISOString()).toBe(expected);
    expect(next!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(weekdays).toContain(localOutreachDay(next!, timezone).weekday);
  });

  it('does not substitute default weekdays for an empty selection', () => {
    expect(nextOutreachRun(new Date('2026-09-28T00:00:00Z'), 'UTC', [])).toBeNull();
  });

  it.each([
    ['custom exact target', '2026-09-29T16:15:00Z', 'UTC', [2], '16:15', '2026-09-29T16:15:00.000Z'],
    ['target just passed', '2026-09-29T16:15:00.001Z', 'UTC', [2, 5], '16:15', '2026-10-02T16:15:00.000Z'],
    ['local midnight', '2026-09-28T17:00:00Z', 'Asia/Kathmandu', [2], '00:00', '2026-09-28T18:15:00.000Z'],
    ['last local minute', '2026-09-29T22:00:00Z', 'UTC', [2], '23:59', '2026-09-29T23:59:00.000Z'],
    ['spring-forward gap', '2026-03-08T05:00:00Z', 'America/New_York', [0], '02:30', '2026-03-08T07:00:00.000Z'],
    ['half-hour spring-forward gap', '2026-10-03T14:00:00Z', 'Australia/Lord_Howe', [0], '02:15', '2026-10-03T15:30:00.000Z'],
    ['first fall-back occurrence', '2026-11-01T04:00:00Z', 'America/New_York', [0], '01:30', '2026-11-01T05:30:00.000Z'],
    ['second fall-back occurrence', '2026-11-01T05:30:00.001Z', 'America/New_York', [0], '01:30', '2026-11-01T06:30:00.000Z'],
  ])('custom start uses Standup DST policy: %s', (_label, timestamp, timezone, weekdays, startTime, expected) => {
    const now = new Date(timestamp);
    const next = nextOutreachRun(now, timezone, weekdays, startTime);
    expect(next?.toISOString()).toBe(expected);
    expect(next!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(weekdays).toContain(localOutreachDay(next!, timezone).weekday);
    expect(nextDailyStandUpRun({ business_hours: [{ timezone }], activities: {
      daily_resume_and_stand_up: { status: 'active', weekdays, start_time: startTime },
    } }, now)?.targetTime).toEqual(next);
  });

  it.each([null, '', '9:00', '24:00', 900])('does not fall back to 09:00 for an invalid supplied start: %j', startTime => {
    expect(nextOutreachRun(new Date('2026-09-29T00:00:00Z'), 'UTC', [2], startTime as string)).toBeNull();
  });

  it.each([
    ['missing 00:30', '2026-09-05T12:00:00Z', 'America/Santiago', '00:30', '2026-09-06T04:00:00.000Z'],
    ['missing midnight', '2026-09-05T12:00:00Z', 'America/Santiago', '00:00', '2026-09-06T04:00:00.000Z'],
    ['just before midnight gap', '2026-09-06T03:59:59.999Z', 'America/Santiago', '00:30', '2026-09-06T04:00:00.000Z'],
    ['exact gap boundary', '2026-09-06T04:00:00Z', 'America/Santiago', '00:30', '2026-09-06T04:00:00.000Z'],
    ['gap boundary just passed', '2026-09-06T04:00:00.001Z', 'America/Santiago', '00:30', '2026-09-13T03:30:00.000Z'],
    ['missing midnight boundary just passed', '2026-09-06T04:00:00.001Z', 'America/Santiago', '00:00', '2026-09-13T03:00:00.000Z'],
    ['ordinary midnight', '2026-09-05T12:00:00Z', 'UTC', '00:00', '2026-09-06T00:00:00.000Z'],
    ['ordinary boundary does not replace 00:30', '2026-09-05T12:00:00Z', 'UTC', '00:30', '2026-09-06T00:30:00.000Z'],
    ['ordinary Santiago midnight', '2026-09-12T12:00:00Z', 'America/Santiago', '00:00', '2026-09-13T03:00:00.000Z'],
    ['ordinary Santiago boundary does not replace 00:30', '2026-09-12T12:00:00Z', 'America/Santiago', '00:30', '2026-09-13T03:30:00.000Z'],
    ['ordinary midnight just passed', '2026-09-06T00:00:00.001Z', 'UTC', '00:00', '2026-09-13T00:00:00.000Z'],
    ['passed target is not caught up at the next ordinary boundary', '2026-09-06T00:30:00.001Z', 'UTC', '00:30', '2026-09-13T00:30:00.000Z'],
  ])('handles local date crossover: %s', (_label, timestamp, timezone, startTime, expected) => {
    const now = new Date(timestamp);
    const next = nextOutreachRun(now, timezone, [0], startTime);
    expect(next?.toISOString()).toBe(expected);
    expect(next!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(localOutreachDay(next!, timezone).weekday).toBe(0);
    expect(nextDailyStandUpRun({ business_hours: [{ timezone }], activities: {
      daily_resume_and_stand_up: { status: 'active', weekdays: [0], start_time: startTime },
    } }, now)?.targetTime).toEqual(next);
  });

  it.each([null, '', '0:30', '00:60', '24:00', '00:30\n', 30])('does not recover an invalid start at a midnight gap: %j', startTime => {
    expect(nextOutreachRun(new Date('2026-09-05T12:00:00Z'), 'America/Santiago', [0], startTime as string)).toBeNull();
  });

  it.each([{ weekdays: [] }, { weekdays: [7] }])('does not broaden an invalid or empty weekday selection at a midnight gap: %j', ({ weekdays }) => {
    expect(nextOutreachRun(new Date('2026-09-05T12:00:00Z'), 'America/Santiago', weekdays, '00:30')).toBeNull();
  });

  it.each([
    [{ business_hours: [{ timezone: 'Asia/Tokyo' }, { timezone: 'UTC' }] }, 'Asia/Tokyo'],
    [{ business_hours: { timezone: 'Asia/Kathmandu' } }, 'Asia/Kathmandu'],
    [{ business_hours: [{}, { timezone: 'UTC' }] }, 'America/Mexico_City'],
    [{ business_hours: [] }, 'America/Mexico_City'],
    [{ timezone: 'UTC' }, 'America/Mexico_City'],
  ])('uses the shared settings timezone contract: %j', (input, expected) => {
    expect(outreachTimezone(input)).toBe(expected);
  });
});

describe('outreach scheduling boundaries', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-07T20:00:00Z'));
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchSites.mockResolvedValue([{ ...site }]);
    mockFetchCompleteSettings.mockResolvedValue([settings()]);
    mockGetConnectionStatus.mockResolvedValue(true);
    mockStartWorkflow.mockImplementation(async (_type, options) => ({ workflowId: options.workflowId }));
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'sites') throw new Error(`Unexpected table: ${table}`);
      const query: any = {};
      query.select = jest.fn().mockReturnValue(query);
      query.eq = jest.fn().mockReturnValue(query);
      query.limit = jest.fn().mockReturnValue(query);
      query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [{ ...site }], error: null });
      return query;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('loads persisted follow-up settings and schedules a selected closed-site Sunday across DST', async () => {
    const result = await scheduleLeadQualificationActivity({ openSites: [] }, {
      activitiesMap: { [site.id]: { [followup]: { status: 'inactive' } } },
      timezone: 'UTC',
      parentScheduleId: 'parent-1',
    });

    expect(result).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockFetchCompleteSettings).toHaveBeenCalledWith([site.id]);
    expect(mockStartWorkflow).toHaveBeenCalledWith('delayedExecutionWorkflow', expect.objectContaining({
      workflowId: 'lead-qualification-timer-site-1-2026-03-08-0900',
      args: [expect.objectContaining({
        delayMs: Date.parse('2026-03-08T13:00:00Z') - Date.now(),
        targetWorkflow: 'leadQualificationWorkflow',
        scheduledTime: '09:00 America/New_York',
        targetArgs: [expect.objectContaining({
          site_id: site.id,
          additionalData: expect.objectContaining({
            outreach_activity: followup,
            targetTimeUTC: '2026-03-08T13:00:00.000Z',
            executionDay: '2026-03-08',
            timezone: 'America/New_York',
            parentScheduleId: 'parent-1',
          }),
        })],
      })],
    }));
  });

  it('keeps a single-weekday timer alive beyond seven days across fall-back DST', async () => {
    jest.setSystemTime(new Date('2026-10-25T13:00:00.001Z'));
    expect(await scheduleLeadQualificationActivity(undefined))
      .toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });

    const options = mockStartWorkflow.mock.calls[0][1];
    expect(options.args[0].delayMs).toBe(Date.parse('2026-11-01T14:00:00Z') - Date.now());
    expect(options.args[0].delayMs).toBeGreaterThan(168 * 60 * 60 * 1000);
    const timeoutMs = typeof options.workflowRunTimeout === 'number'
      ? options.workflowRunTimeout
      : Number.parseFloat(options.workflowRunTimeout) * 60 * 60 * 1000;
    expect(timeoutMs).toBeGreaterThanOrEqual(options.args[0].delayMs + 2 * 60 * 60 * 1000);
  });

  it('uses custom start for the timer ID, delay and metadata rather than 09:00 or opening hours', async () => {
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time: '02:30' })]);
    expect(await scheduleLeadQualificationActivity({ openSites: [] }, {
      activitiesMap: { [site.id]: { [followup]: { ...activeConfig, start_time: '09:00' } } },
    })).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    const options = mockStartWorkflow.mock.calls[0][1];
    expect(options.workflowId).toBe('lead-qualification-timer-site-1-2026-03-08-0230');
    expect(options.args[0]).toMatchObject({ delayMs: Date.parse('2026-03-08T07:00:00Z') - Date.now(),
      scheduledTime: '02:30 America/New_York', targetArgs: [{ additionalData: {
        scheduleTime: '02:30 America/New_York', targetTimeUTC: '2026-03-08T07:00:00.000Z', executionDay: '2026-03-08',
      } }] });
  });

  it.each([
    ['missing activity', {}],
    ['default status', { ...activeConfig, status: 'default' }],
    ['disabled activity', { ...activeConfig, status: 'inactive' }],
    ['empty weekdays', { ...activeConfig, weekdays: [] }],
    ['invalid weekday', { ...activeConfig, weekdays: [7] }],
    ['invalid start', { ...activeConfig, start_time: '24:00' }],
    ['empty start', { ...activeConfig, start_time: '' }],
    ['null start', { ...activeConfig, start_time: null }],
    ['no selected account', { ...activeConfig, channel_accounts: {} }],
    ['missing selected account', { ...activeConfig, channel_accounts: { email: ['missing'] } }],
    ['no selected segments', { ...activeConfig, all_segments: false }],
  ])('does not queue follow-up for %s despite a stale active activity map', async (_label, config) => {
    mockFetchCompleteSettings.mockResolvedValue([settings(config)]);
    const result = await scheduleLeadQualificationActivity(undefined, {
      activitiesMap: { [site.id]: { [followup]: activeConfig } },
    });
    expect(result).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('fails closed on an explicitly invalid site timezone', async () => {
    mockFetchCompleteSettings.mockResolvedValue([settings(activeConfig, 'not/an-iana-zone')]);
    expect(await scheduleLeadQualificationActivity(undefined)).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('fails closed on settings lookup failure', async () => {
    mockFetchCompleteSettings.mockRejectedValueOnce(new Error('Settings unavailable'));
    expect(await scheduleLeadQualificationActivity(undefined)).toMatchObject({
      scheduled: 0, failed: 1, errors: ['Settings unavailable'],
    });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a missing or cross-tenant selected segment before scheduling', async () => {
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, all_segments: false, segment_ids: ['foreign-segment'] })]);
    const inIds = jest.fn().mockResolvedValue({ data: [], error: null });
    const eq = jest.fn().mockReturnValue({ in: inIds });
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('segments');
      return { select: () => ({ eq }) };
    });
    expect(await scheduleLeadQualificationActivity(undefined)).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(eq).toHaveBeenCalledWith('site_id', site.id);
    expect(inIds).toHaveBeenCalledWith('id', ['foreign-segment']);
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it.each([undefined, 'default', 'inactive'])('requires explicit cold outreach activation (%s)', async status => {
    jest.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings(status === undefined ? {} : { ...activeConfig, status })]);
    const options = status === undefined ? {} : { activitiesMap: { [site.id]: { [cold]: { status } } } };
    expect(await scheduleIndividualDailyProspectionActivity({ openSites: [] }, options))
      .toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(await executeDailyProspectionWorkflowsActivity(options))
      .toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  describe.each(['timer', 'immediate'])('cold outreach %s scheduler', mode => {
    it.each([
      ['inactive persisted settings', { ...activeConfig, status: 'inactive' }],
      ['no selected account', { ...activeConfig, channel_accounts: {} }],
      ['no selected segments', { ...activeConfig, all_segments: false }],
    ])('does not queue with %s despite an active stale map', async (_label, config) => {
      jest.setSystemTime(new Date('2026-09-28T12:00:00Z'));
      mockFetchCompleteSettings.mockResolvedValue([settings(config)]);
      const options = { activitiesMap: { [site.id]: { [cold]: activeConfig } } };
      const result = mode === 'timer'
        ? await scheduleIndividualDailyProspectionActivity({ openSites: [] }, options)
        : await executeDailyProspectionWorkflowsActivity(options);
      expect(result).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
      expect(mockFetchCompleteSettings).toHaveBeenCalledWith([site.id]);
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });
  });
});