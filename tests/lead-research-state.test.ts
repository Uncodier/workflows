import { hasCompletedLeadResearch, needsLeadDeepResearch, hasDeepResearchOutput } from '../src/temporal/utils/leadResearchState';
import { shouldExecuteLeadResearch, shouldExecuteCompanyResearch } from '../src/temporal/workflows/leadFollowUp/utils';

describe('shared lead research eligibility', () => {
  const lead = { origin: 'lead_enrichment_workflow', website: 'https://example.test',
    notes: 'Imported from Finder', metadata: { finder: { person: { skills: ['TypeScript'] } }, emailVerified: true } };
  it('does not confuse provider metadata, verification or notes with deep research', () => {
    expect(needsLeadDeepResearch(lead)).toBe(true);
    expect(shouldExecuteLeadResearch(lead, true)).toBe(true);
  });
  it('recognizes successful mining research for both follow-up research paths', () => {
    const completed = { ...lead, metadata: { ...lead.metadata,
      deep_research: { status: 'completed', completed_at: '2026-09-29T22:00:00Z' } } };
    expect(hasCompletedLeadResearch(completed)).toBe(true);
    expect(needsLeadDeepResearch(completed)).toBe(false);
    expect(shouldExecuteLeadResearch(completed, true)).toBe(false);
    expect(shouldExecuteCompanyResearch({ ...completed, notes: '' }, true)).toBe(false);
  });
  it.each(['failed', 'running'])('keeps %s research eligible despite partial legacy metadata', status => {
    const failed = { ...lead, metadata: { research_analysis: { summary: 'partial' }, last_research_date: '2026-09-29',
      deep_research: { status, completed_at: null } } };
    expect(needsLeadDeepResearch(failed)).toBe(true);
  });
  it('recognizes existing genuine legacy research but not a bare timestamp', () => {
    expect(hasCompletedLeadResearch({ metadata: { research_analysis: { summary: 'Company and person analysis' },
      last_research_date: '2026-09-29T22:00:00Z' } })).toBe(true);
    expect(hasCompletedLeadResearch({ metadata: { research_timestamp: '2026-09-29' } })).toBe(false);
    expect(hasCompletedLeadResearch({ metadata: { research_source: 'lead_research_workflow', research_timestamp: '2026-09-29' } })).toBe(false);
  });
  it('keeps legacy follow-up predicates unchanged when the Temporal patch is absent', () => {
    expect(shouldExecuteLeadResearch(lead)).toBe(false);
    expect(shouldExecuteLeadResearch({ origin: 'lead_generation_workflow' })).toBe(true);
  });
  it('requires successful nonempty research output', () => {
    expect(hasDeepResearchOutput({ success: true })).toBe(false);
    expect(hasDeepResearchOutput({ success: true, data: { deliverables: { lead: { notes: null }, company: {} } } })).toBe(false);
    expect(hasDeepResearchOutput({ success: true, error: 'No operations', data: { success: false,
      deliverables: { lead: { notes: 'template' } } } })).toBe(false);
    expect(hasDeepResearchOutput({ success: false, insights: ['partial'] })).toBe(false);
    expect(hasDeepResearchOutput({ success: true, data: { status: 'completed', deliverables: { company: { description: 'Details' } } } })).toBe(true);
  });
});