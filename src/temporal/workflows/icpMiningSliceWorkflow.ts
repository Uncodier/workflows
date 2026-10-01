import { proxyActivities, executeChild, workflowInfo } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { idealClientProfilePageSearchWorkflow } from './idealClientProfilePageSearchWorkflow';
import { classifyIcpDispatchCooldown } from '../utils/icpDispatchSelection';

const { beginIcpDispatchActivity, finishIcpDispatchActivity, checkpointIcpMiningExecutionActivity, getSiteActivity, saveCronStatusActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', retry: { maximumAttempts: 3 },
});

/** One reserved page/partial page, not a new 150-match budget on every tick. */
export async function icpMiningSliceWorkflow(options: { reservationId: string }) {
  const info = workflowInfo();
  const { reservation, icp } = await beginIcpDispatchActivity({ id: options.reservationId, runId: info.runId, workflowId: info.workflowId });
  const site = await getSiteActivity(reservation.site_id);
  if (!site.success || !site.site?.user_id) throw new Error('ICP dispatch site unavailable');
  const cron = { siteId: reservation.site_id, workflowId: info.workflowId, scheduleId: 'icp-dispatcher', activityName: 'idealClientProfileMiningWorkflow' };
  await saveCronStatusActivity({ ...cron, status: 'RUNNING', lastRun: new Date().toISOString() });
  let page = Number(icp.current_page) || 0;
  const processed = Number(icp.processed_targets) || 0;
  if (icp.current_page_offset == null) page = Math.max(page, Math.ceil(processed / 10));
  // A thrown child/checkpoint failure deliberately leaves the reservation held.
  // Never reclaim by time: a descendant may still be doing paid work.
  const result = await executeChild(idealClientProfilePageSearchWorkflow, {
    workflowId: `icp-slice-page-${reservation.id}`, args: [{
      role_query_id: icp.role_query_id, site_id: reservation.site_id, userId: site.site.user_id,
      icp_mining_id: icp.id, page, page_size: 10, start_index: Number(icp.current_page_offset) || 0,
      max_matches: reservation.reserved_matches, max_candidates: reservation.reserved_candidates,
      research_enabled: reservation.research_enabled,
      execution: { run_id: info.runId, version: icp.checkpoint_version, processed, found: Number(icp.found_matches) || 0 },
      snapshot: icp.current_page_snapshot,
    }],
  });
  if (!result.checkpoint) throw new Error('ICP dispatch page returned no durable checkpoint');
  const checkpoint = result.checkpoint;
  await checkpointIcpMiningExecutionActivity({ id: icp.id, site_id: reservation.site_id, run_id: info.runId,
    version: checkpoint.version + 1, processed: checkpoint.processed, found: checkpoint.found,
    page: checkpoint.page, offset: checkpoint.offset, snapshot: checkpoint.snapshot, total: result.total,
    status: result.pageCompleted && !result.hasMore ? 'completed' : 'pending', errors: result.errors });
  const retryAfterSeconds = classifyIcpDispatchCooldown(result.errors);
  const settled = await finishIcpDispatchActivity({ id: reservation.id, runId: info.runId, errors: result.errors, retryAfterSeconds });
  await saveCronStatusActivity({ ...cron, status: result.success ? 'COMPLETED' : 'FAILED', lastRun: new Date().toISOString(),
    nextRun: settled.next_eligible_at ?? new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
    errorMessage: result.errors.join('; ').slice(0, 2000) || null });
  return { success: result.success, processed: result.processed, foundMatches: result.foundMatches, reservationId: reservation.id };
}