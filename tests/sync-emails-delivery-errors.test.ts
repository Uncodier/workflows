const mockActivities: Record<string, jest.Mock> = {};
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_target, name: string) => mockActivities[name] ||= jest.fn() }),
  patched: () => true,
  workflowInfo: () => ({ workflowId: 'sync-run' }),
  upsertSearchAttributes: jest.fn(), startChild: jest.fn(), ParentClosePolicy: {},
}));
jest.mock('../src/temporal/workflows/scheduleCustomerSupportMessagesWorkflow', () => ({ scheduleCustomerSupportMessagesWorkflow: jest.fn() }));
import { ApplicationFailure, ActivityFailure, RetryState } from '@temporalio/common';
import { syncEmailsWorkflow } from '../src/temporal/workflows/syncEmailsWorkflow';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockActivities.validateWorkflowConfigActivity.mockResolvedValue({ shouldExecute: true });
  mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({ canProceed: true });
  mockActivities.validateCommunicationChannelsActivity.mockResolvedValue({ hasEmailChannel: true });
  mockActivities.analyzeEmailsLeadsReplyActivity.mockResolvedValue({ success: true, data: {} });
  mockActivities.analyzeEmailsReplyActivity.mockResolvedValue({ success: true, data: {} });
  mockActivities.syncSentEmailsActivity.mockResolvedValue({ success: true, data: {} });
  mockActivities.deliveryStatusActivity.mockResolvedValue({ success: true, data: {} });
});
afterEach(() => jest.restoreAllMocks());

const options = { userId: 'owner', siteId: 'site', provider: 'gmail' };
const authMessage = 'API call failed: 500 Internal Server Error. {"error":{"code":"EMAIL_FETCH_ERROR","message":"Authentication failed: invalid credentials or IMAP access problem."}}';

it('records both sent and delivery HTTP500 auth failures as visible skips and completes', async () => {
  mockActivities.syncSentEmailsActivity.mockResolvedValue({ success: false, error: authMessage });
  mockActivities.deliveryStatusActivity.mockResolvedValue({ success: false, error: authMessage });
  const result = await syncEmailsWorkflow(options);
  expect(result.success).toBe(true);
  expect(result.errors).toEqual([
    `Sent emails sync skipped: ${authMessage}`,
    `Delivery status check skipped: ${authMessage}`,
  ]);
  expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'COMPLETED', errorMessage: '2 non-critical errors occurred' }));
});

it.each(['plain', 'Temporal cause'])('recognizes thrown delivery auth failures: %s', async kind => {
  const failure = kind === 'plain' ? new Error(authMessage) : new ActivityFailure(
    'Activity task failed', 'deliveryStatusActivity', 'activity-id', RetryState.NON_RETRYABLE_FAILURE,
    'worker', ApplicationFailure.nonRetryable(authMessage, 'EMAIL_AUTH_FAILED')
  );
  mockActivities.deliveryStatusActivity.mockRejectedValue(failure);
  const result = await syncEmailsWorkflow(options);
  expect(result.errors).toEqual([`Delivery status check skipped: ${failure.message}`]);
  expect(result.success).toBe(true);
});

it.each(['EMAIL_FETCH_ERROR: connection timeout', 'HTTP 500 Internal Server Error', '429 rate limit'])('does not label delivery %s as an auth skip', async message => {
  mockActivities.deliveryStatusActivity.mockResolvedValue({ success: false, error: message });
  const result = await syncEmailsWorkflow(options);
  expect(result.errors).toEqual([`Delivery status check failed: ${message}`]);
});

it('keeps exhausted transient delivery failures visible under the existing non-critical policy', async () => {
  mockActivities.deliveryStatusActivity.mockRejectedValue(new Error('Connection timed out'));
  const result = await syncEmailsWorkflow(options);
  expect(result.errors).toEqual(['Delivery status check exception: Connection timed out']);
  expect(result.success).toBe(true);
});

it('still fails sent sync for non-auth EMAIL_FETCH_ERROR rather than skipping it', async () => {
  mockActivities.syncSentEmailsActivity.mockResolvedValue({ success: false, error: 'EMAIL_FETCH_ERROR: timeout' });
  await expect(syncEmailsWorkflow(options)).rejects.toThrow('EMAIL_FETCH_ERROR: timeout');
  expect(mockActivities.deliveryStatusActivity).not.toHaveBeenCalled();
  expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
});