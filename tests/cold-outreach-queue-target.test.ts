const mockActivities = {
  validateAndCleanStuckCronStatusActivity: jest.fn(), validateWorkflowConfigActivity: jest.fn(),
  getOutreachConfigurationActivity: jest.fn(), logWorkflowExecutionActivity: jest.fn(),
  saveCronStatusActivity: jest.fn(), validateCommunicationChannelsActivity: jest.fn(),
  getSiteActivity: jest.fn(), getSettingsActivity: jest.fn(), getProspectionLeadsActivity: jest.fn(),
  sendLeadsToSalesAgentActivity: jest.fn(), assignPriorityLeadsActivity: jest.fn(),
  countPendingMessagesActivity: jest.fn(), startLeadFollowUpWorkflowActivity: jest.fn(),
};
const mockPatched = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities,
  patched: (id: string) => mockPatched(id),
  upsertSearchAttributes: jest.fn(),
  workflowInfo: () => ({ workflowId: 'prospection', runId: 'run' }),
}));

import { dailyProspectionWorkflow } from '../src/temporal/workflows/dailyProspectionWorkflow';

const leads = (first: number, count: number) => Array.from({ length: count }, (_, i) => ({
  id: `lead-${first + i}`, email: `lead-${first + i}@example.com`, outreach_channels: ['email'],
}));
const cursor = (id: number) => ({ createdAt: '2026-11-20T00:00:00Z', id: `lead-${id}` });
const page = (first: number, count: number, hasMorePages: boolean) => ({
  success: true, leads: leads(first, count), hasMorePages, nextCursor: cursor(first + count - 1),
});

describe('cold outreach queue target', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPatched.mockReturnValue(true);
    mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({ canProceed: true });
    mockActivities.validateWorkflowConfigActivity.mockResolvedValue({ shouldExecute: true });
    mockActivities.getOutreachConfigurationActivity.mockResolvedValue({ shouldExecute: true, dailyMessageLimit: 100 });
    mockActivities.validateCommunicationChannelsActivity.mockResolvedValue({ success: true, hasAnyChannel: true, hasEmailChannel: true });
    mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { name: 'Example', user_id: 'owner' } });
    mockActivities.getSettingsActivity.mockResolvedValue({ success: true, settings: {} });
    mockActivities.getProspectionLeadsActivity.mockImplementation(async ({ page: index }) => page(index * 30 + 1, 30, true));
    mockActivities.sendLeadsToSalesAgentActivity.mockResolvedValue({ success: true, selectedLeads: ['lead-28', 'lead-28', 'other-site'] });
    mockActivities.countPendingMessagesActivity.mockResolvedValue({ success: true, count: 0 });
    mockActivities.startLeadFollowUpWorkflowActivity.mockImplementation(async ({ lead_id }) => ({ success: true, workflowId: lead_id }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('searches past 30 and fills the configured queue without counting duplicate or out-of-scope suggestions', async () => {
    const result = await dailyProspectionWorkflow({ site_id: 'site', minLeadsRequired: 30 });
    expect(result.outreachQueue).toEqual({ target: 100, started: 100, shortfall: 0 });
    expect(mockActivities.getProspectionLeadsActivity).toHaveBeenCalledTimes(4);
    const started = mockActivities.startLeadFollowUpWorkflowActivity.mock.calls.map(([req]) => req.lead_id);
    expect(started[0]).toBe('lead-28');
    expect(new Set(started).size).toBe(100);
    expect(started).not.toContain('other-site');
  });

  it('continues from the last cursor when human assignment and start failures consume the first pool', async () => {
    mockActivities.getOutreachConfigurationActivity.mockResolvedValue({ shouldExecute: true, dailyMessageLimit: 2 });
    mockActivities.getSettingsActivity.mockResolvedValue({ success: true, settings: { activities: { assign_leads_to_team: { status: 'active' } } } });
    mockActivities.assignPriorityLeadsActivity.mockResolvedValue({ success: true, assignedLeads: [{ id: 'lead-1' }] });
    mockActivities.getProspectionLeadsActivity.mockResolvedValueOnce(page(1, 2, true)).mockResolvedValueOnce(page(3, 2, false));
    mockActivities.startLeadFollowUpWorkflowActivity.mockResolvedValueOnce({ success: false, error: 'start failed' });
    const result = await dailyProspectionWorkflow({ site_id: 'site' });
    expect(result.outreachQueue).toEqual({ target: 2, started: 2, shortfall: 0 });
    expect(mockActivities.getProspectionLeadsActivity).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, outreach_cursor: cursor(2) }));
    expect(mockActivities.startLeadFollowUpWorkflowActivity.mock.calls.map(([req]) => req.lead_id)).toEqual(['lead-2', 'lead-3', 'lead-4']);
  });

  it('reports a shortfall when the eligible audience runs out', async () => {
    mockActivities.getProspectionLeadsActivity.mockResolvedValueOnce(page(1, 5, false));
    const result = await dailyProspectionWorkflow({ site_id: 'site' });
    expect(result.outreachQueue).toEqual({ target: 100, started: 5, shortfall: 95, reason: 'no_more_pages' });
  });

  it('honors explicit run and search safety limits', async () => {
    const result = await dailyProspectionWorkflow({ site_id: 'site', maxLeads: 70, maxPages: 1 });
    expect(result.outreachQueue).toEqual({ target: 70, started: 30, shortfall: 40, reason: 'max_pages_reached' });
    expect(mockActivities.getProspectionLeadsActivity).toHaveBeenCalledTimes(1);
  });

  it('reports queue throttling without generating more work', async () => {
    mockActivities.countPendingMessagesActivity.mockResolvedValue({ success: true, count: 100 });
    const result = await dailyProspectionWorkflow({ site_id: 'site' });
    expect(result.outreachQueue).toEqual({ target: 100, started: 0, shortfall: 100, reason: 'queue_throttled' });
    expect(mockActivities.startLeadFollowUpWorkflowActivity).not.toHaveBeenCalled();
  });

  it('keeps the old activity sequence for histories without the patch', async () => {
    mockPatched.mockImplementation(id => id !== 'cold-outreach-fill-configured-batch-v1');
    const result = await dailyProspectionWorkflow({ site_id: 'site' });
    expect(result.outreachQueue).toBeUndefined();
    expect(mockActivities.getProspectionLeadsActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.startLeadFollowUpWorkflowActivity).toHaveBeenCalledTimes(2);
  });
});