import path from 'node:path';
import { readFileSync } from 'node:fs';
import { historyFromJSON } from '@temporalio/common/lib/proto-utils';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { temporal } from '@temporalio/proto';
import { channelHistories, senderType, supportId, type Scenario } from './fixtures/channel-replay/scenarios';

const fixture = (name: string) => path.join(__dirname, 'fixtures/channel-replay', name);
let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
beforeAll(async () => {
  const logger = new DefaultLogger('ERROR');
  Runtime.install({ logger, telemetryOptions: { logging: { filter: { core: 'ERROR' } } } });
  workflowBundle = await bundleWorkflowCode({ workflowsPath: fixture('workflows.ts'),
    workflowInterceptorModules: [fixture('observe-commands.ts')], logger });
});
afterAll(async () => { await Runtime.instance().shutdown(); });

// These golden files are closed synthetic service histories, not live exports.
const golden = (name: string) => temporal.api.history.v1.History.create(
  historyFromJSON(JSON.parse(readFileSync(fixture(`old-pinned-${name}.json`), 'utf8')))
);

type Command = { activity?: string; child?: string; patch?: string; returned?: unknown; failed?: string };
async function replay(id: string, history: temporal.api.history.v1.History) {
  const commands: Command[] = [];
  const terminal = history.events[history.events.length - 1];
  expect(terminal.workflowExecutionCompletedEventAttributes || terminal.workflowExecutionFailedEventAttributes).toBeTruthy();
  await Worker.runReplayHistory({ workflowBundle, sinks: { trace: { record: {
    callDuringReplay: true, fn: (_info, command: Command) => { commands.push(command); },
  } } } }, history, id);
  return commands;
}

const scenarios: Scenario[] = ['old unpinned', 'old pinned', 'old pinned send failed', 'accepted', 'native media accepted',
  'send timeout', 'activity no receipt', 'legacy child no receipt', 'generation timeout', 'draft', 'disabled'];
it.each(scenarios)('replays closed channel support history and checks emitted commands: %s', async scenario => {
  const { history, activityCommands, patches, returned, child } = channelHistories(scenario);
  const parent = await replay(supportId, scenario === 'old pinned' ? golden('support') : history);
  expect(parent.filter(c => c.activity)).toEqual(activityCommands);
  expect(parent.filter(c => c.patch).map(c => c.patch)).toEqual(patches);
  expect(parent.filter(c => c.child)).toEqual(child ? [{ child: senderType, id: child.id, args: child.args,
    parentClosePolicy: 3 /* REQUEST_CANCEL */ }] : []);
  expect(parent.filter(c => c.returned || c.failed)).toEqual([{ returned }]);
  if (child?.history) {
    // Parent replay cannot execute a child. Independently replay the child's own
    // closed history and compare its actual completion to the parent fixture.
    const sender = await replay(child.id, scenario === 'old pinned' ? golden('sender') : child.history);
    expect(sender.filter(c => c.activity)).toEqual([{ activity: child.activity, args: child.args, attempts: child.attempts }]);
    expect(sender.filter(c => c.child)).toEqual([]);
    expect(sender.filter(c => c.patch).map(c => c.patch)).toEqual([child.patch]);
    const expectedError = child.terminal.failure;
    expect(sender.filter(c => c.returned || c.failed)).toEqual([expectedError
      ? { failed: expectedError.message, cause: expectedError.cause.message, failedActivity: child.activity,
          causeType: 'applicationFailureInfo' in expectedError.cause ? expectedError.cause.applicationFailureInfo.type
            : temporal.api.enums.v1.TimeoutType.TIMEOUT_TYPE_START_TO_CLOSE } : { returned: child.terminal.result }]);
  }
});

// Negative control: an unrelated historical send is a real Core nondeterminism,
// not something the test silently consumes with mocks or a prefix-only replay.
it('rejects a closed history with the wrong send activity type', async () => {
  const { child } = channelHistories('old pinned');
  const history = golden('sender');
  const sent = history.events.find(event => event.activityTaskScheduledEventAttributes);
  sent!.activityTaskScheduledEventAttributes!.activityType = { name: 'unexpectedSender' };
  await expect(replay(child!.id, history)).rejects.toThrow(/nondeterminism.*unexpectedSender/is);
});
