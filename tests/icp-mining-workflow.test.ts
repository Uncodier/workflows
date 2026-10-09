const mockPatched = jest.fn();
const mockExecuteChild = jest.fn();
const mockActivities = {
  logWorkflowExecutionActivity: jest.fn(), saveCronStatusActivity: jest.fn(),
  validateWorkflowConfigActivity: jest.fn(), validateCommunicationChannelsActivity: jest.fn(),
  getIcpMiningConfigurationActivity: jest.fn(), getPendingIcpMiningActivity: jest.fn(), getIcpMiningByIdActivity: jest.fn(),
  markIcpMiningStartedActivity: jest.fn(), updateIcpMiningProgressActivity: jest.fn(), markIcpMiningCompletedActivity: jest.fn(),
  getRoleQueryByIdActivity: jest.fn(), callPersonRoleSearchActivity: jest.fn(), getSegmentIdFromRoleQueryActivity: jest.fn(),
  getLeadActivity: jest.fn(),
  claimIcpMiningExecutionActivity: jest.fn(), checkpointIcpMiningExecutionActivity: jest.fn(),
  isIcpDispatcherEnabledActivity: jest.fn(),
  checkIcpMiningCreditsActivity: jest.fn(), warnIcpMiningCreditsActivity: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), proxyActivities: () => mockActivities,
  patched: mockPatched, executeChild: mockExecuteChild,
  workflowInfo: () => ({ runId: 'run', workflowId: 'icp-test' }), upsertSearchAttributes: jest.fn(),
}));
import { idealClientProfileMiningWorkflow } from '../src/temporal/workflows/idealClientProfileMiningWorkflow';
import { idealClientProfilePageSearchWorkflow } from '../src/temporal/workflows/idealClientProfilePageSearchWorkflow';
import { enrichLeadWorkflow } from '../src/temporal/workflows/enrichLeadWorkflow';
import { leadResearchWorkflow } from '../src/temporal/workflows/leadResearchWorkflow';

