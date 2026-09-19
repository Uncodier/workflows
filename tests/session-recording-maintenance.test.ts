import { ApplicationFailure } from '@temporalio/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  executeConsolidationRpc,
  isManifestConflict,
} from '../src/temporal/activities/sessionRecordingMaintenanceActivities';

type RpcClient = Pick<SupabaseClient, 'rpc'>;

function createRpcClient(
  response: { data: unknown; error: unknown }
): { client: RpcClient; rpc: jest.Mock } {
  const rpc = jest.fn().mockResolvedValue(response);
  return {
    client: { rpc } as unknown as RpcClient,
    rpc,
  };
}

describe('session recording maintenance activity', () => {
  it('calls the consolidation RPC with the requested batch size', async () => {
    const { client, rpc } = createRpcClient({
      data: {
        state: 'session_complete',
        merged_rows: 42,
        session_id: 'session-1',
        has_more: true,
      },
      error: null,
    });

    await expect(executeConsolidationRpc(client, 500)).resolves.toEqual({
      state: 'session_complete',
      merged_rows: 42,
      session_id: 'session-1',
      has_more: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      'consolidate_session_recording_duplicates',
      { p_row_limit: 500 }
    );
  });

  it('accepts a single-row table response', async () => {
    const { client } = createRpcClient({
      data: [{ state: 'complete', merged_rows: 0, has_more: false }],
      error: null,
    });

    await expect(executeConsolidationRpc(client, 500)).resolves.toEqual({
      state: 'complete',
      merged_rows: 0,
      has_more: false,
    });
  });

  it('marks manifest conflicts as non-retryable', async () => {
    const { client } = createRpcClient({
      data: null,
      error: {
        code: 'P0001',
        message: 'Session manifest conflict detected',
      },
    });

    await expect(executeConsolidationRpc(client, 500)).rejects.toMatchObject({
      type: 'SESSION_RECORDING_MANIFEST_CONFLICT',
      nonRetryable: true,
    } satisfies Partial<ApplicationFailure>);
  });

  it('keeps other RPC failures retryable', async () => {
    const { client } = createRpcClient({
      data: null,
      error: {
        code: '08006',
        message: 'Connection failure',
      },
    });

    await expect(executeConsolidationRpc(client, 500)).rejects.toMatchObject({
      type: 'SESSION_RECORDING_RPC_FAILURE',
      nonRetryable: false,
    } satisfies Partial<ApplicationFailure>);
  });

  it('recognizes manifest conflicts across Supabase error fields', () => {
    expect(isManifestConflict({
      message: 'Database request failed',
      details: 'Conflict while updating the recording manifest',
    })).toBe(true);
  });
});
