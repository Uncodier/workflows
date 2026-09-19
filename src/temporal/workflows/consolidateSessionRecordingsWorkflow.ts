import {
  ApplicationFailure,
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import type {
  ConsolidateSessionRecordingBatchResult,
} from '../activities/sessionRecordingMaintenanceActivities';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_DELAY_MS = 2_000;
const BATCHES_PER_RUN = 100;
export const SESSION_RECORDING_DEDUP_WORKFLOW_ID =
  'session-recording-dedup-v1';

const { consolidateSessionRecordingBatch } = proxyActivities<{
  consolidateSessionRecordingBatch(
    batchSize: number
  ): Promise<ConsolidateSessionRecordingBatchResult>;
}>({
  startToCloseTimeout: '60s',
  retry: {
    maximumAttempts: 5,
    initialInterval: '10s',
    maximumInterval: '60s',
    nonRetryableErrorTypes: [
      'SESSION_RECORDING_INVALID_CONFIGURATION',
      'SESSION_RECORDING_INVALID_INPUT',
      'SESSION_RECORDING_INVALID_RESPONSE',
      'SESSION_RECORDING_MANIFEST_CONFLICT',
    ],
  },
});

export interface ConsolidateSessionRecordingsInput {
  batchSize?: number;
  delayMs?: number;
  processedRows?: number;
}

export interface ConsolidateSessionRecordingsResult {
  state: 'complete';
  processedRows: number;
  batchesProcessedInRun: number;
}

function requireNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw ApplicationFailure.nonRetryable(
      `${fieldName} must be a non-negative integer`,
      'SESSION_RECORDING_INVALID_INPUT'
    );
  }

  return value;
}

export async function consolidateSessionRecordingsWorkflow(
  input: ConsolidateSessionRecordingsInput = {}
): Promise<ConsolidateSessionRecordingsResult> {
  if (workflowInfo().workflowId !== SESSION_RECORDING_DEDUP_WORKFLOW_ID) {
    throw ApplicationFailure.nonRetryable(
      `Workflow ID must be ${SESSION_RECORDING_DEDUP_WORKFLOW_ID}`,
      'SESSION_RECORDING_INVALID_WORKFLOW_ID'
    );
  }

  const batchSize = requireNonNegativeInteger(
    input.batchSize ?? DEFAULT_BATCH_SIZE,
    'batchSize'
  );
  const delayMs = requireNonNegativeInteger(
    input.delayMs ?? DEFAULT_DELAY_MS,
    'delayMs'
  );
  let processedRows = requireNonNegativeInteger(
    input.processedRows ?? 0,
    'processedRows'
  );

  if (batchSize === 0) {
    throw ApplicationFailure.nonRetryable(
      'batchSize must be greater than zero',
      'SESSION_RECORDING_INVALID_INPUT'
    );
  }

  for (let batch = 1; batch <= BATCHES_PER_RUN; batch += 1) {
    const result = await consolidateSessionRecordingBatch(batchSize);
    processedRows += result.merged_rows;

    if (result.state === 'complete') {
      return {
        state: 'complete',
        processedRows,
        batchesProcessedInRun: batch,
      };
    }

    await sleep(delayMs);

    if (batch === BATCHES_PER_RUN) {
      return continueAsNew<typeof consolidateSessionRecordingsWorkflow>({
        batchSize,
        delayMs,
        processedRows,
      });
    }
  }

  throw ApplicationFailure.nonRetryable(
    'Session recording consolidation reached an unexpected workflow state',
    'SESSION_RECORDING_INVALID_STATE'
  );
}