describe('configurable independent ICP workflow', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockActivities.isIcpDispatcherEnabledActivity.mockResolvedValue(false);
    mockActivities.checkIcpMiningCreditsActivity.mockResolvedValue(true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPatched.mockImplementation((key: string) => key !== 'icp-mining-owned-checkpoints-v1');
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true });
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [
      { id: 'icp', site_id: 'site', status: 'pending', role_query_id: 'role', total_targets: 100, processed_targets: 0 },
    ] });
    mockActivities.markIcpMiningStartedActivity.mockResolvedValue({ success: true });
    mockActivities.updateIcpMiningProgressActivity.mockResolvedValue({ success: true });
    mockActivities.markIcpMiningCompletedActivity.mockResolvedValue({ success: true });
    mockActivities.getRoleQueryByIdActivity.mockResolvedValue({ success: true, roleQuery: { query: {} } });
    mockActivities.getSegmentIdFromRoleQueryActivity.mockResolvedValue({ success: true, segmentId: 'segment' });
    mockActivities.callPersonRoleSearchActivity.mockResolvedValue({ success: true, hasMore: true, total: 100,
      data: { search_results: Array.from({ length: 10 }, (_, i) => ({ person: { id: i + 1, full_name: `Person ${i}` },
        organization: { name: 'Company', website: 'https://example.test' }, role_title: 'CEO', custom_provider_field: 'keep' })) } });
    mockActivities.getLeadActivity.mockResolvedValue({ success: true, lead: { id: 'lead', site_id: 'site', origin: 'icp_mining',
      metadata: { provider: 'finder' } } });
    mockExecuteChild.mockImplementation(async (workflow, { args }) => workflow === enrichLeadWorkflow
      ? { success: true, leadId: `lead-${args[0].person_id}`, errors: [] }
      : { success: true, errors: [] });
  });
  afterEach(() => jest.restoreAllMocks());
  it('passes saved target and research controls to pages without activation or channel gates', async () => {
    mockExecuteChild.mockResolvedValue({ success: true, processed: 3, foundMatches: 3, leadsCreated: [],
      errors: [], hasMore: true, pageCompleted: false });
    const result = await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' });
    expect(result).toMatchObject({ success: true, processed: 3, foundMatches: 3 });
    expect(mockExecuteChild.mock.calls[0][1].args[0]).toMatchObject({ max_matches: 3, research_enabled: true, start_index: 0 });
    expect(mockActivities.validateWorkflowConfigActivity).not.toHaveBeenCalled();
    expect(mockActivities.validateCommunicationChannelsActivity).not.toHaveBeenCalled();
  });
  it('uses the owned protocol on new histories and never calls legacy progress writers', async () => {
    mockPatched.mockReturnValue(true);
    mockActivities.claimIcpMiningExecutionActivity.mockResolvedValue({ acquired: true, icp: {
      id: 'icp', site_id: 'site', role_query_id: 'role', status: 'running', total_targets: 10,
      processed_targets: 0, found_matches: 0, current_page: 0, current_page_offset: 0, checkpoint_version: 0,
    } });
    mockActivities.checkpointIcpMiningExecutionActivity.mockResolvedValue({ success: true });
    mockExecuteChild.mockResolvedValue({ success: true, processed: 3, foundMatches: 3, errors: [], leadsCreated: [],
      hasMore: false, pageCompleted: false, checkpoint: { processed: 3, found: 3, version: 4, page: 0, offset: 3,
        snapshot: { page: 0, candidates: Array(10).fill({ person: { id: 1 } }), hasMore: false } } });
    expect(await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' })).toMatchObject({ processed: 3, foundMatches: 3 });
    expect(mockActivities.claimIcpMiningExecutionActivity).toHaveBeenCalledWith({ id: 'icp', site_id: 'site', run_id: 'run', workflow_id: 'icp-test' });
    expect(mockExecuteChild.mock.calls[0][1].args[0].execution).toEqual({ run_id: 'run', version: 0, processed: 0, found: 0 });
    expect(mockActivities.checkpointIcpMiningExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({ version: 5, status: 'pending', processed: 3 }));
    expect(mockActivities.updateIcpMiningProgressActivity).not.toHaveBeenCalled();
    expect(mockActivities.markIcpMiningStartedActivity).not.toHaveBeenCalled();
  });
  it('rejects an ICP request belonging to another site without changing that request', async () => {
    mockActivities.getIcpMiningByIdActivity.mockResolvedValue({ success: true, icp: { id: 'other', site_id: 'other-site' } });
    const result = await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user', icp_mining_id: 'other' });
    expect(result.success).toBe(false);
    expect(mockActivities.markIcpMiningStartedActivity).not.toHaveBeenCalled();
    expect(mockActivities.markIcpMiningCompletedActivity).not.toHaveBeenCalled();
  });
  const selectedId = 'abcdef12-3456-7890-abcd-ef1234567890';
  const selectedRow = { id: selectedId, site_id: 'site', status: 'pending', role_query_id: 'role', total_targets: 100, processed_targets: 0 };
  const pageResult = { success: true, processed: 3, foundMatches: 3, leadsCreated: [], errors: [], hasMore: true, pageCompleted: false };
  it('mines only the configured subset and retains the shared target and research options', async () => {
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true,
      allLists: false, listIds: [selectedId] });
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [
      { ...selectedRow, id: 'unselected-running', status: 'running', total_targets: 5000 }, selectedRow,
    ] });
    mockExecuteChild.mockResolvedValue(pageResult);
    expect(await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' }))
      .toMatchObject({ success: true, icp_mining_id: selectedId, processed: 3 });
    expect(mockActivities.getPendingIcpMiningActivity).toHaveBeenCalledWith({ limit: 50, site_id: 'site', icp_mining_ids: [selectedId] });
    expect(mockActivities.markIcpMiningStartedActivity).toHaveBeenCalledWith({ id: selectedId });
    expect(mockExecuteChild.mock.calls[0][1].args[0]).toMatchObject({ max_matches: 3, research_enabled: true });
  });
  it('does no billable work for an explicit empty selection even if the fetch returns unrelated rows', async () => {
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: false, allLists: false, listIds: [] });
    expect(await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' }))
      .toMatchObject({ success: true, processed: 0, foundMatches: 0 });
    expect(mockActivities.getPendingIcpMiningActivity).toHaveBeenCalledWith({ limit: 50, site_id: 'site', icp_mining_ids: [] });
    expect(mockActivities.markIcpMiningStartedActivity).not.toHaveBeenCalled();
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });
  it('all-lists mode ignores the remembered subset and keeps the existing unfiltered query', async () => {
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true, allLists: true, listIds: [selectedId] });
    mockExecuteChild.mockResolvedValue(pageResult);
    expect((await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' })).icp_mining_id).toBe('icp');
    expect(mockActivities.getPendingIcpMiningActivity).toHaveBeenCalledWith({ limit: 50, site_id: 'site' });
  });
  it.each([{ status: 'completed' }, { status: 'failed' }, { site_id: 'other' }])('skips unavailable or cross-site selected lists without fallback', async extra => {
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true, allLists: false, listIds: [selectedId] });
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [{ ...selectedRow, ...extra }] });
    expect((await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' })).processed).toBe(0);
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });
  it('does not allow a direct-ID execution to bypass the list selection', async () => {
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true, allLists: false, listIds: [] });
    expect((await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user', icp_mining_id: selectedId })).success).toBe(false);
    expect(mockActivities.getIcpMiningByIdActivity).not.toHaveBeenCalled();
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });
  it('allows a direct-ID execution for a selected running list and preserves its cursor', async () => {
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true, allLists: false, listIds: [selectedId] });
    mockActivities.getIcpMiningByIdActivity.mockResolvedValue({ success: true, icp: { ...selectedRow,
      status: 'running', current_page: 2, current_page_offset: 4, processed_targets: 24 } });
    mockExecuteChild.mockResolvedValue(pageResult);
    expect((await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user', icp_mining_id: selectedId })).success).toBe(true);
    expect(mockExecuteChild.mock.calls[0][1].args[0]).toMatchObject({ page: 2, start_index: 4 });
  });
  it('does not restart a completed direct-ID request', async () => {
    mockActivities.getIcpMiningByIdActivity.mockResolvedValue({ success: true, icp: { ...selectedRow, status: 'completed' } });
    expect((await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user', icp_mining_id: selectedId })).success).toBe(false);
    expect(mockActivities.markIcpMiningStartedActivity).not.toHaveBeenCalled();
  });
  it('preserves pre-list-selection histories without changing recorded query arguments', async () => {
    mockPatched.mockImplementation((key: string) => !['icp-mining-list-selection-v1', 'icp-mining-owned-checkpoints-v1'].includes(key));
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 3, researchEnabled: true, allLists: false, listIds: [] });
    mockExecuteChild.mockResolvedValue(pageResult);
    expect((await idealClientProfileMiningWorkflow({ site_id: 'site', userId: 'user' })).processed).toBe(3);
    expect(mockActivities.getPendingIcpMiningActivity).toHaveBeenCalledWith({ limit: 50, site_id: 'site' });
  });
  const page = { role_query_id: 'role', site_id: 'site', userId: 'user', page: 0, page_size: 10,
    icp_mining_id: 'icp', max_matches: 3, research_enabled: true };
  it('processes only remaining candidates and preserves raw person/company payload for enrichment', async () => {
    const result = await idealClientProfilePageSearchWorkflow({ ...page, start_index: 5 });
    expect(result).toMatchObject({ processed: 3, foundMatches: 3, pageCompleted: false });
    const calls = mockExecuteChild.mock.calls.filter(([workflow]) => workflow === enrichLeadWorkflow);
    expect(calls.map(([, options]) => options.args[0].person_id)).toEqual(['6', '7', '8']);
    expect(calls[0][1].args[0].source_search_result).toMatchObject({ role_title: 'CEO',
      organization: { website: 'https://example.test' }, custom_provider_field: 'keep' });
    expect(mockExecuteChild.mock.calls.filter(([workflow]) => workflow === leadResearchWorkflow)).toHaveLength(3);
  });
  it('does not run research when disabled', async () => {
    await idealClientProfilePageSearchWorkflow({ ...page, research_enabled: false });
    expect(mockActivities.getLeadActivity).not.toHaveBeenCalled();
    expect(mockExecuteChild.mock.calls.every(([workflow]) => workflow === enrichLeadWorkflow)).toBe(true);
  });
  it('reuses completed research without starting another paid child', async () => {
    mockActivities.getLeadActivity.mockResolvedValue({ success: true, lead: { site_id: 'site',
      metadata: { deep_research: { status: 'completed', completed_at: '2026-09-29T22:00:00Z' } } } });
    await idealClientProfilePageSearchWorkflow(page);
    expect(mockExecuteChild.mock.calls.every(([workflow]) => workflow === enrichLeadWorkflow)).toBe(true);
  });
  it('retains mined leads and reports research failures', async () => {
    mockExecuteChild.mockImplementation(async (workflow, { args }) => workflow === enrichLeadWorkflow
      ? { success: true, leadId: `lead-${args[0].person_id}`, errors: [] }
      : { success: false, errors: ['research unavailable'] });
    const result = await idealClientProfilePageSearchWorkflow(page);
    expect(result).toMatchObject({ success: false, processed: 3, foundMatches: 3 });
    expect(result.errors.join(';')).toContain('research unavailable');
  });
  it('replays the old page branch without new child arguments or research', async () => {
    mockPatched.mockReturnValue(false);
    const result = await idealClientProfilePageSearchWorkflow(page);
    expect(result.processed).toBe(10);
    expect(mockExecuteChild.mock.calls[0][1].args[0]).not.toHaveProperty('source_search_result');
    expect(mockActivities.getLeadActivity).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('pageCompleted');
  });
});