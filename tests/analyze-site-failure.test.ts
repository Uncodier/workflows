const mockActivities = {
  logWorkflowExecutionActivity: jest.fn(), saveCronStatusActivity: jest.fn(),
  getSiteActivity: jest.fn(), getSettingsActivity: jest.fn(), updateSettingsActivity: jest.fn(),
  uxAnalysisActivity: jest.fn(), sendProjectAnalysisNotificationActivity: jest.fn(),
  storeWorkflowResultActivity: jest.fn(),
};
const mockStartChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: () => mockActivities,
  startChild: mockStartChild,
  workflowInfo: () => ({ workflowId: 'analysis-run', searchAttributes: {}, memo: {} }),
  upsertSearchAttributes: jest.fn(),
}));
import { ApplicationFailure, ActivityFailure, RetryState } from '@temporalio/common';
import { analyzeSiteWorkflow } from '../src/temporal/workflows/analyzeSiteWorkflow';

describe('site analysis terminal failures', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { success: false, error: 'Archived sites cannot be set up' },
    { success: false, error: 'Site is archived', errorCode: 'SITE_ARCHIVED' },
  ])('terminates archived sites for legacy and typed activity results (%j)', async result => {
    mockActivities.getSiteActivity.mockResolvedValue(result);
    await expect(analyzeSiteWorkflow({ site_id: 'site' })).rejects.toMatchObject({
      type: 'SITE_ARCHIVED', nonRetryable: true,
    });
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect(mockActivities.logWorkflowExecutionActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect(mockActivities.getSettingsActivity).not.toHaveBeenCalled();
    expect(mockStartChild).not.toHaveBeenCalled();
    expect(mockActivities.uxAnalysisActivity).not.toHaveBeenCalled();
    expect(mockActivities.sendProjectAnalysisNotificationActivity).not.toHaveBeenCalled();
  });

  it('converts ordinary errors to terminal application failures', async () => {
    mockActivities.getSiteActivity.mockResolvedValue({ success: false, error: 'Site not found' });
    await expect(analyzeSiteWorkflow({ site_id: 'site' })).rejects.toMatchObject({
      type: 'ANALYZE_SITE_WORKFLOW_FAILED', nonRetryable: true,
      message: 'Analyze site workflow failed: Failed to get site information: Site not found',
    });
  });

  it('does not mask the terminal failure when failure reporting throws', async () => {
    mockActivities.getSiteActivity.mockResolvedValue({ success: false, errorCode: 'SITE_ARCHIVED', error: 'Site is archived' });
    mockActivities.saveCronStatusActivity.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Status unavailable'));
    mockActivities.logWorkflowExecutionActivity.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Log unavailable'));
    await expect(analyzeSiteWorkflow({ site_id: 'site' })).rejects.toMatchObject({ type: 'SITE_ARCHIVED', nonRetryable: true });
    expect(mockActivities.logWorkflowExecutionActivity).toHaveBeenCalledTimes(2);
  });

  it('preserves exhausted activity failures and their original cause', async () => {
    const cause = ApplicationFailure.nonRetryable('Site is archived', 'SITE_ARCHIVED');
    const failure = new ActivityFailure('Activity failed', 'getSiteActivity', 'activity', RetryState.NON_RETRYABLE_FAILURE, 'worker', cause);
    mockActivities.getSiteActivity.mockRejectedValue(failure);
    await expect(analyzeSiteWorkflow({ site_id: 'site' })).rejects.toBe(failure);
  });

  it('rejects missing site IDs without a workflow task loop', async () => {
    await expect(analyzeSiteWorkflow({ site_id: '' })).rejects.toMatchObject({ type: 'ANALYZE_SITE_INVALID_INPUT', nonRetryable: true });
    expect(mockActivities.getSiteActivity).not.toHaveBeenCalled();
  });
});