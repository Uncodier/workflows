export const OPT_IN_ACTIVITIES: ReadonlySet<string> = new Set([
  'supervise_conversations', 'assign_leads_to_team', 'local_lead_generation',
  'daily_resume_and_stand_up',
  'leads_initial_cold_outreach', 'leads_follow_up', 'invoices_due',
]);

export function shouldScheduleWorkflow(site: any, activityKey: string): boolean {
  // Mining consumes queued requests; it does not send messages or require outreach opt-in.
  if (activityKey === 'icp_lead_generation') return true;
  const status = site?.settings?.activities?.[activityKey]?.status;
  if (status === 'active') return true;
  if (status === 'inactive') return false;
  return !OPT_IN_ACTIVITIES.has(activityKey);
}