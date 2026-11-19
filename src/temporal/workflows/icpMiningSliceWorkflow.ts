import { proxyActivities, executeChild, workflowInfo, patched, CancellationScope } from '@temporalio/workflow';
import { ApplicationFailure } from '@temporalio/common';
import type { Activities } from '../activities';
import type { SelectedIcpState } from '../activities/icpSelectedPeopleActivities';
import { idealClientProfilePageSearchWorkflow } from './idealClientProfilePageSearchWorkflow';
import { classifyIcpDispatchCooldown, isIcpCreditFailure } from '../utils/icpDispatchSelection';
import { accountedSearchTargets } from '../utils/icpSearchExhaustion';
import { processSelectedPeople, SELECTED_ACK_RECOVERY_PATCH, ICP_RECEIPT_RETRY } from './icpMining/processSelectedPeople';
import { enrichLeadWorkflow } from './enrichLeadWorkflow';
import { leadResearchWorkflow } from './leadResearchWorkflow';

const { beginIcpDispatchActivity, finishIcpDispatchActivity, checkpointIcpMiningExecutionActivity, getSiteActivity, saveCronStatusActivity,
  checkIcpMiningCreditsActivity, readSelectedIcpPeopleActivity, getSelectedIcpPersonActivity,
  acknowledgeSelectedIcpPersonActivity, finalizeSelectedIcpSliceActivity, getLeadActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', retry: { maximumAttempts: 3 },
});
const { reconcileSelectedIcpPersonAckActivity, settleIcpDispatchPreflightActivity } = proxyActivities<Activities>(ICP_RECEIPT_RETRY);
const { warnIcpMiningCreditsActivity, getSelectedIcpPersonActivity: getSelectedPersonOnce } = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', retry: { maximumAttempts: 1 },
});

