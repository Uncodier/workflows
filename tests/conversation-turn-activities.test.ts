const mockDescribe = jest.fn();
const mockSignal = jest.fn();
const mockSignalWithStart = jest.fn();
const mockGetHandle = jest.fn(() => ({ describe: mockDescribe, signal: mockSignal }));
const mockClose = jest.fn();
jest.mock('../src/temporal/client', () => ({ getTemporalClient: async () => ({
  workflow: { getHandle: mockGetHandle, signalWithStart: mockSignalWithStart },
  connection: { close: mockClose },
}) }));
import { enqueueConversationTurnActivity, grantConversationTurnActivity, isConversationTurnRunningActivity } from '../src/temporal/activities/conversationTurnActivities';

const turn = { workflowId: 'message', runId: 'run-one' };
beforeEach(() => { jest.clearAllMocks(); mockDescribe.mockResolvedValue({ status: { name: 'RUNNING' } }); mockSignal.mockResolvedValue(undefined); });

it('atomically signals or starts the shared coordinator and closes its connection', async () => {
  await enqueueConversationTurnActivity({ siteId: 'site', conversationId: 'private-recipient', taskQueue: 'high', turn });
  expect(mockSignalWithStart).toHaveBeenCalledWith('conversationTurnQueueWorkflow', expect.objectContaining({
    taskQueue: 'high', args: [], signal: 'enqueueConversationTurn', signalArgs: [turn],
  }));
  expect(mockSignalWithStart.mock.calls[0][1].workflowId).not.toContain('private-recipient');
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('grants only the exact running execution', async () => {
  expect(await grantConversationTurnActivity(turn)).toBe(true);
  expect(mockGetHandle).toHaveBeenCalledWith('message', 'run-one');
  expect(mockSignal).toHaveBeenCalledWith('conversationTurnReady', 'run-one');
});

it.each(['CANCELLED', 'TERMINATED', 'COMPLETED', 'FAILED'])('does not grant terminal %s executions', async status => {
  mockDescribe.mockResolvedValue({ status: { name: status } });
  expect(await grantConversationTurnActivity(turn)).toBe(false);
  expect(mockSignal).not.toHaveBeenCalled();
  expect(await isConversationTurnRunningActivity(turn)).toBe(false);
});

it('handles an explicit cancellation racing a grant', async () => {
  mockSignal.mockRejectedValueOnce(new Error('closed'));
  mockDescribe.mockResolvedValueOnce({ status: { name: 'RUNNING' } }).mockResolvedValueOnce({ status: { name: 'CANCELLED' } });
  expect(await grantConversationTurnActivity(turn)).toBe(false);
});

it('never turns a network failure into permission for the next turn', async () => {
  mockDescribe.mockRejectedValueOnce(new Error('unavailable'));
  await expect(isConversationTurnRunningActivity(turn)).rejects.toThrow('unavailable');
  expect(mockClose).toHaveBeenCalledTimes(1);
});