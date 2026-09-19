import { ApplicationFailure } from '@temporalio/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../../config/config';

export type SessionRecordingConsolidationState =
  | 'pending'
  | 'session_complete'
  | 'complete';

export interface ConsolidateSessionRecordingBatchResult {
  state: SessionRecordingConsolidationState;
  merged_rows: number;
  session_id?: string;
  has_more?: boolean;
}

interface SupabaseRpcError {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
}

let maintenanceClient: SupabaseClient | undefined;

function getMaintenanceClient(): SupabaseClient {
  if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey) {
    throw ApplicationFailure.nonRetryable(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for session recording maintenance',
      'SESSION_RECORDING_INVALID_CONFIGURATION'
    );
  }

  maintenanceClient ??= createClient(
    supabaseConfig.url,
    supabaseConfig.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return maintenanceClient;
}

export function isManifestConflict(error: SupabaseRpcError): boolean {
  const errorText = [
    error.code,
    error.message,
    error.details,
    error.hint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    /\bmanifests?\b[\s\S]*\bconflict\b/.test(errorText) ||
    /\bconflict\b[\s\S]*\bmanifests?\b/.test(errorText)
  );
}

function parseBatchResult(data: unknown): ConsolidateSessionRecordingBatchResult {
  const result = Array.isArray(data) && data.length === 1 ? data[0] : data;

  if (!result || typeof result !== 'object') {
    throw ApplicationFailure.nonRetryable(
      'The consolidation RPC returned an invalid result',
      'SESSION_RECORDING_INVALID_RESPONSE'
    );
  }

  const candidate = result as Record<string, unknown>;
  const normalizedState =
    candidate.state === 'retry' ? 'pending' : candidate.state;
  const validStates: SessionRecordingConsolidationState[] = [
    'pending',
    'session_complete',
    'complete',
  ];

  if (
    !validStates.includes(normalizedState as SessionRecordingConsolidationState) ||
    typeof candidate.merged_rows !== 'number' ||
    !Number.isFinite(candidate.merged_rows) ||
    candidate.merged_rows < 0
  ) {
    throw ApplicationFailure.nonRetryable(
      'The consolidation RPC returned an invalid state or merged_rows value',
      'SESSION_RECORDING_INVALID_RESPONSE'
    );
  }

  return {
    state: normalizedState as SessionRecordingConsolidationState,
    merged_rows: candidate.merged_rows,
    ...(typeof candidate.session_id === 'string'
      ? { session_id: candidate.session_id }
      : {}),
    ...(typeof candidate.has_more === 'boolean'
      ? { has_more: candidate.has_more }
      : {}),
  };
}

export async function executeConsolidationRpc(
  client: Pick<SupabaseClient, 'rpc'>,
  batchSize: number
): Promise<ConsolidateSessionRecordingBatchResult> {
  const { data, error } = await client.rpc(
    'consolidate_session_recording_duplicates',
    { p_row_limit: batchSize }
  );

  if (error) {
    const nonRetryable = isManifestConflict(error);
    throw ApplicationFailure.create({
      message: `Session recording consolidation failed: ${error.message}`,
      type: nonRetryable
        ? 'SESSION_RECORDING_MANIFEST_CONFLICT'
        : 'SESSION_RECORDING_RPC_FAILURE',
      nonRetryable,
      details: [{
        code: error.code,
        details: error.details,
        hint: error.hint,
      }],
    });
  }

  return parseBatchResult(data);
}

export async function consolidateSessionRecordingBatch(
  batchSize = 500
): Promise<ConsolidateSessionRecordingBatchResult> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw ApplicationFailure.nonRetryable(
      'batchSize must be a positive integer',
      'SESSION_RECORDING_INVALID_INPUT'
    );
  }

  return executeConsolidationRpc(getMaintenanceClient(), batchSize);
}
