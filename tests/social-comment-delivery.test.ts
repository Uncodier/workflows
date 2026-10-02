const mockActivities: Record<string, jest.Mock> = Object.fromEntries([
  'resetStuckSendingMessagesActivity', 'getApprovedMessagesActivity', 'claimApprovedMessagesBatchActivity',
  'updateMessageStatusToSentActivity', 'cleanupFailedFollowUpActivity',
].map(name => [name, jest.fn()]));
const mockStartChild = jest.fn();
const mockPatched = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities, patched: mockPatched, startChild: mockStartChild, ParentClosePolicy: {},
}));
jest.mock('../src/temporal/workflows/sendWhatsappFromAgentWorkflow', () => ({ sendWhatsappFromAgent: jest.fn() }));
jest.mock('../src/temporal/workflows/sendChannelMessageFromAgentWorkflow', () => ({ sendChannelMessageFromAgentWorkflow: jest.fn() }));
jest.mock('../src/temporal/workflows/sendVoiceCallFromAgentWorkflow', () => ({ sendVoiceCallFromAgentWorkflow: jest.fn() }));
import { sendApprovedMessagesWorkflow } from '../src/temporal/workflows/sendApprovedMessagesWorkflow';

const proposal = { message_id: 'saved-proposal', conversation_id: 'grouped-conversation', site_id: 'site', lead_id: 'lead',
  content: 'Exact reply', lead_phone: null, custom_data: {
    source: 'comment', channel: 'instagram', status: 'accepted',
    reply_to_message_id: 'original-inbound', reply_to_comment_id: 'original-comment',
  } };
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockPatched.mockReturnValue(true);
  mockActivities.resetStuckSendingMessagesActivity.mockResolvedValue({ resetCount: 0 });
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([proposal]);
  mockActivities.claimApprovedMessagesBatchActivity.mockResolvedValue(['saved-proposal']);
  mockStartChild.mockResolvedValue({ result: async () => ({ success: true }) });
});
afterEach(() => jest.restoreAllMocks());

it('delivers the exact persisted proposal and target without requiring a phone or latest-comment lookup', async () => {
  await expect(sendApprovedMessagesWorkflow()).resolves.toMatchObject({ success: 1, failed: 0 });
  expect(mockStartChild.mock.calls[0][1].args[0]).toMatchObject({
    message_id: 'saved-proposal', conversation_id: 'grouped-conversation', to: 'lead', custom_data: proposal.custom_data,
  });
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
});

it('waits for actual delivery and retains proposals on rejection or unknown provider outcome', async () => {
  mockStartChild.mockResolvedValue({ result: async () => { throw new Error('Comment delivery requires reconciliation'); } });
  await expect(sendApprovedMessagesWorkflow()).resolves.toMatchObject({ success: 0, failed: 1 });
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
});

it('retains legacy unbound proposals when the API rejects them, never inventing a target', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal, custom_data: { source: 'comment', channel: 'instagram' } }]);
  mockStartChild.mockResolvedValue({ result: async () => { throw new Error('Saved target missing'); } });
  await sendApprovedMessagesWorkflow();
  expect(mockStartChild.mock.calls[0][1].args[0].custom_data).not.toHaveProperty('reply_to_message_id');
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
});

it('preserves legacy command flow without the delivery patch', async () => {
  mockPatched.mockImplementation(id => id !== 'send-approved-comment-exact-target-v1');
  const result = jest.fn();
  mockStartChild.mockResolvedValue({ result });
  await sendApprovedMessagesWorkflow();
  expect(result).not.toHaveBeenCalled();
});

it('leaves Instagram DM child behavior unchanged even with the comment patch', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal, custom_data: { source: 'instagram', channel: 'instagram' } }]);
  const result = jest.fn(); mockStartChild.mockResolvedValue({ result });
  await sendApprovedMessagesWorkflow();
  expect(result).not.toHaveBeenCalled();
});