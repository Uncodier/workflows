import { processOwnedIcp } from '../src/temporal/workflows/icpMining/processOwned';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';

function fixture() {
  let row: any = { id: 'icp', site_id: 'site', role_query_id: 'role', total_targets: 10,
    processed_targets: 0, found_matches: 0, current_page: 0, current_page_offset: 0, checkpoint_version: 0 };
  const checkpoint = jest.fn(async (update: any) => {
    if (update.version !== row.checkpoint_version + 1) throw new Error('stale checkpoint');
    row = { ...row, processed_targets: update.processed, found_matches: update.found,
      current_page: update.page, current_page_offset: update.offset, current_page_snapshot: update.snapshot,
      checkpoint_version: update.version, status: update.status };
    return { success: true };
  });
  const dependencies = {
    checkpointIcpMiningExecutionActivity: checkpoint,
    getRoleQueryByIdActivity: jest.fn().mockResolvedValue({ success: true, roleQuery: { query: {} } }),
    callPersonRoleSearchActivity: jest.fn().mockResolvedValue({ success: true, total: 10, hasMore: false,
      data: { search_results: Array.from({ length: 10 }, (_, n) => ({ person: { id: n + 1 }, organization: { name: 'Company' } })) } }),
    getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
    getLeadActivity: jest.fn(), research: jest.fn(),
    enrich: jest.fn().mockImplementation(async (options: any) => ({ success: true, leadId: `lead-${options.person_id}`, errors: [] })),
  };
  const args: any = {
    icp: row, options: { site_id: 'site', researchEnabled: false }, workflowId: 'test',
    maxPages: 300, targetLeadsWithEmail: 5, actualUserId: 'user', execution: { runId: 'run', workflowId: 'test' },
    claim: jest.fn(async () => { row.checkpoint_version = 0; return { acquired: true, icp: structuredClone(row) }; }), checkpoint,
    deps: { executePageSearch: (options: any) => processPageSafely(options, dependencies) },
  };
  return { args, dependencies, row: () => row, checkpoint };
}

describe('owned ICP processing', () => {
  it('leaves the failed candidate pending and resumes it without losing or duplicating earlier matches', async () => {
    const f = fixture();
    f.dependencies.enrich.mockImplementationOnce(async () => ({ success: true, leadId: 'lead-1', errors: [] }))
      .mockImplementationOnce(async () => ({ success: false, errors: ['temporary DB error'] }));
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 1, foundMatches: 1, errors: ['temporary DB error'] });
    expect(f.row()).toMatchObject({ status: 'pending', current_page: 0, current_page_offset: 1, processed_targets: 1 });
    expect(f.row().current_page_snapshot.candidates).toHaveLength(10);
    f.dependencies.enrich.mockClear();
    f.dependencies.callPersonRoleSearchActivity.mockClear();
    await processOwnedIcp(f.args);
    expect(f.dependencies.enrich.mock.calls[0][0].person_id).toBe('2');
    expect(f.dependencies.callPersonRoleSearchActivity).not.toHaveBeenCalled();
    expect(f.row().processed_targets).toBe(6);
  });
  it('never completes a list when every enrichment save fails', async () => {
    const f = fixture();
    f.dependencies.enrich.mockResolvedValue({ success: false, errors: ['save failed'] });
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 0, foundMatches: 0 });
    expect(f.row()).toMatchObject({ status: 'pending', current_page: 0, current_page_offset: 0 });
    expect(f.dependencies.enrich).toHaveBeenCalledTimes(1);
  });
  it('counts definitive no-match candidates and completes only after all candidates have an outcome', async () => {
    const f = fixture();
    f.dependencies.enrich.mockResolvedValue({ success: true, outcome: 'no_match', errors: [] });
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 10, foundMatches: 0, errors: [] });
    expect(f.row()).toMatchObject({ status: 'completed', current_page: 1, current_page_offset: 0, current_page_snapshot: null });
  });
  it('uses a durable snapshot even when provider pages change between runs', async () => {
    const f = fixture();
    await processOwnedIcp(f.args);
    f.dependencies.callPersonRoleSearchActivity.mockResolvedValue({ success: true, data: { search_results: [] }, hasMore: false });
    f.dependencies.enrich.mockClear();
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 5, foundMatches: 5 });
    expect(f.dependencies.enrich.mock.calls.map(([options]) => options.person_id)).toEqual(['6', '7', '8', '9', '10']);
    expect(f.dependencies.callPersonRoleSearchActivity).toHaveBeenCalledTimes(1);
    expect(f.row().status).toBe('completed');
  });
  it('does no billable work when another live run owns the request', async () => {
    const f = fixture();
    f.args.claim.mockResolvedValue({ acquired: false, reason: 'busy' });
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 0, skipped: 'busy' });
    expect(f.dependencies.callPersonRoleSearchActivity).not.toHaveBeenCalled();
    expect(f.dependencies.enrich).not.toHaveBeenCalled();
    expect(f.checkpoint).not.toHaveBeenCalled();
  });
  it('retries requested research independently of follow-up without skipping the saved lead', async () => {
    const f = fixture();
    f.args.options.researchEnabled = true;
    f.dependencies.getLeadActivity.mockResolvedValue({ success: true, lead: { site_id: 'site' } });
    f.dependencies.research.mockResolvedValue({ success: false, errors: ['analysis timeout'] });
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 0, foundMatches: 0, errors: ['analysis timeout'] });
    expect(f.row()).toMatchObject({ status: 'pending', current_page_offset: 0 });
    f.dependencies.research.mockResolvedValue({ success: true, errors: [] });
    expect(await processOwnedIcp(f.args)).toMatchObject({ processed: 5, foundMatches: 5 });
  });
  it('fails without releasing ownership when a durable checkpoint cannot be written', async () => {
    const f = fixture();
    f.checkpoint.mockRejectedValue(new Error('write unavailable'));
    await expect(processOwnedIcp(f.args)).rejects.toThrow('write unavailable');
    expect(f.dependencies.enrich).not.toHaveBeenCalled();
    expect(f.checkpoint.mock.calls.every(([update]) => update.status === 'running')).toBe(true);
  });
});