const mockActivities: Record<string, jest.Mock> = {};
const mockPatched = jest.fn();
const mockStartChild = jest.fn();
const mockRequest = jest.fn();
const mockFrom = jest.fn();
const mockFetchLead = jest.fn();
const mockUpdateLead = jest.fn();
const mockFinderCompany = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), proxyActivities: () => mockActivities,
  patched: mockPatched, startChild: mockStartChild, upsertSearchAttributes: jest.fn(),
  workflowInfo: () => ({ workflowId: 'research-run', runId: 'run' }),
}));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: () => ({
  getConnectionStatus: async () => true, fetchLead: mockFetchLead, updateLead: mockUpdateLead,
}) }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { request: mockRequest } }));
jest.mock('../src/temporal/client', () => ({}));
jest.mock('../src/config/config', () => ({ temporalConfig: {} }));
jest.mock('../src/temporal/activities/finderActivities', () => ({ upsertFinderCompanyActivity: mockFinderCompany }));

// Populate the proxy before importing workflows (their activity destructuring runs at import time).
for (const name of ['logWorkflowExecutionActivity', 'saveCronStatusActivity', 'getSiteActivity', 'getLeadActivity',
  'getCompanyActivity', 'updateLeadActivity', 'upsertCompanyActivity', 'leadSegmentationActivity',
  'validateContactInformation', 'leadContactGenerationActivity', 'updateLeadEmailVerificationActivity',
  'saveLeadResearchStateActivity', 'saveLeadResearchCompanyActivity', 'deepResearchActivity',
  'searchOperationActivity', 'dataAnalysisActivity']) mockActivities[name] = jest.fn();
const { leadResearchWorkflow } = require('../src/temporal/workflows/leadResearchWorkflow');
const { deepResearchWorkflow } = require('../src/temporal/workflows/deepResearchWorkflow');
const { getLeadActivity, updateLeadActivity } = require('../src/temporal/activities/leadActivities');
const { dataAnalysisActivity } = require('../src/temporal/activities/dataAnalystActivities');
const { saveLeadResearchStateActivity, saveLeadResearchCompanyActivity } = require('../src/temporal/activities/leadResearchStateActivity');
import { hasCompletedLeadResearch, hasDeepResearchOutput } from '../src/temporal/utils/leadResearchState';

