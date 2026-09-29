import { processConfiguredIcp } from '../src/temporal/workflows/icpMining/processConfigured';

function fixture(overrides = {}) {
  const icp = { id: 'icp', role_query_id: 'role', total_targets: 1188, processed_targets: 0,
    current_page: 0, current_page_offset: null, ...overrides };
  const deps = {
    logWorkflowExecutionActivity: jest.fn(),
    markIcpMiningStartedActivity: jest.fn().mockResolvedValue({ success: true }),
    updateIcpMiningProgressActivity: jest.fn().mockImplementation(async (update) => {
      if (update.processedTargets !== undefined) icp.processed_targets = update.processedTargets;
      if (update.currentPage !== undefined) icp.current_page = update.currentPage;
      if (update.currentPageOffset !== undefined) icp.current_page_offset = update.currentPageOffset;
      return { success: true };
    }),
    markIcpMiningCompletedActivity: jest.fn().mockResolvedValue({ success: true }),
    executePageSearch: jest.fn().mockImplementation(async ({ page, start_index, max_matches }) => {
      const available = Math.min(10, icp.total_targets - page * 10) - start_index;
      const processed = Math.min(available, max_matches);
      return { success: true, processed, foundMatches: processed, leadsCreated: [], errors: [],
        pageCompleted: processed === available, hasMore: (page + 1) * 10 < icp.total_targets };
    }),
  };
  return { icp, options: { site_id: 'site', researchEnabled: true }, workflowId: 'run',
    maxPages: 300, pageSize: 10, targetLeadsWithEmail: 25, actualUserId: 'user', deps };
}

describe('configured ICP pagination', () => {
  it('stops at an exact target and resumes the partial page without duplicates or omissions', async () => {
    const args = fixture();
    expect(await processConfiguredIcp(args)).toMatchObject({ processed: 25, foundMatches: 25 });
    expect(args.icp).toMatchObject({ current_page: 2, current_page_offset: 5, processed_targets: 25 });
    args.deps.executePageSearch.mockClear();
    expect(await processConfiguredIcp(args)).toMatchObject({ processed: 25, foundMatches: 25 });
    expect(args.deps.executePageSearch.mock.calls[0][0]).toMatchObject({ page: 2, start_index: 5, research_enabled: true });
    expect(args.icp).toMatchObject({ current_page: 5, current_page_offset: 0, processed_targets: 50 });
  });
  it('uses cumulative progress when completing a resumed request', async () => {
    const args = fixture({ processed_targets: 1180, current_page: 118 });
    expect(await processConfiguredIcp(args)).toMatchObject({ processed: 8, foundMatches: 8 });
    expect(args.deps.markIcpMiningCompletedActivity).toHaveBeenCalledWith({ id: 'icp', failed: false, last_error: null });
  });
  it('fetches unknown totals only once and counts the first page', async () => {
    const args = fixture({ total_targets: 0 });
    args.deps.executePageSearch.mockResolvedValue({ success: true, processed: 3, foundMatches: 3,
      leadsCreated: [], errors: [], total: 3, hasMore: false, pageCompleted: true });
    expect(await processConfiguredIcp(args)).toMatchObject({ processed: 3, totalTargets: 3 });
    expect(args.deps.executePageSearch).toHaveBeenCalledTimes(1);
  });
  it('does not advance or mark complete on a failed fetch, and retains the error', async () => {
    const args = fixture();
    args.deps.executePageSearch.mockResolvedValue({ success: false, processed: 0, foundMatches: 0,
      leadsCreated: [], errors: ['provider unavailable'], hasMore: false });
    expect(await processConfiguredIcp(args)).toMatchObject({ errors: ['provider unavailable'] });
    expect(args.icp.current_page).toBe(0);
    expect(args.deps.markIcpMiningCompletedActivity).not.toHaveBeenCalled();
    expect(args.deps.updateIcpMiningProgressActivity).toHaveBeenLastCalledWith({ id: 'icp', status: 'pending', last_error: 'provider unavailable' });
  });
  it('stops at the safety page cap even if no leads match', async () => {
    const args = fixture();
    args.maxPages = 2;
    args.deps.executePageSearch.mockResolvedValue({ success: true, processed: 10, foundMatches: 0,
      leadsCreated: [], errors: [], hasMore: true, pageCompleted: true });
    expect(await processConfiguredIcp(args)).toMatchObject({ processed: 20, foundMatches: 0 });
    expect(args.deps.executePageSearch).toHaveBeenCalledTimes(2);
  });
  it('fails rather than claiming progress when the database write fails', async () => {
    const args = fixture();
    args.deps.updateIcpMiningProgressActivity.mockResolvedValue({ success: false, error: 'db unavailable' });
    await expect(processConfiguredIcp(args)).rejects.toThrow('progress was not saved');
    expect(args.deps.markIcpMiningCompletedActivity).not.toHaveBeenCalled();
  });
});