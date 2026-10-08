import { randomBytes } from 'node:crypto';
import { NativeConnection, Worker } from '@temporalio/worker';
import { temporalConfig } from '../src/config/config';
import { logger } from '../src/lib/logger';
import { startWorker } from '../src/temporal/workers/worker';

jest.mock('@temporalio/worker', () => ({
  NativeConnection: { connect: jest.fn() }, Worker: { create: jest.fn() },
}));
jest.mock('../src/config/config', () => ({
  temporalConfig: {
    serverUrl: 'temporal.example.test:7233', namespace: 'test-namespace',
    taskQueue: 'test-queue', tls: true, apiKey: '',
  },
  workerVersioningConfig: { useWorkerVersioning: false },
}));
jest.mock('../src/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../src/temporal/activities', () => ({ activities: {} }));
jest.mock('../src/temporal/workflows/worker-workflows', () => ({}));

describe('Temporal worker connection logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes a runtime-generated credential to Temporal but never includes it in startup logs', async () => {
    const credential = randomBytes(32).toString('hex');
    temporalConfig.apiKey = credential;
    const output: string[] = [];
    for (const method of ['log', 'warn', 'error'] as const) {
      jest.spyOn(console, method).mockImplementation((...values: unknown[]) => {
        output.push(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
      });
    }
    jest.mocked(NativeConnection.connect).mockResolvedValue({ close: jest.fn() } as never);
    jest.mocked(Worker.create).mockResolvedValue({ run: jest.fn(async () => {}), shutdown: jest.fn() } as never);

    const started = await startWorker();
    expect(started).toBeDefined();
    expect(NativeConnection.connect).toHaveBeenCalledWith(expect.objectContaining({ apiKey: credential }));
    expect(Worker.create).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify({ output, info: jest.mocked(logger.info).mock.calls,
      errors: jest.mocked(logger.error).mock.calls, warnings: jest.mocked(logger.warn).mock.calls });
    expect(logged).not.toContain(credential);
  });
});