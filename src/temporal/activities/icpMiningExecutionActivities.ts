import { supabaseServiceRole } from '../../lib/supabase/client';
import { getTemporalClient } from '../client';

export interface IcpPageSnapshot {
  page: number;
  candidates: any[];
  hasMore: boolean;
  total?: number;
}
export interface IcpCheckpoint {
  id: string; site_id: string; run_id: string; version: number;
  processed: number; found: number; page: number; offset: number;
  total?: number; status: 'running' | 'pending' | 'completed';
  snapshot: IcpPageSnapshot | null; errors?: string[];
}

export async function claimIcpMiningExecutionActivity(params: { id: string; site_id: string; run_id: string; workflow_id: string }): Promise<{
  acquired: boolean; reason?: string; icp?: any;
}> {
  const claim = async (previousRun?: string) => {
    const { data, error } = await supabaseServiceRole.rpc('claim_icp_mining_execution', {
      p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id,
      p_workflow_id: params.workflow_id, p_previous_run_id: previousRun ?? null,
    });
    if (error) throw new Error(`Mining claim failed: ${error.message}`);
    if (!data || typeof data.acquired !== 'boolean') throw new Error('Mining claim returned an invalid response');
    return data;
  };
  const result = await claim();
  if (result.acquired || result.reason !== 'busy') return result;
  // Never use a clock timeout to steal a live workflow's claim. If Temporal is
  // unavailable (or history expired), fail closed for manual investigation.
  const client = await getTemporalClient();
  try {
    const description = await client.workflow.getHandle(result.owner_workflow_id, result.owner_run_id).describe();
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'];
    if (!terminal.includes(description.status.name)) return { acquired: false, reason: 'busy' };
    return await claim(result.owner_run_id);
  } finally {
    await client.connection.close();
  }
}

export async function checkpointIcpMiningExecutionActivity(params: IcpCheckpoint): Promise<{ success: boolean; applied?: boolean }> {
  const { data, error } = await supabaseServiceRole.rpc('checkpoint_icp_mining_execution', {
    p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id, p_version: params.version,
    p_processed: params.processed, p_found: params.found, p_page: params.page, p_offset: params.offset,
    p_total: params.total ?? null, p_status: params.status, p_snapshot: params.snapshot,
    p_errors: (params.errors || []).map(message => ({ message, timestamp: new Date().toISOString() })),
  });
  if (error) throw new Error(`Mining checkpoint failed: ${error.message}`);
  if (!data?.success) throw new Error('Mining checkpoint was not acknowledged');
  return data;
}