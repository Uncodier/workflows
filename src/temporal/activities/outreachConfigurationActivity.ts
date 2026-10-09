import { getSupabaseService } from '../services/supabaseService';
import { resolveOutreachConfiguration, type OutreachConfiguration } from '../utils/outreachConfiguration';
import { evaluateOutreachHistory, type OutreachMessage } from '../utils/outreachHistory';
import type { OutreachActivityKey } from '../utils/outreachActivity';
import { getReachableOutreachChannels } from './outreachRecipientActivity';

export async function fetchOutreachHistory(siteId: string, leadId: string): Promise<OutreachMessage[]> {
  const { supabaseServiceRole } = await import('../../lib/supabase/client');
  const messages: OutreachMessage[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseServiceRole.from('messages')
      .select('id, role, created_at, custom_data, conversations!inner(site_id, lead_id)')
      .eq('conversations.lead_id', leadId).eq('conversations.site_id', siteId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`Outreach history unavailable: ${error.message}`);
    messages.push(...(data || []));
    if (!data || data.length < 500) return messages;
  }
}

export async function getOutreachConfigurationActivity(params: {
  site_id: string;
  activity_key: OutreachActivityKey;
  lead_id?: string;
  check_day?: boolean;
}): Promise<OutreachConfiguration> {
  const settings = await getSupabaseService().fetchCompleteSettings([params.site_id]);
  const result = resolveOutreachConfiguration(settings[0], params.activity_key, new Date(), params.check_day !== false);
  if (!result.shouldExecute) return result;
  // Invoice recipients are validated against their financial record by the API,
  // never the unassigned/new lead audience or prospecting unanswered sequence.
  if (params.activity_key === 'invoices_due') return result;
  const { supabaseServiceRole } = await import('../../lib/supabase/client');
  if (!result.allSegments) {
    const { data, error } = await supabaseServiceRole.from('segments').select('id')
      .eq('site_id', params.site_id).in('id', result.segmentIds);
    if (error) throw new Error(`Outreach segments unavailable: ${error.message}`);
    if (data?.length !== result.segmentIds.length) {
      return { ...result, shouldExecute: false, reason: 'A selected segment is missing or belongs to another site' };
    }
  }
  if (params.lead_id) {
    const { data: lead, error } = await supabaseServiceRole.from('leads').select('*')
      .eq('id', params.lead_id).eq('site_id', params.site_id).maybeSingle();
    if (error) throw new Error(`Outreach lead unavailable: ${error.message}`);
    if (!lead || lead.assignee_id || !['new', 'contacted', 'qualified'].includes(lead.status)
      || lead.metadata?.quarantined_cross_tenant === true || lead.metadata?.unsubscribed === true || lead.metadata?.do_not_contact === true
      || (!result.allSegments && !result.segmentIds.includes(lead.segment_id))) {
      return { ...result, shouldExecute: false, reason: 'Lead is outside the selected outreach audience' };
    }
    const history = evaluateOutreachHistory(await fetchOutreachHistory(params.site_id, lead.id), params.activity_key,
      result.maxUnansweredMessages, 0, Date.now(), 0, result.cooldownMode, result.cooldownPeriodDays);
    if (!history.eligible) return { ...result, shouldExecute: false, reason: 'Lead audience, unanswered limit, or pending message prevents outreach' };
    result.leadChannels = await getReachableOutreachChannels(params.site_id, lead, result.availableChannels);
    if (!result.leadChannels.length) return { ...result, shouldExecute: false, reason: 'No selected channel has a reachable recipient for this lead' };
  }
  return result;
}