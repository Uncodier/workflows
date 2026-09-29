const mockPatched = jest.fn();
const mockStartChild = jest.fn();
const mockActivities = {
  logWorkflowExecutionActivity: jest.fn(), saveCronStatusActivity: jest.fn(), getSiteActivity: jest.fn(), getLeadActivity: jest.fn(),
  updateLeadActivity: jest.fn(), upsertCompanyActivity: jest.fn(), leadSegmentationActivity: jest.fn(),
  saveLeadResearchStateActivity: jest.fn(),
  saveLeadResearchCompanyActivity: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), proxyActivities: () => mockActivities,
  patched: mockPatched, startChild: mockStartChild, upsertSearchAttributes: jest.fn(),
  workflowInfo: () => ({ workflowId: 'research', runId: 'run' }),
}));
import { leadResearchWorkflow } from '../src/temporal/workflows/leadResearchWorkflow';
import { performResearch } from '../src/temporal/workflows/leadFollowUp/research';

describe('research completion workflow contract', () => {
  const output = { success: true, data: { status: 'completed', deliverables: { lead: { notes: 'Researched professional history' },
    company: { name: 'Company', niche_market: 'Full raw detail' } }, analysis: { summary: 'Research summary' } } };
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPatched.mockReturnValue(true);
    mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { name: 'Site', user_id: 'user' } });
    mockActivities.getLeadActivity.mockResolvedValue({ success: true, lead: { id: 'lead', site_id: 'site', name: 'Person',
      metadata: { finder: { person: {} }, emailVerified: true } } });
    mockActivities.updateLeadActivity.mockResolvedValue({ success: true });
    mockActivities.upsertCompanyActivity.mockResolvedValue({ success: true, company: { id: 'company', name: 'Company' } });
    mockActivities.saveLeadResearchCompanyActivity.mockResolvedValue({ success: true, company: { id: 'company', name: 'Company' } });
    mockActivities.leadSegmentationActivity.mockResolvedValue({ success: true });
    mockActivities.saveLeadResearchStateActivity.mockImplementation(async ({ completed }) => ({ success: true, completed }));
    mockStartChild.mockResolvedValue({ result: async () => output });
  });
  afterEach(() => jest.restoreAllMocks());
  const params = { lead_id: 'lead', site_id: 'site' };
  it('persists full output before exposing completed research and preserves existing data on updates', async () => {
    expect((await leadResearchWorkflow(params)).success).toBe(true);
    expect(mockActivities.saveLeadResearchStateActivity).toHaveBeenCalledWith(expect.objectContaining({ completed: true, result: output }));
    expect(mockActivities.updateLeadActivity).toHaveBeenCalledWith(expect.objectContaining({ preserveExistingData: true, site_id: 'site' }));
  });
  it.each([{ success: false, errors: ['provider failed'] }, { success: true },
    { success: true, data: { success: false, deliverables: { lead: { notes: 'fallback template' } } }, error: 'No operations' },
    { success: true, data: { deliverables: { lead: { notes: null }, company: {} } } },
  ])('does not report empty/failed research as success', async result => {
    mockStartChild.mockResolvedValue({ result: async () => result });
    expect((await leadResearchWorkflow(params)).success).toBe(false);
    expect(mockActivities.saveLeadResearchStateActivity).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
  });
  it('does not complete if the research snapshot cannot be persisted', async () => {
    mockActivities.saveLeadResearchStateActivity.mockRejectedValue(new Error('write failed'));
    await expect(leadResearchWorkflow(params)).rejects.toThrow('write failed');
    expect(mockActivities.updateLeadActivity.mock.calls[0][0].updateData.metadata.deep_research.status).toBe('running');
  });
  it('does not schedule research twice when follow-up receives completed mining research', async () => {
    await performResearch({ ...params, leadInfo: { origin: 'lead_enrichment_workflow', website: 'https://company.test',
      metadata: { deep_research: { status: 'completed', completed_at: '2026-09-29T22:00:00Z' } } },
      options: { ...params, researchEnabled: true }, site: { user_id: 'user' }, workflowId: 'followup', errors: [] });
    expect(mockStartChild).not.toHaveBeenCalled();
  });
  it('preserves the legacy command sequence without snapshot persistence', async () => {
    mockPatched.mockReturnValue(false);
    await leadResearchWorkflow(params);
    expect(mockActivities.saveLeadResearchStateActivity).not.toHaveBeenCalled();
    expect(mockActivities.updateLeadActivity.mock.calls[0][0]).not.toHaveProperty('preserveExistingData');
  });
  it('preserves legacy lazy company eligibility for malformed unused websites', async () => {
    mockPatched.mockReturnValue(false);
    mockStartChild.mockResolvedValue({ result: async () => ({ success: true }) });
    await performResearch({ ...params, leadInfo: { origin: 'lead_generation_workflow', company: { website: 123 } },
      options: { ...params, researchEnabled: true }, site: { user_id: 'user' }, workflowId: 'followup', errors: [] });
    expect(mockStartChild).toHaveBeenCalledTimes(1);
  });
});