/** One reserved page/partial page, not a new 150-match budget on every tick. */
export async function icpMiningSliceWorkflow(options: { reservationId: string }) {
  const info = workflowInfo();
  const { reservation, icp } = await beginIcpDispatchActivity({ id: options.reservationId, runId: info.runId, workflowId: info.workflowId });
  const settlePreflight = patched('icp-dispatch-preflight-settlement-v1');
  const cron = { siteId: reservation.site_id, workflowId: info.workflowId, scheduleId: 'icp-dispatcher', activityName: 'idealClientProfileMiningWorkflow' };
  const identity = { id: icp.id, site_id: reservation.site_id, run_id: info.runId };
  const stopBeforePaidWork = async (message: string) => {
    const errors = [message];
    const retryAfterSeconds = classifyIcpDispatchCooldown(errors);
    const params = { id: options.reservationId, runId: info.runId, errors, retryAfterSeconds };
    const settled = settlePreflight
      ? await settleIcpDispatchPreflightActivity({ ...params, workflowId: info.workflowId })
      : await finishIcpDispatchActivity({ ...params, id: reservation.id }); // Pre-patch no-credit history.
    await saveCronStatusActivity({ ...cron, status: 'FAILED', lastRun: new Date().toISOString(),
      nextRun: settled.next_eligible_at ?? new Date(Date.now() + retryAfterSeconds * 1000).toISOString(), errorMessage: message });
    return { success: false, processed: 0, foundMatches: 0, reservationId: reservation.id };
  };
  let userId: string;
  let creditGuard: boolean;
  let selectedGuard = false;
  let selected: SelectedIcpState | null = null;
  let canSpend: boolean;
  // Only these read/status operations are known never to start paid work. Never
  // extend this catch over a source lookup, child start, ACK, or final checkpoint.
  try {
    const site = await getSiteActivity(reservation.site_id);
    if (!site.success || !site.site?.user_id) {
      if (settlePreflight) throw ApplicationFailure.nonRetryable('ICP dispatch site unavailable', 'ICP_SITE_UNAVAILABLE');
      throw new Error('ICP dispatch site unavailable');
    }
    userId = site.site.user_id;
    await saveCronStatusActivity({ ...cron, status: 'RUNNING', lastRun: new Date().toISOString() });
    creditGuard = patched('icp-slice-credit-guard-v1');
    canSpend = !creditGuard || await checkIcpMiningCreditsActivity(reservation.site_id);
    if (canSpend) {
      selectedGuard = patched('icp-selected-members-v1');
      selected = selectedGuard ? await readSelectedIcpPeopleActivity(identity) : null;
    }
  } catch (error) {
    if (!settlePreflight) throw error;
    // Temporal's outer ActivityFailure often just says "Activity task failed".
    // Preserve its read-only cause for diagnostics and cooldown classification.
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const reason = cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
    const message = `ICP dispatch preflight: ${reason}`.slice(0, 1000);
    await CancellationScope.nonCancellable(() => stopBeforePaidWork(message));
    throw error;
  }
  if (!canSpend) {
    const stop = () => stopBeforePaidWork('ICP mining skipped: no credits available');
    return settlePreflight ? CancellationScope.nonCancellable(stop) : stop();
  }
  let page = Number(icp.current_page) || 0;
  const processed = Number(icp.processed_targets) || 0;
  // A thrown child/checkpoint failure deliberately leaves the reservation held.
  // Never reclaim by time: a descendant may still be doing paid work.
  let result;
  const respectTotal = selected != null && !selected.selectedOnly && patched('icp-slice-respect-search-total-v1');
  const selectedProcessed = icp.selected_processed_targets ?? 0;
  let searchExhausted = selected?.searchExhausted === true ||
    (respectTotal && accountedSearchTargets(icp.total_targets, processed, selectedProcessed));
  try {
    if (selected && (selected.members.length > 0 || selected.selectedOnly || searchExhausted)) {
      const members = await processSelectedPeople({ ...identity, version: icp.checkpoint_version,
        processed, found: Number(icp.found_matches) || 0, state: selected,
        max_candidates: reservation.reserved_candidates, max_matches: reservation.reserved_matches,
        research_enabled: reservation.research_enabled }, {
        getSelectedIcpPersonActivity, acknowledgeSelectedIcpPersonActivity, getLeadActivity,
        ...(patched(SELECTED_ACK_RECOVERY_PATCH) ? { reconcileSelectedIcpPersonAckActivity,
          getSelectedIcpPersonActivity: getSelectedPersonOnce } : {}),
        enrich: (params, ordinal) => executeChild(enrichLeadWorkflow, {
          workflowId: `icp-selected-enrich-${icp.id}-${info.runId}-${ordinal}`, args: [params],
        }),
        research: (params, ordinal) => executeChild(leadResearchWorkflow, {
          workflowId: `icp-selected-research-${icp.id}-${info.runId}-${ordinal}`, args: [params],
        }),
      });
      // The second license/cache check can fail after the queue read. Only an
      // explicit not-started signal on the very first member is still preflight.
      if (settlePreflight && members.noPaidWork) {
        return CancellationScope.nonCancellable(() => stopBeforePaidWork(members.errors[0]));
      }
      result = { ...members, foundMatches: members.found - (Number(icp.found_matches) || 0),
        processed: members.processed - processed, pageCompleted: false, hasMore: true, total: undefined,
        checkpoint: { version: members.version, processed: members.processed, found: members.found,
          page, offset: Number(icp.current_page_offset) || 0, snapshot: icp.current_page_snapshot } };
    } else {
      // Only a provider search needs a legacy page estimate. Member ACKs must
      // preserve the stored cursor even when historical counters exceed the total.
      if (icp.current_page_offset == null) page = Math.max(page, Math.ceil((processed - (selectedGuard ? icp.selected_processed_targets || 0 : 0)) / 10));
      result = await executeChild(idealClientProfilePageSearchWorkflow, {
        workflowId: `icp-slice-page-${reservation.id}`, args: [{
          role_query_id: icp.role_query_id, site_id: reservation.site_id, userId,
          icp_mining_id: icp.id, page, page_size: 10, start_index: Number(icp.current_page_offset) || 0,
          max_matches: reservation.reserved_matches, max_candidates: reservation.reserved_candidates,
          research_enabled: reservation.research_enabled,
          ...(creditGuard ? { stop_on_credit_failure: true } : {}),
          execution: { run_id: info.runId, version: icp.checkpoint_version, processed, found: Number(icp.found_matches) || 0 },
          snapshot: icp.current_page_snapshot,
        }],
      });
      searchExhausted = (result.pageCompleted === true && !result.hasMore) || (respectTotal && !result.retryableFailure &&
        !!result.checkpoint && accountedSearchTargets(result.total ?? icp.total_targets, result.checkpoint.processed, selectedProcessed));
    }
  } catch (error) {
    if (creditGuard && isIcpCreditFailure(error instanceof Error ? error.message : String(error))) {
      try { await CancellationScope.nonCancellable(() => warnIcpMiningCreditsActivity({ siteId: reservation.site_id, workflowId: info.workflowId })); }
      catch (warningError) { console.error('Failed to send ICP credit warning:', warningError); }
    }
    throw error;
  }
  if (!result.checkpoint) throw new Error('ICP dispatch page returned no durable checkpoint');
  const checkpoint = result.checkpoint;
  await checkpointIcpMiningExecutionActivity({ id: icp.id, site_id: reservation.site_id, run_id: info.runId,
    version: checkpoint.version + 1, processed: checkpoint.processed, found: checkpoint.found,
    page: checkpoint.page, offset: checkpoint.offset, snapshot: checkpoint.snapshot, total: result.total,
    status: selectedGuard ? 'pending' : result.pageCompleted && !result.hasMore ? 'completed' : 'pending', errors: result.errors });
  if (selectedGuard) await finalizeSelectedIcpSliceActivity({ ...identity, searchExhausted });
  const retryAfterSeconds = classifyIcpDispatchCooldown(result.errors);
  const settled = await finishIcpDispatchActivity({ id: reservation.id, runId: info.runId, errors: result.errors, retryAfterSeconds });
  if (creditGuard && result.errors.some(isIcpCreditFailure)) {
    try { await CancellationScope.nonCancellable(() => warnIcpMiningCreditsActivity({ siteId: reservation.site_id, workflowId: info.workflowId })); }
    catch (error) { console.error('Failed to send ICP credit warning:', error); }
  }
  await saveCronStatusActivity({ ...cron, status: result.success ? 'COMPLETED' : 'FAILED', lastRun: new Date().toISOString(),
    nextRun: settled.next_eligible_at ?? new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
    errorMessage: result.errors.join('; ').slice(0, 2000) || null });
  return { success: result.success, processed: result.processed, foundMatches: result.foundMatches, reservationId: reservation.id };
}