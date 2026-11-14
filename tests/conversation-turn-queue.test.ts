const mockHandlers = new Map<string, (...args: any[]) => void>();
const mockGrant = jest.fn();
const mockRunning = jest.fn();
const mockEnqueue = jest.fn();
const mockCondition = jest.fn();
const mockSleep = jest.fn();
const mockContinue = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  defineSignal: (name: string) => name,
  setHandler: (name: string, handler: (...args: any[]) => void) => mockHandlers.set(name, handler),
  proxyActivities: () => ({ grantConversationTurnActivity: mockGrant,
    isConversationTurnRunningActivity: mockRunning, enqueueConversationTurnActivity: mockEnqueue }),
  condition: (...args: any[]) => mockCondition(...args), sleep: (...args: any[]) => mockSleep(...args),
  continueAsNew: (...args: any[]) => mockContinue(...args),
  workflowInfo: () => ({ workflowId: 'message-one', runId: 'run-one', taskQueue: 'default' }),
}));
import { conversationTurnQueueWorkflow } from '../src/temporal/workflows/conversationTurnQueueWorkflow';
import { waitForConversationTurn } from '../src/temporal/workflows/helpers/waitForConversationTurn';
import { conversationTurnScope, conversationQueueId } from '../src/temporal/utils/conversationTurn';

const first = { workflowId: 'one', runId: 'run-one' };
const second = { workflowId: 'two', runId: 'run-two' };
beforeEach(() => {
  jest.resetAllMocks(); mockHandlers.clear();
  mockCondition.mockImplementation(async predicate => predicate());
  mockGrant.mockResolvedValue(true); mockRunning.mockResolvedValue(false);
});

it('does not admit a later fast turn until the earlier run is terminal', async () => {
  const order: string[] = [];
  mockGrant.mockImplementation(async turn => { order.push(`grant:${turn.runId}`); return true; });
  mockRunning.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
  mockSleep.mockImplementation(async () => {
    expect(order).toEqual(['grant:run-one']);
  });
  await conversationTurnQueueWorkflow([first, second]);
  expect(order).toEqual(['grant:run-one', 'grant:run-two']);
  expect(mockSleep).toHaveBeenCalledTimes(2);
});

it('retains a signal received while the first turn is processing and deduplicates retries', async () => {
  mockGrant.mockImplementation(async turn => {
    if (turn.runId === first.runId) {
      mockHandlers.get('enqueueConversationTurn')!(second);
      mockHandlers.get('enqueueConversationTurn')!(second);
      mockHandlers.get('enqueueConversationTurn')!(first);
    }
    return true;
  });
  await conversationTurnQueueWorkflow([first]);
  expect(mockGrant.mock.calls.map(([turn]) => turn)).toEqual([first, second]);
});

it('skips an explicitly canceled queued run without dropping the next turn', async () => {
  mockGrant.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await conversationTurnQueueWorkflow([first, second]);
  expect(mockRunning).toHaveBeenCalledTimes(1);
  expect(mockRunning).toHaveBeenCalledWith(second);
});

it('fails closed on status uncertainty rather than releasing a still active turn', async () => {
  mockRunning.mockRejectedValue(new Error('Temporal unavailable'));
  await expect(conversationTurnQueueWorkflow([first, second])).rejects.toThrow('Temporal unavailable');
  expect(mockGrant).toHaveBeenCalledTimes(1);
});

it('continues as new only between turns and carries pending entries and retry identities', async () => {
  const turns = Array.from({ length: 101 }, (_, n) => ({ workflowId: `w-${n}`, runId: `r-${n}` }));
  await conversationTurnQueueWorkflow([...turns]);
  expect(mockGrant).toHaveBeenCalledTimes(100);
  expect(mockContinue).toHaveBeenCalledWith([turns[100]], turns.map(turn => turn.runId));
});

it('carries a slow active run through history rollover without granting the next turn', async () => {
  const rollover = new Error('continue-as-new');
  mockRunning.mockResolvedValue(true);
  mockContinue.mockRejectedValue(rollover);
  await expect(conversationTurnQueueWorkflow([first, second])).rejects.toBe(rollover);
  expect(mockGrant).toHaveBeenCalledTimes(1);
  expect(mockContinue).toHaveBeenCalledWith([second], [first.runId, second.runId], first);
});

it('resumes the active run after rollover without granting it again', async () => {
  await conversationTurnQueueWorkflow([second], [first.runId, second.runId], first);
  expect(mockRunning.mock.calls[0]).toEqual([first]);
  expect(mockGrant).toHaveBeenCalledTimes(1);
  expect(mockGrant).toHaveBeenCalledWith(second);
});

it('registers the ready signal before enqueue and only accepts its own run grant', async () => {
  mockEnqueue.mockImplementation(async () => {
    mockHandlers.get('conversationTurnReady')!('wrong-run');
  });
  mockCondition.mockImplementation(async predicate => {
    expect(predicate()).toBe(false);
    mockHandlers.get('conversationTurnReady')!('run-one');
    expect(predicate()).toBe(true);
    return true;
  });
  await waitForConversationTurn({ whatsappData: { siteId: 'site', conversationId: 'conversation' } });
  expect(mockEnqueue).toHaveBeenCalledWith({ siteId: 'site', conversationId: 'conversation',
    taskQueue: 'default', turn: { workflowId: 'message-one', runId: 'run-one' } });
});

it('keeps unrelated conversations/sites independent and does not guess missing scope', async () => {
  expect(conversationQueueId('a', 'c')).not.toBe(conversationQueueId('b', 'c'));
  expect(conversationQueueId('a', 'c')).not.toBe(conversationQueueId('a', 'd'));
  expect(conversationTurnScope({ site_id: 'a', conversationId: 'c' })).toEqual({ siteId: 'a', conversationId: 'c' });
  await waitForConversationTurn({ site_id: 'a', lead_id: 'lead' });
  expect(mockEnqueue).not.toHaveBeenCalled();
});

it('serializes Zavu before CRM conversation resolution and isolates different connections', () => {
  const input = { site_id: 'site', channel_delivery: true, origin: 'whatsapp', custom_data: { source: 'zavu_inbound_message', channel: 'whatsapp',
    connection_id: 'connection', zavu_sender_id: 'business', zavu_from: 'customer' } };
  const scope = conversationTurnScope(input);
  expect(scope).toBeDefined();
  expect(conversationTurnScope({ ...input, conversation_id: 'resolved-id' })).toEqual(scope);
  expect(conversationTurnScope({ ...input, custom_data: { ...input.custom_data, connection_id: 'other' } })).not.toEqual(scope);
  expect(conversationTurnScope({ site_id: 'site', phone: 'customer' })).toBeUndefined();
});