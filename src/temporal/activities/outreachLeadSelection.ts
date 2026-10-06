import { fetchOutreachHistory, getOutreachConfigurationActivity } from './outreachConfigurationActivity';
import { evaluateOutreachHistory } from '../utils/outreachHistory';
import type { OutreachActivityKey } from '../utils/outreachActivity';
import { getReachableOutreachChannels } from './outreachRecipientActivity';

export async function selectOutreachLeads(params: {
  site_id: string;
  activity: OutreachActivityKey;
  page?: number;
  pageSize?: number;
  cursor?: { createdAt: string; id: string };
  waitMs: number;
}) {
  if (params.activity === 'invoices_due') throw new Error('Invoice reminders must select financial records, not prospecting leads');
  const config = await getOutreachConfigurationActivity({ site_id: params.site_id, activity_key: params.activity });
  const pageSize = Math.min(Math.max(params.pageSize || 30, 1), config.dailyMessageLimit);
  const page = Math.max(0, params.page || 0);
  const empty = { leads: [] as any[], totalCandidatesFound: 0, hasMorePages: false, pageSize, config,
    nextCursor: undefined as { createdAt: string; id: string } | undefined };
  if (!config.shouldExecute) return empty;
  const { supabaseServiceRole } = await import('../../lib/supabase/client');
  const base = () => {
    let query = supabaseServiceRole.from('leads').select('*', { count: 'exact' })
      .eq('site_id', params.site_id).is('assignee_id', null)
      .in('status', params.activity === 'leads_initial_cold_outreach' ? ['new', 'contacted'] : ['new', 'contacted', 'qualified']);
    if (!config.allSegments) query = query.in('segment_id', config.segmentIds);
    if (params.cursor) {
      const createdAt = new Date(params.cursor.createdAt).toISOString();
      if (!/^[0-9a-f-]{36}$/i.test(params.cursor.id)) throw new Error('Invalid outreach pagination cursor');
      query = query.or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${params.cursor.id})`);
    }
    return query;
  };
  const offset = params.cursor ? 0 : page * pageSize;
  const { data, count, error } = await base().order('created_at', { ascending: true }).order('id', { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error) throw new Error(`Outreach lead selection failed: ${error.message}`);
  const leads: any[] = [];
  for (const lead of data || []) {
    if (lead.status === 'cold' || lead.metadata?.quarantined_cross_tenant === true || lead.unsubscribed
      || lead.metadata?.unsubscribed === true || lead.metadata?.do_not_contact === true) continue;
    const history = evaluateOutreachHistory(await fetchOutreachHistory(params.site_id, lead.id), params.activity,
      config.maxUnansweredMessages, params.waitMs, Date.now(), Date.parse(lead.created_at) || 0);
    if (history.shouldMarkCold) {
      // Optimistic update preserves concurrent lead edits (including inbound status updates).
      let update = supabaseServiceRole.from('leads').update({ status: 'cold', updated_at: new Date().toISOString() })
        .eq('id', lead.id).eq('site_id', params.site_id).eq('status', lead.status);
      if (lead.updated_at) update = update.eq('updated_at', lead.updated_at);
      const { error: updateError } = await update;
      if (updateError) throw new Error(`Could not mark unanswered lead cold: ${updateError.message}`);
      continue;
    }
    if (!history.eligible) continue;
    const reachableChannels = await getReachableOutreachChannels(params.site_id, lead, config.availableChannels);
    if (!reachableChannels.length) continue;
    // Only unfinished active tasks veto automatic cold outreach; completed first-touch
    // tasks must not prevent subsequent attempts to a never-replied contact.
    if (params.activity === 'leads_initial_cold_outreach') {
      const { data: tasks, error: tasksError } = await supabaseServiceRole.from('tasks').select('id, status')
        .eq('site_id', params.site_id).eq('lead_id', lead.id).eq('stage', 'awareness');
      if (tasksError) throw new Error(`Outreach tasks unavailable: ${tasksError.message}`);
      if (tasks?.some(task => ['in_progress', 'in-progress'].includes(task.status))) continue;
    }
    const stage = history.unanswered >= config.maxUnansweredMessages - 1 ? 'breakup'
      : history.unanswered === 0 ? 'reminder' : 'provide_value';
    leads.push({ ...lead, outreach_channels: reachableChannels, sequence_stage: stage,
      sequence_reason: 'configured_unanswered_sequence', outreach_unanswered_count: history.unanswered });
  }
  const last = data?.[data.length - 1];
  return { leads, totalCandidatesFound: count || 0, hasMorePages: offset + pageSize < (count || 0), pageSize, config,
    nextCursor: last ? { createdAt: last.created_at, id: last.id } : undefined };
}