const mockHandlers = new Map<string, (...args: any[]) => void>();
const mockStart = jest.fn();
const mockCondition = jest.fn();
const mockContinue = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  defineSignal: (name: string) => name,
  setHandler: (name: string, handler: (...args: any[]) => void) => mockHandlers.set(name, handler),
  startChild: (...args: any[]) => mockStart(...args),
  condition: (...args: any[]) => mockCondition(...args),
  continueAsNew: (...args: any[]) => mockContinue(...args),
  isCancellation: (error: any) => error?.name === 'CancelledFailure',
  ParentClosePolicy: { PARENT_CLOSE_POLICY_ABANDON: 'ABANDON' },
}));
import { conversationIngressWorkflow, type ConversationMessageSubmission } from '../src/temporal/workflows/conversationIngressWorkflow';

const submission = (id: string): ConversationMessageSubmission => ({ workflowId: id,
  workflowType: 'customerSupportMessageWorkflow', args: [{ message: id }], taskQueue: 'high' });
beforeEach(() => {
  jest.resetAllMocks(); mockHandlers.clear();
  mockCondition.mockImplementation(async predicate => predicate());
  mockStart.mockImplementation(async () => ({ result: async () => ({ success: true }) }));
});

it('admits messages durably before starting any child and waits for complete delivery', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  mockCondition.mockImplementationOnce(async predicate => {
    const accept = mockHandlers.get('submitConversationMessage')!;
    accept(submission('first')); accept(submission('second')); accept(submission('first'));
    return predicate();
  });
  mockStart.mockImplementation(async (_type, options) => {
    events.push(`start:${options.workflowId}`);
    return { result: () => options.workflowId === 'first'
      ? new Promise<void>(resolve => { releaseFirst = resolve; }) : Promise.resolve() };
  });
  const execution = conversationIngressWorkflow();
  for (let n = 0; n < 5; n++) await Promise.resolve();
  expect(events).toEqual(['start:first']);
  releaseFirst();
  await execution;
  expect(events).toEqual(['start:first', 'start:second']);
  expect(mockStart.mock.calls[0][1]).toMatchObject({ args: [{ message: 'first' }],
    taskQueue: 'high', parentClosePolicy: 'ABANDON', workflowIdReusePolicy: 'REJECT_DUPLICATE' });
});

it('continues after a settled child failure or explicit child cancellation', async () => {
  mockStart.mockResolvedValueOnce({ result: async () => { throw new Error('child failed'); } });
  await conversationIngressWorkflow([submission('first'), submission('second')]);
  expect(mockStart).toHaveBeenCalledTimes(2);
});

it('does not silently discard an identity/start error', async () => {
  mockStart.mockRejectedValueOnce(new Error('start failed'));
  await expect(conversationIngressWorkflow([submission('first'), submission('second')])).rejects.toThrow('start failed');
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it('rolls over only between completed child executions, preserving the inbox', async () => {
  const messages = Array.from({ length: 101 }, (_, n) => submission(`message-${n}`));
  await conversationIngressWorkflow([...messages]);
  expect(mockStart).toHaveBeenCalledTimes(100);
  expect(mockContinue).toHaveBeenCalledWith([messages[100]], messages.map(message => message.workflowId));
});