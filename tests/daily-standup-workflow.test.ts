const mockActivities: Record<string, jest.Mock> = {};
const mockPatched = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_target, name: string) => {
    if (!mockActivities[name]) mockActivities[name] = jest.fn();
    return mockActivities[name];
  } }),
  patched: (id: string) => mockPatched(id),
  upsertSearchAttributes: jest.fn(),
  workflowInfo: () => ({ workflowId: 'daily-standup-site' }),
}));

import { dailyStandUpWorkflow } from '../src/temporal/workflows/dailyStandUpWorkflow';

const eligible = {
  shouldExecute: true, reason: 'Eligible', weekdays: [1, 5],
  reportSections: ['sales', 'orders'], timezone: 'America/Mexico_City',
};

describe('Daily Standup workflow preferences', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPatched.mockReturnValue(true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockActivities.getDailyStandUpConfigurationActivity.mockResolvedValue(eligible);
    mockActivities.validateWorkflowConfigActivity.mockResolvedValue({ shouldExecute: true, reason: 'Active' });
    mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({ canProceed: true });
    mockActivities.cmoWrapUpActivity.mockResolvedValue({ success: true, subject: 'Daily report', message: 'Selected summary', report_sections: ['sales', 'orders'] });
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes only the persisted selection through generation and delivery, reloading before send', async () => {
    const result = await dailyStandUpWorkflow({ site_id: 'site', additionalData: { report_sections: ['inventory'] } });
    expect(result).toMatchObject({ success: true, notificationSent: true, finalSummary: 'Selected summary' });
    expect(mockActivities.getDailyStandUpConfigurationActivity).toHaveBeenCalledTimes(2);
    expect(mockActivities.getDailyStandUpConfigurationActivity).toHaveBeenCalledWith({ site_id: 'site' });
    expect(mockActivities.cmoWrapUpActivity).toHaveBeenCalledWith(expect.objectContaining({ site_id: 'site', report_sections: ['sales', 'orders'] }));
    expect(mockActivities.sendDailyStandUpNotificationActivity).toHaveBeenCalledWith(expect.objectContaining({ site_id: 'site', report_sections: ['sales', 'orders'] }));
    expect(mockActivities.validateWorkflowConfigActivity).not.toHaveBeenCalled();
    expect(mockPatched).toHaveBeenCalledWith('daily-standup-configuration-v1');
  });

  it.each(['Inactive', 'Not a selected weekday', 'Invalid report sections'])('blocks generation and delivery: %s', reason => {
    mockActivities.getDailyStandUpConfigurationActivity.mockResolvedValue({ ...eligible, shouldExecute: false, reason });
    return expect(dailyStandUpWorkflow({ site_id: 'site' })).resolves.toMatchObject({
      success: false, skipped: true, skipReason: reason, notificationSent: false,
    }).then(() => {
      expect(mockActivities.cmoWrapUpActivity).not.toHaveBeenCalled();
      expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
      expect(mockActivities.saveCronStatusActivity).not.toHaveBeenCalled();
    });
  });

  it.each([
    { ...eligible, shouldExecute: false, reason: 'Daily Standup disabled during generation' },
    { ...eligible, shouldExecute: false, reason: 'Local day changed during generation' },
    { ...eligible, reportSections: ['inventory'] },
  ])('does not deliver an outdated report after preferences change: %j', current => {
    mockActivities.getDailyStandUpConfigurationActivity.mockResolvedValueOnce(eligible).mockResolvedValueOnce(current);
    return expect(dailyStandUpWorkflow({ site_id: 'site' })).resolves.toMatchObject({
      success: false, skipped: true, notificationSent: false,
    }).then(() => {
      expect(mockActivities.cmoWrapUpActivity).toHaveBeenCalledTimes(1);
      expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
      expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'COMPLETED' }));
    });
  });

  it('does not generate or send when current settings cannot be loaded', async () => {
    mockActivities.getDailyStandUpConfigurationActivity.mockRejectedValue(new Error('settings unavailable'));
    await expect(dailyStandUpWorkflow({ site_id: 'site' })).rejects.toThrow('settings unavailable');
    expect(mockActivities.cmoWrapUpActivity).not.toHaveBeenCalled();
    expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
  });

  it.each([
    { success: true, message: 'Legacy report with all business information' },
    { success: true, message: 'Wrong report', report_sections: ['inventory'] },
    { success: true, message: 'Expanded report', report_sections: ['sales', 'orders', 'inventory'] },
    { success: true, message: '', report_sections: ['sales', 'orders'] },
  ])('rejects an unscoped or mismatched API report instead of delivering it: %j', report => {
    mockActivities.cmoWrapUpActivity.mockResolvedValue(report);
    return expect(dailyStandUpWorkflow({ site_id: 'site' })).rejects.toThrow('does not match the selected').then(() => {
      expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
    });
  });

  it('does not forward legacy health and preserves the generated command ID', async () => {
    mockActivities.cmoWrapUpActivity.mockResolvedValue({ success: true, subject: 'Standup', message: 'Scoped summary',
      report_sections: ['sales', 'orders'], command_id: 'generated-command', health: { overall: 'private legacy data' } });
    expect(await dailyStandUpWorkflow({ site_id: 'site' })).toMatchObject({ command_id: 'generated-command' });
    expect(mockActivities.sendDailyStandUpNotificationActivity.mock.calls[0][0].health).toBeUndefined();
  });

  it('does not send if the pre-delivery settings read fails', async () => {
    mockActivities.getDailyStandUpConfigurationActivity.mockResolvedValueOnce(eligible).mockRejectedValueOnce(new Error('settings unavailable'));
    await expect(dailyStandUpWorkflow({ site_id: 'site' })).rejects.toThrow('settings unavailable');
    expect(mockActivities.sendDailyStandUpNotificationActivity).not.toHaveBeenCalled();
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  it('preserves the activity sequence and payloads for pre-patch histories', async () => {
    mockPatched.mockReturnValue(false);
    expect(await dailyStandUpWorkflow({ site_id: 'site' })).toMatchObject({ success: true });
    expect(mockActivities.getDailyStandUpConfigurationActivity).not.toHaveBeenCalled();
    expect(mockActivities.validateWorkflowConfigActivity).toHaveBeenCalledWith('site', 'daily_resume_and_stand_up');
    expect(mockActivities.cmoWrapUpActivity.mock.calls[0][0]).not.toHaveProperty('report_sections');
    expect(mockActivities.sendDailyStandUpNotificationActivity.mock.calls[0][0]).not.toHaveProperty('report_sections');
  });
});