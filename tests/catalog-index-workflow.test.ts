import type { ActivityOptions } from '@temporalio/workflow';
import type { CatalogIndexInput } from '../src/temporal/utils/catalogIndexContracts';

const activityOptions: ActivityOptions[] = [];
const mockActivities = { backfillCatalogIndexActivity: jest.fn(), processCatalogIndexActivity: jest.fn() };
const mockContinueAsNew = jest.fn();
const mockSleep = jest.fn();
const mockWorkflowInfo = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: ActivityOptions) => { activityOptions.push(options); return mockActivities; },
  continueAsNew: (...args: unknown[]) => mockContinueAsNew(...args),
  sleep: (...args: unknown[]) => mockSleep(...args),
  workflowInfo: () => mockWorkflowInfo(),
}));

import { catalogIndexWorkflow } from '../src/temporal/workflows/catalogIndexWorkflow';

const site = '00000000-0000-4000-8000-000000000001';
const cursor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const continued = new Error('continue-as-new');
const batch = { success: true, processed: 8, failed: 0, stale: 0, remaining: true };
const idle = { ...batch, processed: 0, remaining: false };

beforeEach(() => {
  jest.resetAllMocks();
  mockActivities.processCatalogIndexActivity.mockResolvedValue(idle);
  mockActivities.backfillCatalogIndexActivity.mockResolvedValue({ success: true, processed: 0, next_cursor: null, has_more: false });
  mockWorkflowInfo.mockReturnValue({ continueAsNewSuggested: false });
  mockContinueAsNew.mockImplementation(() => { throw continued; });
  mockSleep.mockResolvedValue(undefined);
});

test('bounds all retries and activity execution time without delegating HTTP into workflow', () => {
  expect(activityOptions).toEqual([{
    startToCloseTimeout: '240s', scheduleToCloseTimeout: '15m',
    retry: {
      maximumAttempts: 3, initialInterval: '10s', maximumInterval: '60s', backoffCoefficient: 2,
      nonRetryableErrorTypes: ['CATALOG_INDEX_INVALID_INPUT', 'CATALOG_INDEX_INVALID_RESPONSE', 'CATALOG_INDEX_REQUEST_REJECTED'],
    },
  }]);
});

test('default dispatch drains once and ends without sleeping on an empty queue', async () => {
  await expect(catalogIndexWorkflow()).resolves.toEqual({
    success: true, data: { state: 'idle', pages: 0, batches: 1, enqueued: 0, processed: 0, failed: 0, stale: 0 }, error: null,
  });
  expect(mockActivities.processCatalogIndexActivity).toHaveBeenCalledWith({ limit: 8 });
  expect(mockActivities.backfillCatalogIndexActivity).not.toHaveBeenCalled();
  expect(mockSleep).not.toHaveBeenCalled();
});

test('resumes site backfill from its cursor, advances pages, then drains globally', async () => {
  mockActivities.backfillCatalogIndexActivity
    .mockResolvedValueOnce({ success: true, processed: 100, next_cursor: cursor(2), has_more: true })
    .mockResolvedValueOnce({ success: true, processed: 2, next_cursor: cursor(3), has_more: false });
  mockActivities.processCatalogIndexActivity.mockResolvedValueOnce(batch).mockResolvedValueOnce({ ...idle, processed: 2, stale: 1 });
  await expect(catalogIndexWorkflow({ site_id: site, backfill: true, after_id: cursor(1) })).resolves.toEqual({
    success: true, data: { state: 'idle', pages: 2, batches: 2, enqueued: 102, processed: 10, failed: 0, stale: 1 }, error: null,
  });
  expect(mockActivities.backfillCatalogIndexActivity.mock.calls).toEqual([
    [{ site_id: site, after_id: cursor(1), limit: 100 }], [{ site_id: site, after_id: cursor(2), limit: 100 }],
  ]);
  expect(mockActivities.processCatalogIndexActivity.mock.calls).toEqual([[{ limit: 8 }], [{ limit: 8 }]]);
  expect(mockSleep.mock.calls).toEqual([['1s'], ['1s'], ['1s']]);
});

test('rolls over at 25 pages and resumes at last confirmed cursor without accumulated payloads', async () => {
  let page = 0;
  mockActivities.backfillCatalogIndexActivity.mockImplementation(async () => ({
    success: true, processed: 100, next_cursor: cursor(++page), has_more: true,
  }));
  await expect(catalogIndexWorkflow({ site_id: site, backfill: true })).rejects.toBe(continued);
  expect(mockActivities.backfillCatalogIndexActivity).toHaveBeenCalledTimes(25);
  expect(mockActivities.processCatalogIndexActivity).not.toHaveBeenCalled();
  const next = mockContinueAsNew.mock.calls[0][0];
  expect(next).toEqual({ site_id: site, backfill: true, after_id: cursor(25) });
  expect(JSON.stringify(next).length).toBeLessThan(160);
  mockActivities.backfillCatalogIndexActivity.mockResolvedValue({ success: true, processed: 0, next_cursor: null, has_more: false });
  await expect(catalogIndexWorkflow(next)).resolves.toMatchObject({ success: true, data: { state: 'idle' } });
  expect(mockActivities.backfillCatalogIndexActivity).toHaveBeenLastCalledWith({ site_id: site, after_id: cursor(25), limit: 100 });
});

