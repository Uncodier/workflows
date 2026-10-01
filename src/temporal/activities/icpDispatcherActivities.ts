import { createHash } from 'node:crypto';
import { supabaseServiceRole as db } from '../../lib/supabase/client';
import { getTemporalClient } from '../client';
import { TASK_QUEUES } from '../config/taskQueues';
import { resolveIcpMiningConfiguration } from '../utils/icpMiningConfiguration';
import { selectIcpDispatchCandidates, type IcpDispatchCandidate } from '../utils/icpDispatchSelection';
import { toIcpMiningClaimResult } from '../utils/icpMiningPayload';

export interface IcpDispatchReservation {
  id: string; site_id: string; icp_mining_id: string; workflow_id: string; run_id: string | null;
  state: 'reserved' | 'running' | 'settled' | 'blocked'; budget_day: string;
  reserved_candidates: number; reserved_matches: number; research_enabled: boolean;
  processed: number; found: number;
}

function reservationFrom(value: any): IcpDispatchReservation {
  if (!value || typeof value.id !== 'string' || typeof value.workflow_id !== 'string'
    || typeof value.site_id !== 'string' || typeof value.icp_mining_id !== 'string'
    || !Number.isInteger(value.reserved_candidates) || value.reserved_candidates < 1 || value.reserved_candidates > 10
    || !Number.isInteger(value.reserved_matches) || value.reserved_matches < 1 || value.reserved_matches > value.reserved_candidates
    || typeof value.research_enabled !== 'boolean') throw new Error('Invalid ICP dispatch reservation');
  // Do not forward a growing diagnostic column or future database fields to Temporal.
  return { id: value.id, site_id: value.site_id, icp_mining_id: value.icp_mining_id, workflow_id: value.workflow_id,
    run_id: value.run_id, state: value.state, budget_day: value.budget_day,
    reserved_candidates: value.reserved_candidates, reserved_matches: value.reserved_matches,
    research_enabled: value.research_enabled, processed: value.processed, found: value.found };
}

async function dispatchConfig() {
  const { data, error } = await db.from('icp_dispatch_config').select('*').eq('id', true).single();
  if (error || !data) throw new Error(`ICP dispatcher configuration unavailable: ${error?.message || 'missing singleton'}`);
  if (typeof data.enabled !== 'boolean' || !Number.isInteger(data.max_concurrency)
    || data.max_concurrency < 1 || data.max_concurrency > 10) throw new Error('Invalid ICP dispatcher configuration');
  return data;
}

export async function isIcpDispatcherEnabledActivity(): Promise<boolean> {
  return (await dispatchConfig()).enabled;
}

/** Page all orchestration rows; never transfer provider snapshots/error history. */
async function rows(query: () => any): Promise<any[]> {
  const result: any[] = [];
  for (let offset = 0; offset < 100_000; offset += 500) {
    const { data, error } = await query().range(offset, offset + 499);
    if (error || !Array.isArray(data)) throw new Error(`ICP dispatcher read failed: ${error?.message || 'invalid rows'}`);
    result.push(...data);
    if (data.length < 500) return result;
  }
  throw new Error('ICP dispatcher scan exceeds safety limit; no partial dispatch permitted');
}

