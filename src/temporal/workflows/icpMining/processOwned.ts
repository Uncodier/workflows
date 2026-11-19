import type { Activities, IcpPageSnapshot } from '../../activities';
import type { processSingleIcp } from './processSingle';
import { isIcpCreditFailure } from '../../utils/icpDispatchSelection';
import { processSelectedPeople } from './processSelectedPeople';
import { accountedSearchTargets } from '../../utils/icpSearchExhaustion';

export type OwnedIcpArgs = Parameters<typeof processSingleIcp>[0] & {
  respectSearchTotal?: boolean;
  execution: { runId: string; workflowId: string };
  claim: Activities['claimIcpMiningExecutionActivity'];
  checkpoint: Activities['checkpointIcpMiningExecutionActivity'];
  selected?: {
    read: Activities['readSelectedIcpPeopleActivity'];
    finalize: Activities['finalizeSelectedIcpSliceActivity'];
    deps: Parameters<typeof processSelectedPeople>[1];
  };
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
  const selectedProcessed = args.selected ? row.selected_processed_targets || 0 : 0;
  let snapshot: IcpPageSnapshot | null = row.current_page_snapshot || null;
  let version = row.checkpoint_version;
  let total: number | undefined = Number(row.total_targets) > 0 ? Number(row.total_targets) : undefined;
  let exhausted = accountedSearchTargets(total, processed, selectedProcessed);
  const errors: string[] = [];
  const identity = { id: row.id, site_id: options.site_id, run_id: execution.runId };
  let selected: Awaited<ReturnType<Activities['readSelectedIcpPeopleActivity']>> | null = null;
  if (args.selected) {
    try { selected = await args.selected.read(identity); }
    catch (error) {
      // A fresh manual claim, before any child/paid operation. Never release
      // a resumed execution with already-recorded work based on this error.
      if (args.respectSearchTotal && version === 0) {
        await args.checkpoint({ ...identity, version: 1, processed, found, page, offset, snapshot,
          status: 'pending', errors: ['Selected membership preflight failed'] });
      }
      throw error;
    }
  }
  if (selected) {
    exhausted = selected.selectedOnly || selected.searchExhausted || (args.respectSearchTotal === true && exhausted);
    // One bounded membership phase per manual/daily run. If more remain, leave
    // pending instead of searching; the next execution continues the same queue.
    if (selected.members.length) {
      const result = await processSelectedPeople({ ...identity, version, processed, found,
        max_candidates: 10, max_matches: args.targetLeadsWithEmail, research_enabled: options.researchEnabled === true,
        state: selected }, args.selected!.deps);
      ({ version, processed, found } = result); errors.push(...result.errors);
      await args.checkpoint({ ...identity, version: version + 1, processed, found, page, offset, snapshot,
        status: 'pending', errors });
      await args.selected!.finalize({ ...identity, searchExhausted: selected.searchExhausted ||
        (args.respectSearchTotal === true && !selected.selectedOnly && exhausted) });
      return { processed: processed - baselineProcessed, foundMatches: found - baselineFound, errors };
    }
  }

  if (!selected?.selectedOnly && !selected?.searchExhausted && row.current_page_offset == null) {
    page = Math.max(page, Math.ceil((processed - selectedProcessed) / 10));
  }
  for (let pages = 0; pages < args.maxPages && !exhausted && found - baselineFound < args.targetLeadsWithEmail; pages++) {
    // A thrown child/checkpoint failure leaves ownership intact. A later caller
    // must verify this run has ended before taking over its durable checkpoint.
    const result = await args.deps.executePageSearch({
      role_query_id: row.role_query_id, site_id: options.site_id, userId: args.actualUserId,
      icp_mining_id: row.id, page, page_size: 10, start_index: offset,
      max_matches: args.targetLeadsWithEmail - (found - baselineFound), research_enabled: options.researchEnabled === true,
      ...(options.icpCreditGuard ? { stop_on_credit_failure: true } : {}),
      execution: { run_id: execution.runId, version, processed, found }, snapshot,
    });
    if (!result.checkpoint) throw new Error('ICP child did not return its durable checkpoint');
    ({ processed, found, version, page, offset, snapshot } = result.checkpoint);
    if (result.total !== undefined) total = result.total;
    errors.push(...result.errors);
    exhausted = (result.pageCompleted === true && result.hasMore === false) ||
      (args.respectSearchTotal === true && !result.retryableFailure && accountedSearchTargets(total, processed, selectedProcessed));
    if (result.retryableFailure || (options.icpCreditGuard && result.errors.some(isIcpCreditFailure))) break;
    if (!result.processed && !result.pageCompleted) throw new Error('ICP page made no progress');
  }
  await args.checkpoint({ id: row.id, site_id: options.site_id, run_id: execution.runId, version: version + 1,
    processed, found, page, offset, ...(selected?.selectedOnly ? {} : { total }), snapshot,
    status: selected ? 'pending' : exhausted ? 'completed' : 'pending', errors });
  if (args.selected) await args.selected.finalize({ ...identity, searchExhausted: exhausted && !selected?.selectedOnly });
  return { processed: processed - baselineProcessed, foundMatches: found - baselineFound, totalTargets: total, errors };
}