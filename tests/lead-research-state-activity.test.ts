const mockFrom = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
jest.mock('../src/temporal/activities/finderActivities', () => ({ upsertFinderCompanyActivity: jest.fn() }));
import { saveLeadResearchStateActivity, saveLeadResearchCompanyActivity } from '../src/temporal/activities/leadResearchStateActivity';
import { hasCompletedLeadResearch } from '../src/temporal/utils/leadResearchState';

describe('research output persistence', () => {
  let row: any;
  beforeEach(() => {
    row = { id: 'lead', metadata: { finder: { person: { name: 'Keep', roles: ['CEO'] } }, emailVerified: true } };
    mockFrom.mockImplementation(() => {
      let update: any;
      const query: any = { select: () => query, eq: jest.fn(() => query), update: (value: any) => { update = value; return query; },
        single: async () => { if (update) row = { ...row, ...update }; return { data: row, error: null }; } };
      return query;
    });
  });
  const params = { lead_id: 'lead', site_id: 'site', workflow_id: 'research', completed: true, errors: [],
    result: { success: true, data: { status: 'completed', deliverables: { lead: { profile: 'full profile' }, company: { unusual_field: 'preserve' } } } } };
  it('keeps full person and company research as well as existing provider and verification data', async () => {
    expect(await saveLeadResearchStateActivity(params)).toEqual({ success: true, completed: true });
    expect(row.metadata).toMatchObject({ finder: { person: { name: 'Keep' } }, emailVerified: true,
      deep_research_result: params.result });
    expect(hasCompletedLeadResearch(row)).toBe(true);
  });
  it('records failed/empty attempts without a false completed marker', async () => {
    await saveLeadResearchStateActivity({ ...params, result: { success: true }, errors: ['empty output'] });
    expect(row.metadata.deep_research).toMatchObject({ status: 'failed', completed_at: null, errors: ['empty output'] });
    expect(hasCompletedLeadResearch(row)).toBe(false);
  });
  it('rejects missing or cross-site leads before saving', async () => {
    mockFrom.mockImplementation(() => {
      const query: any = { select: () => query, eq: () => query, single: async () => ({ data: null, error: null }) };
      return query;
    });
    await expect(saveLeadResearchStateActivity(params)).rejects.toThrow('lead not found in site');
  });
  it('preserves linked company fields and ignores an AI-supplied company ID', async () => {
    const writes: any[] = [];
    const replies = [{ data: { company_id: 'linked' } }, { data: { id: 'linked', name: 'Company',
      address: { city: 'Madrid', country: 'ES' }, description: 'Provider description' } }, { data: { id: 'linked' } }];
    mockFrom.mockImplementation(() => {
      const query: any = { select: () => query, eq: (field: string, value: string) => { writes.push({ field, value }); return query; },
        update: (update: any) => { writes.push({ update }); return query; }, single: async () => replies.shift() };
      return query;
    });
    const result = await saveLeadResearchCompanyActivity({ lead_id: 'lead', site_id: 'site', trustedCompanyId: 'linked', company: {
      id: 'wrong', name: 'Company', description: '', address: { city: null, postal_code: '1234' } } });
    expect(result.success).toBe(true);
    const update = writes.find(entry => entry.update).update;
    expect(update.address).toEqual({ city: 'Madrid', country: 'ES', postal_code: '1234' });
    expect(update).not.toHaveProperty('description');
    expect(update).not.toHaveProperty('id');
    expect(writes.filter(entry => entry.field === 'id').every(entry => ['lead', 'linked'].includes(entry.value))).toBe(true);
  });
  it('fails closed for old pending company saves without a pre-model identity snapshot', async () => {
    mockFrom.mockClear();
    expect(await saveLeadResearchCompanyActivity({ lead_id: 'lead', site_id: 'site', company: { name: 'Company' } }))
      .toMatchObject({ success: false, error: expect.stringContaining('Trusted company snapshot') });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});