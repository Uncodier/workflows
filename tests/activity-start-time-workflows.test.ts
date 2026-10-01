const mockActivities: Record<string, jest.Mock> = {};
const mockPatched = jest.fn();
const mockSleep = jest.fn();
const mockExecuteChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_target, name: string) => {
    if (!mockActivities[name]) mockActivities[name] = jest.fn();
    return mockActivities[name];
  } }),
  patched: (id: string) => mockPatched(id),
  deprecatePatch: jest.fn(),
  upsertSearchAttributes: jest.fn(),
  workflowInfo: () => ({ workflowId: 'test-workflow', runId: 'test-run' }),
  sleep: (delay: number) => mockSleep(delay),
  executeChild: (workflow: string, options: unknown) => mockExecuteChild(workflow, options),
}));
jest.mock('../src/temporal/workflows/leadFollowUp/validation', () => ({ performEarlyValidation: jest.fn() }));
jest.mock('../src/temporal/workflows/leadFollowUp/research', () => ({ performResearch: jest.fn() }));

import { dailyStandUpWorkflow } from '../src/temporal/workflows/dailyStandUpWorkflow';
import { dailyProspectionWorkflow } from '../src/temporal/workflows/dailyProspectionWorkflow';
import { leadQualificationWorkflow } from '../src/temporal/workflows/leadQualificationWorkflow';
import { leadFollowUpWorkflow } from '../src/temporal/workflows/leadFollowUpWorkflow';
import { delayedExecutionWorkflow } from '../src/temporal/workflows/delayedExecutionWorkflow';
import { resolveDailyStandUpConfiguration } from '../src/temporal/utils/dailyStandUpConfiguration';
import { resolveOutreachConfiguration } from '../src/temporal/utils/outreachConfiguration';

const daily = 'daily_resume_and_stand_up';
const followUp = 'leads_follow_up';
const cold = 'leads_initial_cold_outreach';
const initialSettings = () => ({
  business_hours: [{ timezone: 'America/Mexico_City' }],
  channels: { email: { status: 'synced', email: 'sender@example.org' } },
  activities: {
    [daily]: { status: 'active', weekdays: [2], report_sections: ['sales'] },
    [followUp]: { status: 'active', weekdays: [2], all_segments: true, channel_accounts: { email: ['email'] } },
    [cold]: { status: 'active', all_segments: true, channel_accounts: { email: ['email'] } },
  },
});