describe('research → actual analysis activity → API body → actual persistence boundary', () => {
  let lead: any;
  let companies: Record<string, any>;
  let companyWrites: Array<{ id: string; data: any }>;
  let profileWrites: any[];
  const clone = (value: any) => JSON.parse(JSON.stringify(value));
  const params = { site_id: 'site', lead_id: 'lead' };
  const apiCompleted = (deliverables?: any, research_analysis: any = { executive_summary: 'Evidence-backed professional and company findings' }) => ({
    success: true, data: { commandId: 'analysis-command', status: 'completed', deliverables, research_analysis },
  });
  beforeEach(() => {
    jest.resetAllMocks();
    for (const key of ['log', 'warn', 'error'] as const) jest.spyOn(console, key).mockImplementation(() => undefined);
    lead = { id: 'lead', site_id: 'site', name: 'Person', company_name: 'Company A', company_id: 'A', phone: '+15555550100',
      notes: 'Finder notes', metadata: { emailVerified: true, finder: { person: { skills: ['TypeScript'] } } } };
    companies = { A: { id: 'A', name: 'Company A', description: 'Existing Finder description', languages: ['en'],
      address: { city: 'Madrid', country: 'ES' } }, B: { id: 'B', name: 'Unrelated company B', description: 'Must never change' } };
    companyWrites = []; profileWrites = [];
    mockPatched.mockReturnValue(true);
    mockFetchLead.mockImplementation(async () => clone(lead));
    mockUpdateLead.mockImplementation(async (_id, update) => { profileWrites.push(clone(update)); lead = { ...lead, ...clone(update) }; return clone(lead); });
    mockFrom.mockImplementation((table: string) => {
      let update: any;
      const filters: Array<[string, any]> = [];
      const query: any = {
        select: () => query, eq: (key: string, value: any) => { filters.push([key, value]); return query; },
        is: (key: string, value: any) => { filters.push([key, value]); return query; },
        update: (value: any) => { update = clone(value); return query; },
        single: async () => {
          const row = table === 'leads' ? lead : companies[filters.find(([key]) => key === 'id')?.[1]];
          if (!row || filters.some(([key, value]) => (row[key] ?? null) !== value)) return { data: null, error: null };
          if (update) {
            if (table === 'leads') lead = { ...lead, ...update };
            else { companyWrites.push({ id: row.id, data: update }); companies[row.id] = { ...row, ...update }; }
          }
          return { data: clone(table === 'leads' ? lead : companies[row.id]), error: null };
        },
      };
      return query;
    });
    mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { name: 'Site', url: 'https://site.test', user_id: 'user' } });
    mockActivities.getLeadActivity.mockImplementation(getLeadActivity);
    mockActivities.getCompanyActivity.mockImplementation(async (id: string) => ({ success: true, company: clone(companies[id]) }));
    mockActivities.updateLeadActivity.mockImplementation(updateLeadActivity);
    mockActivities.saveLeadResearchStateActivity.mockImplementation(saveLeadResearchStateActivity);
    mockActivities.saveLeadResearchCompanyActivity.mockImplementation(saveLeadResearchCompanyActivity);
    mockActivities.leadSegmentationActivity.mockResolvedValue({ success: true });
    mockActivities.deepResearchActivity.mockResolvedValue({ success: true, data: { command_id: 'command' },
      operations: [{ type: 'search', search_queries: ['Person Company A'] }] });
    mockActivities.searchOperationActivity.mockResolvedValue({ success: true, results: [{ content: 'Discovered facts' }] });
    mockActivities.dataAnalysisActivity.mockImplementation(dataAnalysisActivity);
    mockRequest.mockResolvedValue(apiCompleted({ lead: { notes: 'New researched profile' }, company: { name: 'Company A', description: 'New verified company facts' } }));
    mockStartChild.mockImplementation(async (workflow: any, { args }: any) => ({ result: () => workflow(...args) }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('blocks the company A → model company_id B → overwrite B repro at both write boundaries', async () => {
    const output = apiCompleted({ lead: { company_id: 'B', segment_id: 'segment-B', campaign_id: 'campaign-B', command_id: 'command-B',
      person_id: 'person-B', user_id: 'user-B', assignee_id: 'owner-B', site_id: 'site-B', status: 'won', origin: 'AI',
      created_at: '2099-01-01', notes: 'New researched profile', company: { id: 'B', name: 'Company A' },
      metadata: { emailVerified: false, deep_research: { status: 'completed' } } },
      company: { id: 'B', parent_company_id: 'B', acquired_by_id: 'B', name: 'Company A', description: 'Verified A only', address: { postal_code: '1234' } } });
    mockRequest.mockResolvedValue(output);
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(lead.company_id).toBe('A');
    expect(lead.metadata.emailVerified).toBe(true);
    expect(companies.B).toEqual({ id: 'B', name: 'Unrelated company B', description: 'Must never change' });
    expect(companies.A).toMatchObject({ description: 'Verified A only', address: { city: 'Madrid', country: 'ES', postal_code: '1234' } });
    for (const update of profileWrites) for (const key of ['company_id', 'segment_id', 'campaign_id', 'command_id', 'site_id', 'person_id', 'user_id', 'status', 'created_at']) {
      expect(update).not.toHaveProperty(key);
    }
    expect(companyWrites.every(write => write.id === 'A')).toBe(true);
    expect(companyWrites[0].data).not.toHaveProperty('id');
    expect(mockActivities.upsertCompanyActivity).not.toHaveBeenCalled();
    expect(mockActivities.saveLeadResearchCompanyActivity).toHaveBeenCalledWith(expect.objectContaining({ trustedCompanyId: 'A' }));
    expect(lead.metadata.deep_research_result.data.raw_analysis_response.data).toEqual(output.data);
  });

  it('rejects HTTP200 success:true/status:timeout even though the local template includes name/languages/timestamps', async () => {
    mockRequest.mockResolvedValue({ success: true, data: { status: 'timeout', commandId: 'command',
      message: 'Research analysis timed out - command may still be processing', timestamp: '2026-09-29T22:00:00Z' } });
    expect((await leadResearchWorkflow(params)).success).toBe(false);
    expect(lead.metadata.deep_research).toMatchObject({ status: 'failed', retryable: true, completed_at: null });
    expect(lead.metadata.deep_research.errors.join(' ')).toContain('timeout');
    expect(hasCompletedLeadResearch(lead)).toBe(false);
    expect(companyWrites).toHaveLength(0);
    expect(lead.notes).toBe('Finder notes');
    expect(lead.metadata.deep_research_result.data.raw_analysis_response.data.status).toBe('timeout');
    expect(mockRequest).toHaveBeenCalledWith('/api/agents/dataAnalyst/analysis', expect.objectContaining({
      body: expect.objectContaining({ deliverables: expect.objectContaining({ company: expect.objectContaining({ name: 'Company A', languages: ['en'], _research_timestamp: expect.any(String) }) }) }),
    }));
  });

  it('persists omitted legal/financial/operational company fields on the original company even without a repeated name', async () => {
    const company = { tax_id: 'TAX123', tax_country: 'ES', registration_number: 'REG123', vat_number: 'VAT123', legal_structure: 'ltd',
      business_model: 'b2b', remote_policy: 'hybrid', sustainability_score: 0, market_cap: '9007199254740993',
      last_funding_date: '2026-09-01', ipo_date: '2020-02-29', acquisition_date: '2026-08-01',
      industry: 'AI and robotics', size: '50-ish', unsupported: { raw: 'preserve me' } };
    mockRequest.mockResolvedValue(apiCompleted({ company }));
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(companies.A).toMatchObject({ tax_id: 'TAX123', tax_country: 'ES', registration_number: 'REG123', vat_number: 'VAT123',
      legal_structure: 'ltd', business_model: 'b2b', remote_policy: 'hybrid', sustainability_score: 0, market_cap: '9007199254740993',
      last_funding_date: '2026-09-01', ipo_date: '2020-02-29', acquisition_date: '2026-08-01' });
    expect(companyWrites[0].data).not.toHaveProperty('industry');
    expect(companyWrites[0].data).not.toHaveProperty('size');
    expect(lead.metadata.deep_research_result.data.deliverables.company).toEqual(company);
  });

  it('accepts real nested research_analysis without copying local template into persisted deliverables', async () => {
    mockRequest.mockResolvedValue(apiCompleted(undefined, { executive_summary: 'Company has expanded its healthcare analytics practice', key_findings: ['Opened Madrid office'] }));
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(lead.metadata.research_analysis.executive_summary).toContain('healthcare analytics');
    expect(lead.metadata.deep_research_result.data.deliverables).toEqual({});
    expect(hasDeepResearchOutput(lead.metadata.deep_research_result)).toBe(true);
    expect(companyWrites).toHaveLength(0);
  });

  it('rejects a completed response that merely echoes the enhanced input template', async () => {
    mockRequest.mockImplementation(async (_path, request) => apiCompleted(request.body.deliverables, {}));
    expect((await leadResearchWorkflow(params)).success).toBe(false);
    expect(hasCompletedLeadResearch(lead)).toBe(false);
    expect(companyWrites).toHaveLength(0);
  });

  it('does not treat API analysis type placeholders as discovered analysis', async () => {
    mockRequest.mockResolvedValue(apiCompleted(undefined, { executive_summary: 'string', key_findings: 'array', trend_analysis: 'object' }));
    expect((await leadResearchWorkflow(params)).success).toBe(false);
  });

  it.each(['returned failure', 'exception'])('completes valid phone-only research despite email generation %s', async failure => {
    lead.metadata.emailVerified = false;
    if (failure === 'exception') mockActivities.leadContactGenerationActivity.mockRejectedValue(new Error('Email API down'));
    else mockActivities.leadContactGenerationActivity.mockResolvedValue({ success: false, error: 'No email generated' });
    mockActivities.leadSegmentationActivity.mockResolvedValue({ success: false, error: 'Optional segmentation down' });
    const result = await leadResearchWorkflow(params);
    expect(result.success).toBe(true);
    expect(result.errors.join(' ')).toMatch(/Email validation/);
    expect(lead.metadata.deep_research).toMatchObject({ status: 'completed', errors: [], retryable: false });
    expect(lead.phone).toBe('+15555550100');
  });

  it('keeps research retryable if profile persistence fails', async () => {
    mockUpdateLead.mockImplementation(async (_id, update) => {
      if (update.notes) throw new Error('Profile write failed');
      lead = { ...lead, ...update }; return clone(lead);
    });
    expect((await leadResearchWorkflow(params)).success).toBe(false);
    expect(lead.metadata.deep_research).toMatchObject({ status: 'failed', retryable: true });
    expect(lead.metadata.deep_research.errors.join(' ')).toContain('Profile write failed');
  });

  it('does not follow a company reassignment that occurs while research is in flight', async () => {
    const normal = mockRequest.getMockImplementation();
    mockRequest.mockImplementation(async (...args) => { lead.company_id = 'B'; return normal!(...args); });
    expect((await leadResearchWorkflow(params)).success).toBe(false);
    expect(companyWrites).toHaveLength(0);
    expect(lead.metadata.deep_research.errors.join(' ')).toContain('relationship changed');
  });

  it('links only a verified company returned by trusted persistence, and its retry is idempotent', async () => {
    lead.company_id = null;
    mockFinderCompany.mockImplementation(async () => { companies.C = { id: 'C', name: 'Company A' }; return { success: true, company: companies.C }; });
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(lead.company_id).toBe('C');
    const call = mockActivities.saveLeadResearchCompanyActivity.mock.calls[0][0];
    expect(call.trustedCompanyId).toBe(null);
    expect((await saveLeadResearchCompanyActivity(call)).success).toBe(true);
    expect(mockFinderCompany).toHaveBeenCalledTimes(1);
    expect(profileWrites.every(update => !('company_id' in update))).toBe(true);
  });

  it('replaces stale failure snapshot on a successful retry but retains Finder data', async () => {
    lead.metadata.deep_research_result = { success: false, error: 'old timeout', errors: ['old'], data: { fallback: true, stale: true } };
    lead.metadata.research_analysis = { error: 'old timeout', status: 'timeout', conclusions: 'old' };
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(lead.metadata.finder.person.skills).toEqual(['TypeScript']);
    const result = lead.metadata.deep_research_result;
    expect(result.error).toBe(null);
    expect(result.data).not.toHaveProperty('stale');
    expect(result.data.fallback).toBe(false);
    expect(hasDeepResearchOutput(result)).toBe(true);
    expect(lead.metadata.research_analysis).not.toHaveProperty('error');
    expect(lead.metadata.research_analysis).not.toHaveProperty('status');
  });

  it('keeps both legacy workflow branches and the old v1 branch command payloads replay-safe', async () => {
    mockPatched.mockReturnValue(false);
    mockRequest.mockResolvedValue({ success: true, data: { status: 'timeout' } });
    expect((await deepResearchWorkflow({ site_id: 'site', research_topic: 'Topic' })).success).toBe(true);
    mockPatched.mockImplementation((id: string) => id === 'lead-research-persist-completion-v1');
    mockStartChild.mockResolvedValue({ result: async () => ({ success: true, data: { deliverables: { lead: { notes: 'Legacy result without status' } } } }) });
    mockActivities.saveLeadResearchStateActivity.mockResolvedValue({ success: true, completed: true });
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(mockActivities.saveLeadResearchStateActivity.mock.calls[0][0]).not.toHaveProperty('validation');
    expect(mockStartChild.mock.calls[0][1].args[0]).not.toHaveProperty('companyPersistence');
  });
});