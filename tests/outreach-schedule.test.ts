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
const settings = (config: Record<string, unknown> = activeConfig, timezone = 'America/New_York', days: Record<string, unknown> = {}) => ({
  site_id: site.id,
  business_hours: [{ timezone, days }],
  channels: { email: { status: 'synced', email: 'sender@example.org' } },
  activities: { [followup]: config, [cold]: config },
});
const staleAnalysis = { openSites: [{ siteId: site.id, businessHours: { open: '04:00', close: '05:00', timezone: 'UTC' } }] };
const closedWeek = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  .map(day => [day, { enabled: false, start: '09:00' }]));

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

  it.each([undefined, 'custom'])('uses custom start (mode %s) for the timer ID, delay and metadata rather than 09:00 or opening hours', async start_time_mode => {
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time: '02:30', start_time_mode })]);
    expect(await scheduleLeadQualificationActivity(staleAnalysis, {
      activitiesMap: { [site.id]: { [followup]: { ...activeConfig, start_time: '09:00' } } },
    })).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    const options = mockStartWorkflow.mock.calls[0][1];
    expect(options.workflowId).toBe('lead-qualification-timer-site-1-2026-03-08-0230');
    expect(options.args[0]).toMatchObject({ delayMs: Date.parse('2026-03-08T07:00:00Z') - Date.now(),
      scheduledTime: '02:30 America/New_York', targetArgs: [{ additionalData: {
        scheduleTime: '02:30 America/New_York', targetTimeUTC: '2026-03-08T07:00:00.000Z', executionDay: '2026-03-08', fallbackUsed: false,
      } }] });
  });

  it.each(['16:15', 'invalid-stale-time', null])('resets follow-up to the next selected opening, ignoring stale time %j and a closed day', async start_time => {
    jest.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({
      ...activeConfig, weekdays: [2, 5], start_time_mode: 'business_opening', start_time,
    }, 'America/New_York', {
      tuesday: { enabled: false, start: '10:30' }, friday: { enabled: true, open: '11:15' },
    })]);
    expect(await scheduleLeadQualificationActivity(staleAnalysis, {
      timezone: 'UTC', activitiesMap: { [site.id]: { [followup]: { ...activeConfig, start_time: '04:00' } } },
    })).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    const options = mockStartWorkflow.mock.calls[0][1];
    expect(options.workflowId).toBe('lead-qualification-timer-site-1-2026-10-02-1115');
    expect(options.args[0]).toMatchObject({
      delayMs: Date.parse('2026-10-02T15:15:00Z') - Date.now(), scheduledTime: '11:15 America/New_York',
      targetArgs: [{ additionalData: { targetTimeUTC: '2026-10-02T15:15:00.000Z', executionDay: '2026-10-02',
        startTimeMode: 'business_opening', fallbackUsed: false } }],
    });
    expect(options.args[0].targetArgs[0].additionalData.businessHours).toBeUndefined();
  });

  it('keeps explicit opening fallback metadata separate from a custom start', async () => {
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'business_opening' })]);
    expect(await scheduleLeadQualificationActivity(staleAnalysis)).toMatchObject({ scheduled: 1, skipped: 0 });
    expect(mockStartWorkflow.mock.calls[0][1].args[0]).toMatchObject({ scheduledTime: '09:00 America/New_York',
      targetArgs: [{ additionalData: { fallbackUsed: true, targetTimeUTC: '2026-03-08T13:00:00.000Z' } }] });
  });

  it('skips follow-up when every selected opening is explicitly closed, without a fallback timer', async () => {
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'business_opening' },
      'America/New_York', closedWeek)]);
    expect(await scheduleLeadQualificationActivity(staleAnalysis)).toMatchObject({ scheduled: 0, skipped: 1, failed: 0, errors: [] });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
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
    ['custom missing start', { ...activeConfig, start_time_mode: 'custom' }],
    ['invalid mode', { ...activeConfig, start_time_mode: 'invalid', start_time: '09:00' }],
    ['null mode', { ...activeConfig, start_time_mode: null }],
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
      ['configured', {}, false],
      ['configured', { start_time_mode: 'business_opening' }, true],
      ['configured', { start_time: '09:00' }, true],
      ['legacy', {}, true],
      ['legacy', { start_time_mode: 'business_opening' }, false],
      ['legacy', { start_time: '09:00' }, false],
    ] as const)('timing filter %s uses fresh config %j (dispatch %s)', async (timingFilter, timing, dispatch) => {
      jest.setSystemTime(new Date('2026-09-28T12:00:00Z'));
      mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, ...timing }, 'UTC')]);
      const options = { timingFilter, activitiesMap: { [site.id]: { [cold]: { ...activeConfig,
        ...(dispatch ? {} : { start_time_mode: 'custom', start_time: '23:59' }),
      } } } };
      const result = mode === 'timer'
        ? await scheduleIndividualDailyProspectionActivity({ openSites: [] }, options)
        : await executeDailyProspectionWorkflowsActivity(options);
      expect(result).toMatchObject({ scheduled: dispatch ? 1 : 0, skipped: dispatch ? 0 : 1, failed: 0 });
      expect(mockStartWorkflow).toHaveBeenCalledTimes(dispatch ? 1 : 0);
    });

    it.each([
      ['inactive persisted settings', { ...activeConfig, status: 'inactive' }],
      ['no selected account', { ...activeConfig, channel_accounts: {} }],
      ['no selected segments', { ...activeConfig, all_segments: false }],
      ['invalid mode', { ...activeConfig, start_time_mode: 'invalid', start_time: '09:00' }],
      ['null mode', { ...activeConfig, start_time_mode: null }],
      ['custom missing start', { ...activeConfig, start_time_mode: 'custom' }],
      ['invalid start', { ...activeConfig, start_time: '24:00' }],
      ['empty start', { ...activeConfig, start_time: '' }],
      ['null start', { ...activeConfig, start_time: null }],
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

    it.each(['business_opening', 'custom'])('skips a fully closed week in %s mode without failing or dispatching', async start_time_mode => {
      mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode, start_time: '10:45' }, 'UTC', closedWeek)]);
      const result = mode === 'timer'
        ? await scheduleIndividualDailyProspectionActivity(staleAnalysis)
        : await executeDailyProspectionWorkflowsActivity({ businessHoursAnalysis: staleAnalysis });
      expect(result).toMatchObject({ scheduled: 0, skipped: 1, failed: 0, errors: [] });
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('does not use stale analysis timezone when the persisted configured timezone is invalid', async () => {
      mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'custom', start_time: '09:00' }, 'Invalid/Zone')]);
      const result = mode === 'timer'
        ? await scheduleIndividualDailyProspectionActivity(staleAnalysis, { timezone: 'UTC' })
        : await executeDailyProspectionWorkflowsActivity({ businessHoursAnalysis: staleAnalysis });
      expect(result).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['custom', { start_time_mode: 'custom', start_time: '10:45' }, '10:45', '2026-09-28T14:45:00.000Z'],
    ['legacy supplied time', { start_time: '10:45' }, '10:45', '2026-09-28T14:45:00.000Z'],
    ['opening', { start_time_mode: 'business_opening' }, '10:30', '2026-09-28T14:30:00.000Z'],
    ['reset from custom', { start_time_mode: 'business_opening', start_time: '23:59' }, '10:30', '2026-09-28T14:30:00.000Z'],
    ['reset with invalid stale time', { start_time_mode: 'business_opening', start_time: null }, '10:30', '2026-09-28T14:30:00.000Z'],
  ])('schedules cold %s from fresh persisted timing, not stale analysis or the +2h legacy offset', async (_label, timing, time, target) => {
    jest.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, ...timing }, 'America/New_York', {
      monday: { enabled: true, start: '10:30' },
    })]);
    expect(await scheduleIndividualDailyProspectionActivity(staleAnalysis, {
      timezone: 'UTC', hoursThreshold: 72, maxLeads: 15, parentScheduleId: 'parent',
      activitiesMap: { [site.id]: { [cold]: { status: 'inactive', start_time: '04:00' } } },
    })).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockFetchCompleteSettings).toHaveBeenCalledWith([site.id]);
    const [workflow, options] = mockStartWorkflow.mock.calls[0];
    expect(workflow).toBe('delayedExecutionWorkflow');
    expect(options.workflowId).toBe(`daily-prospection-timer-site-1-2026-09-28-${time.replace(':', '')}`);
    expect(options.args[0]).toMatchObject({
      delayMs: Date.parse(target) - Date.now(), scheduledTime: `${time} America/New_York`, targetWorkflow: 'dailyProspectionWorkflow',
      targetArgs: [{ site_id: site.id, hoursThreshold: 72, maxLeads: 15, additionalData: {
        outreach_activity: cold, scheduleTime: `${time} America/New_York`, targetTimeUTC: target,
        executionDay: '2026-09-28', timezone: 'America/New_York', fallbackUsed: false,
        prospectionExecutesTwoHoursLater: false, parentScheduleId: 'parent', dailyOperationsScheduleId: 'parent',
      } }],
    });
    expect(options.args[0].targetArgs[0].additionalData.businessHours).toBeUndefined();
    expect(options.args[0].targetArgs[0].additionalData.originalDailyStandupTime).toBeUndefined();
  });

  it('skips explicitly closed cold operating days and uses the next day’s opening, even outside stale openSites', async () => {
    jest.setSystemTime(new Date('2026-09-28T08:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'business_opening' }, 'UTC', {
      monday: { enabled: false, start: '10:30' }, tuesday: { enabled: true, start: '12:15' },
    })]);
    expect(await scheduleIndividualDailyProspectionActivity({ openSites: [{ siteId: 'other-site' }] }))
      .toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow.mock.calls[0][1].args[0]).toMatchObject({ scheduledTime: '12:15 UTC',
      targetArgs: [{ additionalData: { executionDay: '2026-09-29', targetTimeUTC: '2026-09-29T12:15:00.000Z', fallbackUsed: false } }] });
  });

  it('uses Mon–Fri fallback for missing cold operating days rather than scheduling the weekend', async () => {
    jest.setSystemTime(new Date('2026-10-03T08:00:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'business_opening' }, 'UTC')]);
    expect(await scheduleIndividualDailyProspectionActivity(undefined, { timezone: 'Asia/Tokyo' }))
      .toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow.mock.calls[0][1]).toMatchObject({ workflowId: 'daily-prospection-timer-site-1-2026-10-05-0900',
      args: [{ scheduledTime: '09:00 UTC', targetArgs: [{ additionalData: { fallbackUsed: true, targetTimeUTC: '2026-10-05T09:00:00.000Z' } }] }] });
  });

  it('keeps a configured cold timer alive beyond a weekly fall-back DST transition', async () => {
    jest.setSystemTime(new Date('2026-10-25T13:00:00.001Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'business_opening' }, 'America/New_York', {
      ...closedWeek, sunday: { enabled: true, start: '09:00' },
    })]);
    expect(await scheduleIndividualDailyProspectionActivity(undefined)).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    const options = mockStartWorkflow.mock.calls[0][1];
    expect(options.args[0].delayMs).toBe(Date.parse('2026-11-01T14:00:00Z') - Date.now());
    expect(options.args[0].delayMs).toBeGreaterThan(168 * 3600000);
    expect(options.workflowRunTimeout).toBeGreaterThanOrEqual(options.args[0].delayMs + 2 * 3600000);
  });

  it.each([
    ['business_opening', '2026-03-08T05:00:00Z', '02:30', '2026-03-08T07:00:00.000Z'],
    ['custom', '2026-03-08T05:00:00Z', '02:30', '2026-03-08T07:00:00.000Z'],
    ['custom', '2026-11-01T05:30:00.001Z', '01:30', '2026-11-01T06:30:00.000Z'],
  ])('uses actual DST instants for cold %s at %s', async (start_time_mode, now, start_time, targetTimeUTC) => {
    jest.setSystemTime(new Date(now));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode, start_time }, 'America/New_York', {
      ...closedWeek, sunday: { enabled: true, start: start_time },
    })]);
    expect(await scheduleIndividualDailyProspectionActivity(staleAnalysis)).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow.mock.calls[0][1].args[0]).toMatchObject({
      delayMs: Date.parse(targetTimeUTC) - Date.now(), scheduledTime: `${start_time} America/New_York`,
      targetArgs: [{ additionalData: { targetTimeUTC, fallbackUsed: false } }],
    });
  });

  it('uses the target local date for configured cold timers and includes the exact boundary', async () => {
    jest.setSystemTime(new Date('2026-09-28T10:30:00Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode: 'custom', start_time: '00:30' }, 'Pacific/Kiritimati')]);
    expect(await scheduleIndividualDailyProspectionActivity(undefined)).toMatchObject({ scheduled: 1, skipped: 0 });
    expect(mockStartWorkflow.mock.calls[0][1]).toMatchObject({ workflowId: 'daily-prospection-timer-site-1-2026-09-29-0030',
      args: [{ delayMs: 0, scheduledTime: '00:30 Pacific/Kiritimati', targetArgs: [{ additionalData: {
        executionDay: '2026-09-29', targetTimeUTC: '2026-09-28T10:30:00.000Z',
      } }] }] });
  });

  it.each(['business_opening', 'custom'])('gates direct cold %s on fresh timing and ignores stale closed-site analysis', async start_time_mode => {
    jest.setSystemTime(new Date('2026-09-28T14:29:59Z'));
    mockFetchCompleteSettings.mockResolvedValue([settings({ ...activeConfig, start_time_mode, start_time: '10:30' }, 'America/New_York', {
      monday: { enabled: true, start: '10:30' },
    })]);
    const options = { businessHoursAnalysis: { openSites: [{ siteId: 'other-site' }] } };
    expect(await executeDailyProspectionWorkflowsActivity(options)).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2026-09-28T14:30:00Z'));
    expect(await executeDailyProspectionWorkflowsActivity(options)).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow).toHaveBeenCalledWith('dailyProspectionWorkflow', expect.objectContaining({ args: [expect.objectContaining({
      additionalData: expect.objectContaining({ executionDay: '2026-09-28', timezone: 'America/New_York', scheduleType: 'configured-timing' }),
    })] }));
  });

  it('preserves cold legacy timer offsets and weekend skipping when no timing choice is saved', async () => {
    jest.setSystemTime(new Date('2026-09-28T05:00:00Z'));
    expect(await scheduleIndividualDailyProspectionActivity(staleAnalysis)).toMatchObject({ scheduled: 1, skipped: 0, failed: 0 });
    expect(mockStartWorkflow.mock.calls[0][1]).toMatchObject({ workflowId: 'daily-prospection-timer-site-1-2026-09-28-0600',
      args: [{ delayMs: 3600000, scheduledTime: '06:00 UTC', targetArgs: [{ additionalData: {
        originalDailyStandupTime: '04:00', prospectionExecutesTwoHoursLater: true,
      } }] }] });
    mockStartWorkflow.mockClear();
    jest.setSystemTime(new Date('2026-10-03T08:00:00Z'));
    expect(await scheduleIndividualDailyProspectionActivity({ openSites: [] })).toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('preserves legacy direct cold filtering by the openSites analysis', async () => {
    expect(await executeDailyProspectionWorkflowsActivity({ businessHoursAnalysis: { openSites: [{ siteId: 'other-site' }] } }))
      .toMatchObject({ scheduled: 0, skipped: 1, failed: 0 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });
});