describe('scheduled activity start-time runtime guards', () => {
  let persisted: any;
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T14:00:00Z')); // 08:00 local
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    persisted = initialSettings();
    mockPatched.mockReturnValue(true);
    // These activity responses emulate fresh persisted reads, not the timer's arguments.
    mockActivities.getDailyStandUpConfigurationActivity.mockImplementation(async () => resolveDailyStandUpConfiguration(persisted));
    mockActivities.getOutreachConfigurationActivity.mockImplementation(async ({ activity_key }) => resolveOutreachConfiguration(persisted, activity_key));
    mockActivities.validateWorkflowConfigActivity.mockResolvedValue({ shouldExecute: true });
    mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({ canProceed: true });
    mockActivities.cmoWrapUpActivity.mockResolvedValue({ success: true, message: 'Sales report', report_sections: ['sales'] });
    mockActivities.validateCommunicationChannelsActivity.mockResolvedValue({ success: true, hasAnyChannel: true });
    mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { name: 'Site' } });
    mockActivities.getQualificationLeadsActivity.mockResolvedValue({ success: true, leads: [], thresholdDate: '2026-09-22' });
    mockActivities.countPendingMessagesActivity.mockResolvedValue({ success: true, count: 0 });
    mockExecuteChild.mockImplementation(async (workflow, { args }) => workflow === 'dailyStandUpWorkflow'
      ? dailyStandUpWorkflow(args[0]) : workflow === 'dailyProspectionWorkflow'
        ? dailyProspectionWorkflow(args[0]) : leadQualificationWorkflow(args[0]));
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it.each([
    [daily, 'dailyStandUpWorkflow'], [followUp, 'leadQualificationWorkflow'], [cold, 'dailyProspectionWorkflow'],
  ])('%s re-reads a later start edited while the original timer sleeps', async (key, targetWorkflow) => {
    persisted.activities[key].start_time = '09:00';
    mockSleep.mockImplementation(async delay => {
      persisted.activities[key].start_time = '11:00';
      jest.setSystemTime(Date.now() + delay);
    });
    const result = await delayedExecutionWorkflow({
      delayMs: 3600000, targetWorkflow,
      targetArgs: [{ site_id: 'site', additionalData: { executionDay: '2026-09-29', start_time: '09:00', scheduleTime: '09:00' } }],
    });
    expect(mockSleep).toHaveBeenCalledWith(3600000);
    expect(mockExecuteChild).toHaveBeenCalledTimes(1);
    expect(result.targetResult).toMatchObject({ success: false, errors: [expect.stringContaining('Before configured')] });
    expect(mockActivities.cmoWrapUpActivity).not.toHaveBeenCalled();
    expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
    expect(mockActivities.getQualificationLeadsActivity).not.toHaveBeenCalled();
    expect(mockActivities.startLeadFollowUpWorkflowActivity).not.toHaveBeenCalled();
  });

  it.each([
    [daily, 'dailyStandUpWorkflow'], [followUp, 'leadQualificationWorkflow'], [cold, 'dailyProspectionWorkflow'],
  ])('%s re-reads opening mode selected while a custom-time timer sleeps', async (key, targetWorkflow) => {
    Object.assign(persisted.activities[key], { start_time_mode: 'custom', start_time: '09:00' });
    persisted.business_hours[0].days = { tuesday: { enabled: true, start: '11:00' } };
    mockSleep.mockImplementation(async delay => {
      // Simulates merge persistence: the old 09:00 remains stored but must be ignored.
      persisted.activities[key].start_time_mode = 'business_opening';
      jest.setSystemTime(Date.now() + delay);
    });
    const result = await delayedExecutionWorkflow({ delayMs: 3600000, targetWorkflow,
      targetArgs: [{ site_id: 'site', additionalData: { scheduleTime: '09:00' } }],
    });
    expect(result.targetResult).toMatchObject({ success: false, errors: [expect.stringContaining('Before configured')] });
    expect(mockActivities.cmoWrapUpActivity).not.toHaveBeenCalled();
    expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
    expect(mockActivities.getQualificationLeadsActivity).not.toHaveBeenCalled();
    expect(mockActivities.getSiteActivity).not.toHaveBeenCalled();
  });

  it.each([
    [daily, 'dailyStandUpWorkflow'], [followUp, 'leadQualificationWorkflow'],
  ])('%s preserves legacy runtime behavior if start_time is removed during the delay', async (key, targetWorkflow) => {
    persisted.activities[key].start_time = '11:00';
    mockSleep.mockImplementation(async delay => {
      delete persisted.activities[key].start_time;
      jest.setSystemTime(Date.now() + delay);
    });
    const result = await delayedExecutionWorkflow({ delayMs: 60000, targetWorkflow,
      targetArgs: [{ site_id: 'site', additionalData: { start_time: '11:00', executionDay: '2026-09-29' } }],
    });
    expect(result.targetResult).toMatchObject({ success: true });
  });

  it.each([undefined, '08:00'])('Standup permits missing legacy timing or exact configured start: %s', start_time => {
    persisted.activities[daily].start_time = start_time;
    return expect(dailyStandUpWorkflow({ site_id: 'site' })).resolves.toMatchObject({ success: true, notificationSent: true });
  });

  it.each([undefined, '08:00'])('Follow Up permits missing legacy timing or exact configured start: %s', async start_time => {
    persisted.activities[followUp].start_time = start_time;
    expect(await leadQualificationWorkflow({ site_id: 'site' })).toMatchObject({ success: true });
    expect(mockActivities.getQualificationLeadsActivity).toHaveBeenCalledTimes(1);
  });

  it('Standup rechecks a start moved later during generation and does not deliver early', async () => {
    persisted.activities[daily].start_time = '08:00';
    mockActivities.cmoWrapUpActivity.mockImplementation(async () => {
      persisted.activities[daily].start_time = '11:00';
      return { success: true, message: 'Sales report', report_sections: ['sales'] };
    });
    expect(await dailyStandUpWorkflow({ site_id: 'site' })).toMatchObject({ success: false, skipped: true,
      notificationSent: false, skipReason: 'Before configured Daily Standup start time' });
    expect(mockActivities.getDailyStandUpConfigurationActivity).toHaveBeenCalledTimes(2);
    expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
  });

  it.each(['11:00', null, '', '24:00'])('single-lead Follow Up blocks early or invalid start before paid work: %j', async start_time => {
    persisted.activities[followUp].start_time = start_time;
    expect(await leadFollowUpWorkflow({ site_id: 'site', lead_id: 'lead' })).toMatchObject({ success: false });
    expect(mockActivities.getSiteActivity).not.toHaveBeenCalled();
    expect(mockActivities.leadEmailRevalidationActivity).not.toHaveBeenCalled();
    expect(mockActivities.leadFollowUpActivity).not.toHaveBeenCalled();
  });

  it.each(['11:00', null, '', '24:00'])('single-lead Cold Outreach blocks early or invalid start before paid work: %j', async start_time => {
    persisted.activities[cold].start_time = start_time;
    expect(await leadFollowUpWorkflow({ site_id: 'site', lead_id: 'lead',
      additionalData: { outreach_activity: cold } })).toMatchObject({ success: false });
    expect(mockActivities.getSiteActivity).not.toHaveBeenCalled();
    expect(mockActivities.leadEmailRevalidationActivity).not.toHaveBeenCalled();
    expect(mockActivities.leadFollowUpActivity).not.toHaveBeenCalled();
  });

  it('leaves historical command paths unchanged for pre-configuration histories', async () => {
    mockPatched.mockReturnValue(false);
    persisted.activities[daily].start_time = '11:00';
    persisted.activities[followUp].start_time = '11:00';
    expect(await dailyStandUpWorkflow({ site_id: 'site' })).toMatchObject({ success: true });
    expect(await leadQualificationWorkflow({ site_id: 'site' })).toMatchObject({ success: true });
    expect(mockActivities.getDailyStandUpConfigurationActivity).not.toHaveBeenCalled();
    expect(mockActivities.getOutreachConfigurationActivity).not.toHaveBeenCalled();
  });
});