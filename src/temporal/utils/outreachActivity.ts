export type OutreachActivityKey = 'leads_initial_cold_outreach' | 'leads_follow_up';

/** Recognize historical automatic messages as well as explicitly tagged new work. */
export function resolveOutreachActivity(data: Record<string, any> | null | undefined): OutreachActivityKey | undefined {
  if (!data) return undefined;
  if (data.outreach_activity === 'leads_initial_cold_outreach' || data.outreach_activity === 'leads_follow_up') {
    return data.outreach_activity;
  }
  if (data.outreach_activity !== undefined) return undefined;
  if (data.triggeredBy === 'dailyProspectionWorkflow') return 'leads_initial_cold_outreach';
  if (data.triggeredBy === 'leadQualificationWorkflow' || data.sequence_stage
    || data.follow_up_type === 'lead_nurture' || data.follow_up_type === 'lead_follow_up'
    || data.source === 'lead_follow_up') return 'leads_follow_up';
  return undefined;
}