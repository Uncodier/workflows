import { supabaseServiceRole } from '../../lib/supabase/client';
import { mergeFinderData, finderCompanyRecord } from '../utils/finderData';
import { hasDeepResearchOutput, inspectDeepResearchOutput } from '../utils/leadResearchState';
import { upsertFinderCompanyActivity } from './finderActivities';

/** Use the company linked to the authorized lead, never an AI-supplied company ID. */
export async function saveLeadResearchCompanyActivity(params: {
  lead_id: string; site_id: string; company: any;
  /** Captured from getLeadActivity BEFORE any model results can be saved. Omitted by old histories. */
  trustedCompanyId?: string | null;
  workflow_id?: string;
}) {
  // Old pending payloads cannot prove which company was authorized before model writes.
  // Fail closed; replay of already-recorded activity results is unaffected.
  if (params.trustedCompanyId === undefined) return { success: false, error: 'Trusted company snapshot is required; restart research' };
  const { data: lead, error } = await supabaseServiceRole.from('leads').select('company_id, metadata')
    .eq('id', params.lead_id).eq('site_id', params.site_id).single();
  if (error || !lead) return { success: false, error: error?.message || 'Lead not found in research site' };
  let companyId = params.trustedCompanyId;
  if ((lead.company_id || null) !== companyId) {
    // A retry after our own atomic link is allowed; an unrelated reassignment is not.
    const link = lead.metadata?.research_company_link;
    if (companyId === null && params.workflow_id && link?.workflow_id === params.workflow_id
      && link.company_id === lead.company_id) companyId = lead.company_id;
    else return { success: false, error: 'Lead company relationship changed during research' };
  }
  if (!companyId) {
    const created = await upsertFinderCompanyActivity({ organization: finderCompanyRecord(params.company) });
    if (!created.success) return created;
    if (!created.company?.id || !params.workflow_id) return { success: false, error: 'No verified company/link context' };
    const verified = await supabaseServiceRole.from('companies').select('id').eq('id', created.company.id).single();
    if (verified.error || !verified.data) return { success: false, error: 'Created company was not found' };
    // This is the only trusted linkage path. AI deliverables cannot request it via updateLeadActivity.
    const metadata = { ...lead.metadata, research_company_link: { workflow_id: params.workflow_id, company_id: created.company.id } };
    const linked = await supabaseServiceRole.from('leads').update({ company_id: created.company.id, metadata })
      .eq('id', params.lead_id).eq('site_id', params.site_id).is('company_id', null).select('id').single();
    if (linked.error || !linked.data) return { success: false, error: linked.error?.message || 'Company link changed or was not saved' };
    return created;
  }
  const { data: existing, error: readError } = await supabaseServiceRole.from('companies').select('*')
    .eq('id', companyId).single();
  if (readError || !existing) return { success: false, error: readError?.message || 'Linked company not found' };
  const mapped = finderCompanyRecord(params.company);
  const merged = mergeFinderData(existing, mapped);
  const update = Object.fromEntries(Object.keys(mapped).map(key => [key, merged[key]]));
  const { data: company, error: writeError } = await supabaseServiceRole.from('companies').update(update)
    .eq('id', companyId).select('*').single();
  return writeError || !company ? { success: false, error: writeError?.message || 'Company was not saved' }
    : { success: true, company };
}

/** Persist full research output and its completion evidence without replacing Finder data. */
export async function saveLeadResearchStateActivity(params: {
  lead_id: string;
  site_id: string;
  workflow_id: string;
  completed: boolean;
  result: any;
  errors: string[];
  validation?: 'completed-analysis-v1';
}) {
  const { data: lead, error } = await supabaseServiceRole.from('leads').select('id, metadata')
    .eq('id', params.lead_id).eq('site_id', params.site_id).single();
  if (error || !lead) throw new Error(`Cannot save lead research: ${error?.message || 'lead not found in site'}`);
  // Activity retries also validate old payloads; replay still uses their recorded results.
  const valid = hasDeepResearchOutput(params.result);
  const completed = params.completed && valid && params.errors.length === 0;
  const now = new Date().toISOString();
  // A research result is an attempt snapshot, not a sparse provider refresh. Replacing only
  // this namespace avoids retaining an old timeout/error/arrays after a successful retry.
  const metadata = { ...lead.metadata, deep_research_result: params.result || {} };
  metadata.deep_research = {
    status: completed ? 'completed' : 'failed',
    completed_at: completed ? now : null,
    attempted_at: now,
    workflow_id: params.workflow_id,
    errors: completed ? [] : params.errors.length ? params.errors
      : [inspectDeepResearchOutput(params.result).error || 'Research persistence failed'],
    ...(params.validation ? { retryable: !completed, validation: params.validation } : {}),
  };
  const { data: saved, error: saveError } = await supabaseServiceRole.from('leads').update({ metadata })
    .eq('id', params.lead_id).eq('site_id', params.site_id).select('id').single();
  if (saveError || !saved) throw new Error(`Lead research state was not saved: ${saveError?.message || 'no updated lead'}`);
  return { success: true, completed };
}