test('last backfill page at history boundary continues in drain mode, never re-enqueues', async () => {
  let page = 0;
  mockActivities.backfillCatalogIndexActivity.mockImplementation(async () => ({
    success: true, processed: 100, next_cursor: cursor(++page), has_more: page < 25,
  }));
  await expect(catalogIndexWorkflow({ backfill: true })).rejects.toBe(continued);
  expect(mockContinueAsNew).toHaveBeenCalledWith({ backfill: false });
  await expect(catalogIndexWorkflow(mockContinueAsNew.mock.calls[0][0])).resolves.toMatchObject({ data: { pages: 0, batches: 1 } });
  expect(mockActivities.backfillCatalogIndexActivity).toHaveBeenCalledTimes(25);
});

test('draining rolls over at 25 batches; suggested rollover honors completed backfill phase', async () => {
  mockActivities.processCatalogIndexActivity.mockResolvedValue(batch);
  await expect(catalogIndexWorkflow({ site_id: site })).rejects.toBe(continued);
  expect(mockActivities.processCatalogIndexActivity).toHaveBeenCalledTimes(25);
  expect(mockContinueAsNew).toHaveBeenCalledWith({ site_id: site, backfill: false });
  mockWorkflowInfo.mockReturnValue({ continueAsNewSuggested: true });
  mockContinueAsNew.mockClear();
  await expect(catalogIndexWorkflow({ backfill: true })).rejects.toBe(continued);
  expect(mockContinueAsNew).toHaveBeenCalledWith({ backfill: false });
});

test.each([
  { ...batch, failed: 1 }, { ...batch, failed: 1, remaining: false }, { ...batch, processed: 0 },
])('ends deferred without spin on failures/no progress: %j', async response => {
  mockActivities.processCatalogIndexActivity.mockResolvedValue(response);
  await expect(catalogIndexWorkflow()).resolves.toMatchObject({ data: { state: 'deferred', batches: 1 } });
  expect(mockSleep).not.toHaveBeenCalled();
  expect(mockContinueAsNew).not.toHaveBeenCalled();
});

test('awaits each activity; never fans out while a batch is still processing', async () => {
  let finish!: (value: typeof batch) => void;
  mockActivities.processCatalogIndexActivity.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const run = catalogIndexWorkflow();
  await Promise.resolve();
  expect(mockActivities.processCatalogIndexActivity).toHaveBeenCalledTimes(1);
  expect(mockSleep).not.toHaveBeenCalled();
  finish(batch);
  await run;
  expect(mockActivities.processCatalogIndexActivity).toHaveBeenCalledTimes(2);
});

test('continues bounded lexical refresh backlog without needing new embeddings', async () => {
  mockActivities.processCatalogIndexActivity.mockResolvedValueOnce({ ...idle, refreshed: 100, remaining: true })
    .mockResolvedValueOnce(idle);
  await expect(catalogIndexWorkflow()).resolves.toMatchObject({ data: { state: 'idle', batches: 2 } });
  expect(mockSleep).toHaveBeenCalledTimes(1);
});

test.each([false, true])('exhausted activity failure remains failed; no cursor skip or drain fallback (backfill=%s)', async backfill => {
  const failure = new Error('bounded activity retries exhausted');
  mockActivities.backfillCatalogIndexActivity.mockRejectedValue(failure);
  mockActivities.processCatalogIndexActivity.mockRejectedValue(failure);
  await expect(catalogIndexWorkflow({ backfill })).rejects.toBe(failure);
  expect(mockContinueAsNew).not.toHaveBeenCalled();
  expect(mockSleep).not.toHaveBeenCalled();
  if (backfill) expect(mockActivities.processCatalogIndexActivity).not.toHaveBeenCalled();
});

test.each([null, [], { backfill: 'true' }, { site_id: 'bad' }, { after_id: cursor(1) }, { backfill: false, after_id: cursor(1) }])(
  'rejects invalid input before activity scheduling: %j', async input => {
    await expect(catalogIndexWorkflow(input as CatalogIndexInput)).rejects.toMatchObject({
      type: 'CATALOG_INDEX_INVALID_INPUT', nonRetryable: true,
    });
    expect(mockActivities.backfillCatalogIndexActivity).not.toHaveBeenCalled();
    expect(mockActivities.processCatalogIndexActivity).not.toHaveBeenCalled();
  }
);