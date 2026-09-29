import { isProtectedResearchField } from './researchData';

function populated(value: any): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(populated);
  return !!value && typeof value === 'object' && Object.values(value).some(populated);
}

/** Contact/provider metadata and arbitrary notes are not proof of deep research. */
export function hasCompletedLeadResearch(lead: any): boolean {
  const metadata = lead?.metadata || {};
  if (metadata.deep_research) {
    return metadata.deep_research.status === 'completed'
      && typeof metadata.deep_research.completed_at === 'string'
      && Number.isFinite(Date.parse(metadata.deep_research.completed_at))
      && (metadata.deep_research.validation !== 'completed-analysis-v1' || hasDeepResearchOutput(metadata.deep_research_result));
  }
  // Recognize genuine evidence written by historical leadResearchWorkflow runs.
  return populated(metadata.research_analysis) && Boolean(metadata.last_research_date || metadata.research_timestamp);
}

export function needsLeadDeepResearch(lead: any): boolean {
  return !!lead && !hasCompletedLeadResearch(lead);
}

/** Frozen validator for histories that recorded lead-research-persist-completion-v1. */
export function hasLegacyDeepResearchOutput(result: any): boolean {
  if (result?.success !== true || result.error || result.errors?.length
    || result.data?.success === false || result.data?.error || result.data?.errors?.length
    || result.data?.fallback === true || result.data?.fallback_used === true
    || result.data?.workflow_fallback_mode === true || result.data?.api_status === 'fallback') return false;
  return [result.data?.deliverables, result.data?.analysis,
    result.data?.insights, result.data?.recommendations,
    result.analysis, result.insights, result.recommendations].some(populated);
}

function record(value: any): boolean { return !!value && typeof value === 'object' && !Array.isArray(value); }

// dataAnalysisActivity wraps the HTTP body, which itself contains {success, data}.
// Only traverse known response envelopes, never arbitrary provider/deliverable objects.
function analysisEnvelopes(value: any, depth = 0): any[] {
  if (!record(value) || depth > 6) return [];
  return [value, ...['data', 'analysis', 'research_analysis'].flatMap(key => analysisEnvelopes(value[key], depth + 1))];
}

function discovered(value: any, template?: any, key = ''): boolean {
  if (isProtectedResearchField(key) || ['name', 'company_name', 'language', 'languages', 'timestamp',
    'completed_at', 'attempted_at', 'research_timestamp', 'research_source'].includes(key)) return false;
  if (template !== undefined && JSON.stringify(value) === JSON.stringify(template)) return false;
  if (typeof value === 'string') return value.trim().length > 0
    && !['string', 'array', 'object', 'number', 'boolean', 'null', 'unknown', 'n/a'].includes(value.trim().toLowerCase());
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value; // template defaults (false) are not discovery
  if (Array.isArray(value)) return value.some((entry, index) => discovered(entry, template?.[index]));
  return record(value) && Object.entries(value).some(([field, entry]) => discovered(entry, template?.[field], field));
}

const analysisFields = ['summary', 'executive_summary', 'conclusions', 'key_findings', 'data_insights',
  'trend_analysis', 'insights', 'recommendations', 'findings', 'next_steps', 'methodology', 'limitations', 'data_inconsistencies'];

/** HTTP 200/success is transport success, not proof that the analysis command completed. */
export function inspectDeepResearchOutput(result: any, template?: any) {
  const envelopes = analysisEnvelopes(result);
  const statuses = envelopes.map(value => value.status ?? value.analysis_status).filter(value => value != null);
  const status = statuses.find(value => value !== 'completed') ?? statuses[0];
  const failed = result?.success !== true || envelopes.some(value => value.success === false || value.error
    || value.errors?.length || value.fallback === true || value.fallback_used === true
    || value.workflow_fallback_mode === true || value.api_status === 'fallback');
  const deliverables = envelopes.find(value => record(value.deliverables))?.deliverables;
  const analysis: Record<string, any> = {};
  for (const value of envelopes) {
    for (const field of analysisFields) if (populated(value[field])) analysis[field] = value[field];
    if (typeof value.analysis === 'string' && value.analysis.trim()) analysis.summary = value.analysis;
  }
  const substantive = discovered(deliverables, template) || Object.values(analysis).some(value => discovered(value));
  const completed = !failed && status === 'completed' && substantive;
  return { completed, status, deliverables, analysis,
    error: completed ? undefined : status !== 'completed' ? `Research analysis status: ${status || 'missing'}`
      : failed ? 'Research analysis reported failure or fallback' : 'Research analysis returned only template/empty output' };
}

export function hasDeepResearchOutput(result: any): boolean {
  return inspectDeepResearchOutput(result).completed;
}