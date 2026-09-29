const mockPatched = jest.fn();
const mockSupport = jest.fn();
const mockAssertPersisted = jest.fn();
const mockHasPersisted = jest.fn();
const mockFinish = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), patched: mockPatched,
  proxyActivities: () => ({ finishSyncedObjectClaimActivity: mockFinish, assertSocialCommentPersistedActivity: mockAssertPersisted, hasSocialCommentPersistedActivity: mockHasPersisted }),
}));
jest.mock('../src/temporal/workflows/customerSupportWorkflow', () => ({ customerSupportMessageWorkflow: mockSupport }));
import { ingestSocialCommentWorkflow } from '../src/temporal/workflows/ingestSocialCommentWorkflow';

const params = { siteId: 'site-1', externalId: 'outstand:instagram:comment-1', claimToken: 'claim', messageData: {}, baseParams: { origin: 'instagram', origin_message_id: 'outstand:instagram:comment-1' } };
beforeEach(() => {
  jest.resetAllMocks();
  mockPatched.mockReturnValue(true);
  mockSupport.mockResolvedValue({ success: true, data: {} });
});

it('confirms durable message persistence before completing a claim', async () => {
  await ingestSocialCommentWorkflow(params);
  expect(mockAssertPersisted).toHaveBeenCalledWith(params.siteId, params.externalId);
  expect(mockFinish.mock.invocationCallOrder[0]).toBeGreaterThan(mockAssertPersisted.mock.invocationCallOrder[0]);
  expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
});

it('does not complete a claim for success-without-persistence responses', async () => {
  mockSupport.mockResolvedValue({ success: true, data: { skip_database: true } });
  mockAssertPersisted.mockRejectedValue(new Error('No persisted comment'));
  await expect(ingestSocialCommentWorkflow(params)).rejects.toThrow('No persisted comment');
  expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  expect(mockFinish).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
});

it('rejects unsuccessful processing', async () => {
  mockSupport.mockResolvedValue({ success: false });
  await expect(ingestSocialCommentWorkflow(params)).rejects.toThrow('did not succeed');
  expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
});

it('recovers a saved comment after response loss without repeated support side effects', async () => {
  mockHasPersisted.mockResolvedValue(true);
  await ingestSocialCommentWorkflow(params);
  expect(mockSupport).not.toHaveBeenCalled();
  expect(mockAssertPersisted).toHaveBeenCalledWith(params.siteId, params.externalId);
  expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
});

it('fails closed on a persistence lookup error instead of generating another draft', async () => {
  mockHasPersisted.mockRejectedValue(new Error('Database unavailable'));
  await expect(ingestSocialCommentWorkflow(params)).rejects.toThrow('Database unavailable');
  expect(mockSupport).not.toHaveBeenCalled();
  expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
});

it('preserves the activity sequence for pre-patch Temporal histories', async () => {
  mockPatched.mockReturnValue(false);
  await ingestSocialCommentWorkflow(params);
  expect(mockAssertPersisted).not.toHaveBeenCalled();
  expect(mockHasPersisted).not.toHaveBeenCalled();
  expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
});