export async function dispatchIcpMiningActivity(options: { dispatchId: string }): Promise<{
  enabled: boolean; started: number; active: number; skipped: number; errors: string[];
}> {
  const config = await dispatchConfig();
  const summary = { enabled: config.enabled, started: 0, active: 0, skipped: 0, errors: [] as string[] };
  if (!config.enabled) return summary;
  if (!options.dispatchId || options.dispatchId.length > 500) throw new Error('ICP dispatch identity required');
  const day = new Date().toISOString().slice(0, 10);
  const [sites, settings, lists, siteState, listState, ledger] = await Promise.all([
    rows(() => db.from('sites').select('id,user_id').is('archived_at', null).order('id')),
    rows(() => db.from('settings').select('site_id,activities').order('site_id')),
    rows(() => db.from('icp_mining').select('id,site_id,total_targets,processed_targets,current_page_offset,execution_active,snapshot_page:current_page_snapshot->page')
      .in('status', ['pending', 'running']).order('id')),
    rows(() => db.from('icp_dispatch_site_state').select('*').order('site_id')),
    rows(() => db.from('icp_dispatch_list_state').select('*').order('icp_mining_id')),
    rows(() => db.from('icp_dispatch_runs').select('id,site_id,icp_mining_id,workflow_id,run_id,state,budget_day,reserved_candidates,reserved_matches,found,research_enabled,processed')
      .or(`budget_day.eq.${day},state.in.(reserved,running,blocked)`).order('id')),
  ]);
  const active = ledger.filter(row => row.state !== 'settled');
  const legacyActive = lists.filter(list => list.execution_active && !active.some(row => row.icp_mining_id === list.id));
  summary.active = active.length + legacyActive.length;
  const siteById = new Map(sites.map(site => [site.id, site]));
  const settingsBySite = new Map(settings.map(setting => [setting.site_id, setting]));
  const states = new Map(siteState.map(state => [state.site_id, state]));
  const listStates = new Map(listState.map(state => [state.icp_mining_id, state]));
  const activeSites = new Set([...active.map(row => row.site_id), ...lists.filter(row => row.execution_active).map(row => row.site_id)]);
  const budgets = new Map<string, { found: number; reserved: number; candidates: number }>();
  for (const row of ledger) {
    if (row.budget_day !== day) continue;
    const budget = budgets.get(row.site_id) || { found: 0, reserved: 0, candidates: 0 };
    budget.candidates += row.reserved_candidates;
    if (row.state === 'settled') budget.found += row.found;
    else budget.reserved += row.reserved_matches;
    budgets.set(row.site_id, budget);
  }
  const candidates: IcpDispatchCandidate[] = [];
  const invalidSites = new Set<string>();
  for (const list of lists) {
    const site = siteById.get(list.site_id);
    if (!site || invalidSites.has(site.id)) continue;
    let controls;
    try { controls = resolveIcpMiningConfiguration(settingsBySite.get(site.id)); }
    catch (error) {
      invalidSites.add(site.id);
      summary.errors.push(`Site ${site.id}: ${error instanceof Error ? error.message : 'invalid settings'}`);
      continue;
    }
    if (!controls.allLists && !controls.listIds.includes(list.id)) continue;
    const daily = budgets.get(site.id) || { found: 0, reserved: 0, candidates: 0 };
    const state = states.get(site.id);
    const ls = listStates.get(list.id);
    candidates.push({ siteId: site.id, userId: site.user_id, icpId: list.id,
      remainingTargets: Number(list.total_targets) > 0 ? Math.max(0, Number(list.total_targets) - Number(list.processed_targets || 0)) : null,
      hasCheckpoint: list.snapshot_page !== null && list.snapshot_page !== undefined,
      lastSiteDispatchAt: state?.last_dispatched_at ?? null, lastListDispatchAt: ls?.last_dispatched_at ?? null,
      nextEligibleAt: state?.next_eligible_at, listNextEligibleAt: ls?.next_eligible_at,
      dailyFound: daily.found, dailyReservedMatches: daily.reserved,
      dailyCandidateReservations: daily.candidates,
      targetLeads: controls.targetLeads, active: activeSites.has(site.id) });
  }
  const client = await getTemporalClient();
  const start = async (reservation: IcpDispatchReservation) => {
    try {
      await client.workflow.start('icpMiningSliceWorkflow', {
        workflowId: reservation.workflow_id, taskQueue: TASK_QUEUES.NORMAL,
        workflowIdReusePolicy: 'REJECT_DUPLICATE', args: [{ reservationId: reservation.id }],
      });
      summary.started++;
    } catch (error) {
      if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') { summary.skipped++; return; }
      // Keep the reservation: a lost start ACK is NOT evidence that no workflow exists.
      summary.errors.push(`Reservation ${reservation.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    // Repair an interrupted reserve->start handoff with the SAME workflow ID.
    for (const reservation of active.filter(row => row.state === 'reserved')) await start(reservation);
    const selected = selectIcpDispatchCandidates(candidates, { now: new Date(), limit: Math.max(0, config.max_concurrency - summary.active),
      dailyCandidateLimit: config.daily_candidate_limit });
    for (const candidate of selected) {
      const key = createHash('sha256').update(`${options.dispatchId}:${candidate.siteId}`).digest('hex');
      const workflowId = `icp-slice-${candidate.siteId}-${key.slice(0, 24)}`;
      const { data, error } = await db.rpc('reserve_icp_dispatch', { p_site_id: candidate.siteId, p_icp_id: candidate.icpId,
        p_dispatch_key: key, p_workflow_id: workflowId });
      if (error) { summary.errors.push(`Site ${candidate.siteId}: ${error.message}`); continue; }
      if (!data?.acquired || !data.reservation) { summary.skipped++; continue; }
      await start(reservationFrom(data.reservation));
    }
  } finally { await client.connection.close(); }
  return summary;
}

export async function beginIcpDispatchActivity(params: { id: string; runId: string; workflowId: string }) {
  const { data, error } = await db.rpc('begin_icp_dispatch', { p_id: params.id, p_run_id: params.runId, p_workflow_id: params.workflowId });
  if (error) throw new Error(`ICP dispatch begin failed: ${error.message}`);
  if (!data?.acquired || !data.reservation || !data.icp) throw new Error(`ICP dispatch not acquired: ${data?.reason || 'invalid response'}`);
  const claim = toIcpMiningClaimResult({ acquired: true, icp: data.icp });
  if (!claim.acquired) throw new Error('ICP dispatch claim missing');
  return { reservation: reservationFrom(data.reservation), icp: claim.icp };
}

export async function finishIcpDispatchActivity(params: { id: string; runId: string; errors: string[]; retryAfterSeconds: number }) {
  const { data, error } = await db.rpc('finish_icp_dispatch', { p_id: params.id, p_run_id: params.runId,
    p_errors: params.errors.map(message => message.slice(0, 1000)).slice(0, 20), p_retry_after_seconds: params.retryAfterSeconds });
  if (error || !data?.success) throw new Error(`ICP dispatch settlement failed: ${error?.message || 'not acknowledged'}`);
  return data;
}