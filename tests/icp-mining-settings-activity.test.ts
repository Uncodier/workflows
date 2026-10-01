const mockSingle = jest.fn();
const mockFrom = jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: mockSingle }) }) }));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
import { getIcpMiningConfigurationActivity } from '../src/temporal/activities/icpMiningConfigurationActivity';
import { validateWorkflowConfigActivity } from '../src/temporal/activities/activityControlActivities';

describe('persisted ICP activity settings', () => {
  beforeEach(() => jest.clearAllMocks());
  it('loads the latest saved settings at execution time', async () => {
    mockSingle.mockResolvedValue({ data: { activities: { icp_lead_generation: {
      status: 'inactive', target_leads: 37, research_enabled: true,
    } } }, error: null });
    expect(await getIcpMiningConfigurationActivity({ site_id: 'site' }))
      .toEqual({ targetLeads: 37, researchEnabled: true, allLists: true, listIds: [] });
    expect(mockFrom).toHaveBeenCalledWith('settings');
  });
  it('fails on a database error rather than falling back to a larger target', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await expect(getIcpMiningConfigurationActivity({ site_id: 'site' })).rejects.toThrow('ICP settings unavailable');
  });
  it('loads the latest list scope from persisted settings without widening it', async () => {
    const id = 'abcdef12-3456-7890-abcd-ef1234567890';
    mockSingle.mockResolvedValue({ data: { activities: { icp_lead_generation: {
      all_lists: false, list_ids: [id],
    } } }, error: null });
    expect(await getIcpMiningConfigurationActivity({ site_id: 'site' }))
      .toMatchObject({ allLists: false, listIds: [id] });
  });
  it('does not cache controls between executions or retry attempts', async () => {
    const id = 'abcdef12-3456-7890-abcd-ef1234567890';
    mockSingle.mockResolvedValueOnce({ data: { activities: { icp_lead_generation: {
      target_leads: 150, research_enabled: true, all_lists: true,
    } } }, error: null }).mockResolvedValueOnce({ data: { activities: { icp_lead_generation: {
      target_leads: 7, research_enabled: false, all_lists: false, list_ids: [id],
    } } }, error: null });
    expect(await getIcpMiningConfigurationActivity({ site_id: 'site' }))
      .toMatchObject({ targetLeads: 150, researchEnabled: true, allLists: true });
    expect(await getIcpMiningConfigurationActivity({ site_id: 'site' }))
      .toEqual({ targetLeads: 7, researchEnabled: false, allLists: false, listIds: [id] });
    expect(mockSingle).toHaveBeenCalledTimes(2);
  });
  it('always permits ICP without reading status or outreach settings', async () => {
    expect(await validateWorkflowConfigActivity('site', 'icp_lead_generation'))
      .toMatchObject({ shouldExecute: true, activityStatus: 'active' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});