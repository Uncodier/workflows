import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

// Synthetic histories use the actual Temporal replay engine, without a server,
// credentials or live activities. Branch/unit tests separately cover children.
const ownershipPatch = 'poll-social-comments-strict-site-ownership-v1';
const oldPatches = [
  'poll-social-comments-age-filter-v1',
  'poll-social-comments-bucket-cadence-v2',
  'poll-social-comments-batch-claims-v1',
  'poll-social-comments-safe-identifiers-v1',
];
const workflowId = 'pollSocialCommentsWorkflow';
const account = { id: 'account-1', network: 'linkedin', isActive: true };
const site = { site_id: 'site-1', social_media: [account] };
const payloads = (...values: unknown[]) => ({
  payloads: values.map(value => defaultPayloadConverter.toPayload(value)),
});

class HistoryFixture {
  private events: Record<string, unknown>[] = [];
  private completedTaskId = 0;
  private activitySequence = 0;

  constructor(strictOwnership: boolean) {
    const runId = '11111111-1111-4111-8111-111111111111';
    this.event('WorkflowExecutionStarted', {
      workflowType: { name: workflowId }, taskQueue: { name: 'replay' },
      input: payloads(), workflowTaskTimeout: { seconds: 10 },
      originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1,
    });
    this.workflowTask();
    for (const id of strictOwnership ? [...oldPatches, ownershipPatch] : oldPatches) {
      this.event('MarkerRecorded', {
        markerName: 'core_patch',
        details: { 'patch-data': payloads({ id, deprecated: false }) },
        workflowTaskCompletedEventId: this.completedTaskId,
      });
    }
    this.activity('logWorkflowExecutionActivity', [{
      workflowId, workflowType: workflowId, status: 'STARTED', input: {},
    }], null);
  }

  private event(type: string, attributes: Record<string, unknown>): number {
    this.events.push({
      eventId: this.events.length + 1,
      eventTime: { seconds: 1790424000 + this.events.length, nanos: 0 },
      eventType: `EVENT_TYPE_${type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
      [`${type[0].toLowerCase()}${type.slice(1)}EventAttributes`]: attributes,
    });
    return this.events.length;
  }

  private workflowTask(): void {
    const scheduled = this.event('WorkflowTaskScheduled', {
      taskQueue: { name: 'replay' }, startToCloseTimeout: { seconds: 10 }, attempt: 1,
    });
    const started = this.event('WorkflowTaskStarted', {
      scheduledEventId: scheduled, identity: 'replay-test', requestId: 'workflow-task',
    });
    this.completedTaskId = this.event('WorkflowTaskCompleted', {
      scheduledEventId: scheduled, startedEventId: started, identity: 'replay-test',
    });
  }

  activity(name: string, args: unknown[], result: unknown): void {
    const scheduled = this.event('ActivityTaskScheduled', {
      activityId: String(++this.activitySequence), activityType: { name },
      taskQueue: { name: 'replay' }, input: payloads(...args),
      startToCloseTimeout: { seconds: 120 },
      workflowTaskCompletedEventId: this.completedTaskId,
      retryPolicy: {
        initialInterval: { seconds: 2 }, backoffCoefficient: 2,
        maximumInterval: { seconds: 30 }, maximumAttempts: 3,
      },
    });
    const started = this.event('ActivityTaskStarted', {
      scheduledEventId: scheduled, identity: 'replay-test', requestId: 'activity-task', attempt: 1,
    });
    this.event('ActivityTaskCompleted', {
      scheduledEventId: scheduled, startedEventId: started,
      identity: 'replay-test', result: payloads(result),
    });
    this.workflowTask();
  }

  complete(processedPosts = 0) {
    const output = { processedPosts, processedComments: 0 };
    this.activity('logWorkflowExecutionActivity', [{
      workflowId, workflowType: workflowId, status: 'COMPLETED', input: {}, output,
    }], null);
    this.event('WorkflowExecutionCompleted', {
      workflowTaskCompletedEventId: this.completedTaskId,
      result: payloads({ success: true, ...output }),
    });
    return temporal.api.history.v1.History.fromObject({ events: this.events });
  }
}

function importHistory(strictOwnership: boolean, filterImports = strictOwnership) {
  const fixture = new HistoryFixture(strictOwnership);
  fixture.activity('fetchSitesWithSocialCommentsActivity', [], [site]);
  fixture.activity('fetchOutstandPostsActivity', [site.site_id, 100, 0], []);
  fixture.activity('checkIfImportTriggeredActivity', [site.site_id], false);
  fixture.activity('fetchOutstandAccountsActivity', [site.site_id], [
    { id: 'foreign-account', network: 'facebook' }, account,
  ]);
  if (!filterImports) {
    fixture.activity('importOutstandPostsActivity', [site.site_id, 'foreign-account'], {});
  }
  fixture.activity('importOutstandPostsActivity', [site.site_id, account.id], {});
  fixture.activity('markImportTriggeredActivity', [site.site_id], null);
  return fixture.complete();
}

function ambiguousPostHistory(strictOwnership: boolean, filterPosts = strictOwnership) {
  const fixture = new HistoryFixture(strictOwnership);
  const sites = [site, { ...site, site_id: 'site-2' }];
  const post = {
    id: 'post-1', publishedAt: '2026-09-26T12:00:00.000Z',
    socialAccounts: [{ ...account, status: 'published', platformPostId: 'platform-post-1' }],
  };
  fixture.activity('fetchSitesWithSocialCommentsActivity', [], sites);
  for (const candidate of sites) {
    fixture.activity('fetchOutstandPostsActivity', [candidate.site_id, 100, 0], [post]);
    if (!filterPosts) {
      fixture.activity('upsertContentFromOutstandPostActivity', [candidate.site_id, post, candidate.social_media], 'content-1');
      fixture.activity('fetchOutstandPostRepliesActivity', [candidate.site_id, post.id, 'linkedin'], []);
    }
  }
  return fixture.complete(filterPosts ? 0 : 2);
}

describe('pollSocialCommentsWorkflow Temporal replay', () => {
  let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/pollSocialCommentsWorkflow.ts'),
      logger: new DefaultLogger('ERROR'),
      webpackConfigHook: config => {
        config.resolve = {
          ...config.resolve,
          alias: {
            ...config.resolve?.alias,
            './ingestSocialCommentWorkflow$': path.resolve(__dirname, 'fixtures/outstand-replay-child.ts'),
          },
        };
        return config;
      },
    });
  });

  afterAll(async () => {
    await Runtime.instance().shutdown();
  });

  it.each([false, true])('replays historical imports with ownership marker = %s', async strictOwnership => {
    await Worker.runReplayHistory({ workflowBundle }, importHistory(strictOwnership), 'import-replay');
  });

  it.each([false, true])('replays ambiguous posts with ownership marker = %s', async strictOwnership => {
    await Worker.runReplayHistory({ workflowBundle }, ambiguousPostHistory(strictOwnership), 'post-replay');
  });

  it.each([
    ['imports', () => importHistory(true, false)],
    ['posts', () => ambiguousPostHistory(true, false)],
  ] as const)('detects an incompatible %s activity sequence (negative control)', async (_label, buildHistory) => {
    // Valid marker order, but intentionally retain the foreign import after
    // the strict ownership marker. The command sequence must not match.
    const history = buildHistory();
    const results = [];
    for await (const result of Worker.runReplayHistories({ workflowBundle }, [{ history, workflowId: 'negative-control' }])) {
      results.push(result);
    }
    expect(results).toHaveLength(1);
    expect(results[0].error).toMatchObject({ name: 'DeterminismViolationError' });
  });
});