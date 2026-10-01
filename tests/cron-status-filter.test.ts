import * as fs from 'fs';
import * as path from 'path';
import type { CronStatusUpdate } from '../src/temporal/activities/cronActivities';

const mockService = {
  getConnectionStatus: jest.fn(),
  batchUpsertCronStatus: jest.fn(),
};
const mockGetSupabaseService = jest.fn();

jest.mock('../src/temporal/services', () => ({
  getSupabaseService: mockGetSupabaseService,
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const cronIndexPath = path.resolve(__dirname, '../docs/cron_index.md');
const documentedCronIndex = jest.requireActual<typeof fs>('fs').readFileSync(cronIndexPath, 'utf-8');
const mockExistsSync = jest.mocked(fs.existsSync);
const mockReadFileSync = jest.mocked(fs.readFileSync);
const now = '2026-09-30T12:00:00.000Z';
const nextRun = '2026-10-01T12:00:00.000Z';
const statuses = ['SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
const icpWorkflow = 'idealClientProfileMiningWorkflow';
const realWorkflows = [
  'syncEmailsWorkflow',
  'dailyProspectionWorkflow',
  'leadGenerationWorkflow',
  'dailyStrategicAccountsWorkflow',
  'dailyStandUpWorkflow',
  'analyzeSiteWorkflow',
  icpWorkflow,
];
const excludedWorkflows = [
  'scheduleActivitiesWorkflow',
  'syncEmailsScheduleWorkflow',
  'activityPrioritizationEngineWorkflow',
  'dailyOperationsWorkflow',
  'delayedExecutionWorkflow',
  'buildCampaignsWorkflow',
  'deepResearchWorkflow',
  'unknownWorkflow',
];

function icpUpdate(status: string): CronStatusUpdate {
  return {
    siteId: 'site-icp',
    workflowId: 'icp-workflow-id',
    scheduleId: 'icp-schedule-id',
    activityName: icpWorkflow,
    status,
  };
}

function loadActivities(): typeof import('../src/temporal/activities/cronActivities') {
  let activities!: typeof import('../src/temporal/activities/cronActivities');
  // Each case must reload the module-local allowlist cache, not reuse a prior source.
  jest.isolateModules(() => {
    activities = require('../src/temporal/activities/cronActivities');
  });
  return activities;
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date(now));
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockGetSupabaseService.mockReturnValue(mockService);
  mockService.getConnectionStatus.mockResolvedValue(true);
  mockService.batchUpsertCronStatus.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const sources = [
  { name: 'documented allowlist', exists: true, content: documentedCronIndex },
  { name: 'missing docs (compiled fallback)', exists: false },
  { name: 'malformed docs', exists: true, content: '# Cron index without an allowlist' },
  { name: 'empty allowlist', exists: true, content: '```typescript\nconst CRON_SCHEDULED_WORKFLOWS = [\n];\n```' },
  { name: 'unparseable entries', exists: true, content: '```typescript\nconst CRON_SCHEDULED_WORKFLOWS = [\ninvalid-entry\n];\n```' },
  { name: 'unreadable docs', exists: true, readError: new Error('EACCES: permission denied') },
];

describe.each(sources)('cron status filtering with $name', source => {
  let activities: ReturnType<typeof loadActivities>;

  beforeEach(() => {
    mockExistsSync.mockReturnValue(source.exists);
    mockReadFileSync.mockImplementation(() => {
      if (source.readError) throw source.readError;
      return source.content || '';
    });
    activities = loadActivities();
  });

  it.each(statuses)('saves ICP %s with the supplied workflow and schedule IDs', async status => {
    const update = {
      ...icpUpdate(status),
      nextRun: status === 'SCHEDULED' ? nextRun : null,
      errorMessage: status === 'FAILED' ? 'ICP mining failed' : null,
      retryCount: status === 'FAILED' ? 2 : 0,
    };

    await activities.saveCronStatusActivity(update);

    expect(mockGetSupabaseService).toHaveBeenCalledTimes(1);
    expect(mockService.getConnectionStatus).toHaveBeenCalledTimes(1);
    expect(mockService.batchUpsertCronStatus).toHaveBeenCalledTimes(1);
    expect(mockService.batchUpsertCronStatus).toHaveBeenCalledWith([{
      site_id: update.siteId,
      workflow_id: update.workflowId,
      schedule_id: update.scheduleId,
      activity_name: icpWorkflow,
      status,
      last_run: status === 'COMPLETED' || status === 'FAILED' ? now : null,
      next_run: update.nextRun,
      error_message: update.errorMessage,
      retry_count: update.retryCount,
    }]);
    expect(mockExistsSync).toHaveBeenCalledWith(cronIndexPath);
    if (source.exists) {
      expect(mockReadFileSync).toHaveBeenCalledWith(cronIndexPath, 'utf-8');
    } else {
      expect(mockReadFileSync).not.toHaveBeenCalled();
    }
    if (source.content === documentedCronIndex) {
      expect(console.warn).not.toHaveBeenCalled();
    } else {
      expect(console.warn).toHaveBeenCalled();
    }
  });

  it('batch-saves all ICP states and other real-work workflows, filtering manual and orchestration records', async () => {
    const accepted = [
      ...statuses.map(status => ({ ...icpUpdate(status), siteId: `icp-${status}` })),
      ...realWorkflows.filter(name => name !== icpWorkflow).map(activityName => ({
        ...icpUpdate('SCHEDULED'), activityName,
      })),
    ];
    const excluded = excludedWorkflows.map(activityName => ({ ...icpUpdate('RUNNING'), activityName }));
    const manual = { ...icpUpdate('COMPLETED'), scheduleId: 'manual-execution' };

    await activities.batchSaveCronStatusActivity([...accepted, ...excluded, manual]);

    expect(mockService.getConnectionStatus).toHaveBeenCalledTimes(1);
    expect(mockService.batchUpsertCronStatus).toHaveBeenCalledTimes(1);
    expect(mockService.batchUpsertCronStatus).toHaveBeenCalledWith(accepted.map(update => expect.objectContaining({
      site_id: update.siteId,
      workflow_id: update.workflowId,
      schedule_id: update.scheduleId,
      activity_name: update.activityName,
      status: update.status,
    })));
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
    expect(mockReadFileSync).toHaveBeenCalledTimes(source.exists ? 1 : 0);
  });

  it.each(statuses)('never saves manual-execution ICP %s records, singly or in batches', async status => {
    const update = { ...icpUpdate(status), scheduleId: 'manual-execution' };

    await activities.saveCronStatusActivity(update);
    await activities.batchSaveCronStatusActivity([update]);

    expect(mockGetSupabaseService).not.toHaveBeenCalled();
    expect(mockService.getConnectionStatus).not.toHaveBeenCalled();
    expect(mockService.batchUpsertCronStatus).not.toHaveBeenCalled();
  });

  it('does not contact the database for excluded workflows or an empty batch', async () => {
    const updates = excludedWorkflows.map(activityName => ({ ...icpUpdate('RUNNING'), activityName }));
    for (const update of updates) {
      await activities.saveCronStatusActivity(update);
    }
    await activities.batchSaveCronStatusActivity(updates);
    await activities.batchSaveCronStatusActivity([]);

    expect(mockGetSupabaseService).not.toHaveBeenCalled();
    expect(mockService.batchUpsertCronStatus).not.toHaveBeenCalled();
  });
});

it('uses and caches a valid Markdown allowlist rather than always using the compiled fallback', async () => {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(`\`\`\`typescript\nconst CRON_SCHEDULED_WORKFLOWS = [\n  '${icpWorkflow}'\n];\n\`\`\``);
  const activities = loadActivities();

  await activities.saveCronStatusActivity(icpUpdate('RUNNING'));
  // Changing the file after the first read does not replace the cached allowlist.
  mockReadFileSync.mockReturnValue(documentedCronIndex);
  await activities.saveCronStatusActivity({ ...icpUpdate('RUNNING'), activityName: 'syncEmailsWorkflow' });
  await activities.batchSaveCronStatusActivity([icpUpdate('COMPLETED')]);

  expect(mockService.batchUpsertCronStatus).toHaveBeenCalledTimes(2);
  expect(mockExistsSync).toHaveBeenCalledTimes(1);
  expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  expect(console.warn).not.toHaveBeenCalled();
});