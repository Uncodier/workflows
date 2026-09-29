import type { Activities, IcpPageSnapshot } from '../../activities';
import type { processSingleIcp } from './processSingle';

export type OwnedIcpArgs = Parameters<typeof processSingleIcp>[0] & {
  execution: { runId: string; workflowId: string };
  claim: Activities['claimIcpMiningExecutionActivity'];
  checkpoint: Activities['checkpointIcpMiningExecutionActivity'];
};

/** Only one verified Temporal run can spend against this request at a time. */
export async function processOwnedIcp(args: OwnedIcpArgs) {
  if (!Number.isInteger(args.maxPages) || args.maxPages < 1 || args.maxPages > 300) throw new Error('Invalid ICP page limit');
  const { icp, options, execution } = args;
  const claimed = await args.claim({ id: icp.id, site_id: options.site_id, run_id: execution.runId, workflow_id: execution.workflowId });
  if (!claimed.acquired) return { processed: 0, foundMatches: 0, errors: [], skipped: claimed.reason || 'busy' };
  const row = claimed.icp;
  let processed = Number(row.processed_targets) || 0;
  let found = Number(row.found_matches) || 0;
  const baselineProcessed = processed;
  const baselineFound = found;
  let page = Number(row.current_page) || 0;
  let offset = Number(row.current_page_offset) || 0;
  if (row.current_page_offset == null) page = Math.max(page, Math.ceil(processed / 10));
  let snapshot: IcpPageSnapshot | null = row.current_page_snapshot || null;
  let version = row.checkpoint_version;
  let total: number | undefined = Number(row.total_targets) > 0 ? Number(row.total_targets) : undefined;
  let exhausted = total !== undefined && processed >= total;
  const errors: string[] = [];

  for (let pages = 0; pages < args.maxPages && !exhausted && found - baselineFound < args.targetLeadsWithEmail; pages++) {
    // A thrown child/checkpoint failure leaves ownership intact. A later caller
    // must verify this run has ended before taking over its durable checkpoint.
    const result = await args.deps.executePageSearch({
      role_query_id: row.role_query_id, site_id: options.site_id, userId: args.actualUserId,
      icp_mining_id: row.id, page, page_size: 10, start_index: offset,
      max_matches: args.targetLeadsWithEmail - (found - baselineFound), research_enabled: options.researchEnabled === true,
      execution: { run_id: execution.runId, version, processed, found }, snapshot,
    });
    if (!result.checkpoint) throw new Error('ICP child did not return its durable checkpoint');
    ({ processed, found, version, page, offset, snapshot } = result.checkpoint);
    if (result.total !== undefined) total = result.total;
    errors.push(...result.errors);
    exhausted = result.pageCompleted === true && result.hasMore === false;
    if (result.retryableFailure) break;
    if (!result.processed && !result.pageCompleted) throw new Error('ICP page made no progress');
  }
  await args.checkpoint({ id: row.id, site_id: options.site_id, run_id: execution.runId, version: version + 1,
    processed, found, page, offset, total, snapshot, status: exhausted ? 'completed' : 'pending', errors });
  return { processed: processed - baselineProcessed, foundMatches: found - baselineFound, totalTargets: total, errors };
}