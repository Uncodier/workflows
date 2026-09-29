import { resolveIcpMiningConfiguration } from '../src/temporal/utils/icpMiningConfiguration';
import { shouldScheduleWorkflow } from '../src/temporal/utils/activityOptIn';

describe('ICP mining controls', () => {
  it('keeps legacy defaults without needing outreach or channel configuration', () => {
    expect(resolveIcpMiningConfiguration({})).toEqual({ targetLeads: 150, researchEnabled: false, allLists: true, listIds: [] });
  });
  it.each([undefined, 'active', 'inactive', 'default'])('always schedules with legacy status %s', status => {
    expect(shouldScheduleWorkflow({ settings: { activities: {
      icp_lead_generation: { status }, leads_follow_up: { status: 'inactive' },
    } } }, 'icp_lead_generation')).toBe(true);
  });
  it('loads site controls and supports explicit workflow overrides including false', () => {
    const settings = { activities: { icp_lead_generation: { target_leads: 25, research_enabled: true } } };
    expect(resolveIcpMiningConfiguration(settings)).toEqual({ targetLeads: 25, researchEnabled: true, allLists: true, listIds: [] });
    expect(resolveIcpMiningConfiguration(settings, { targetLeadsWithEmail: 7, researchEnabled: false }))
      .toEqual({ targetLeads: 7, researchEnabled: false, allLists: true, listIds: [] });
  });
  it.each([0, -1, 1.5, 3001, '25', NaN, Infinity, null])('rejects malformed target %s', target => {
    expect(() => resolveIcpMiningConfiguration({ activities: { icp_lead_generation: { target_leads: target } } })).toThrow();
  });
  it('rejects malformed research flags rather than spending implicitly', () => {
    expect(() => resolveIcpMiningConfiguration({ activities: { icp_lead_generation: { research_enabled: 'true' } } })).toThrow();
  });
  const id = 'abcdef12-3456-7890-abcd-ef1234567890';
  it('normalizes selected lists while keeping the existing target and research settings', () => {
    expect(resolveIcpMiningConfiguration({ activities: { icp_lead_generation: {
      target_leads: 25, research_enabled: true, all_lists: false, list_ids: [id.toUpperCase(), id],
    } } })).toEqual({ targetLeads: 25, researchEnabled: true, allLists: false, listIds: [id] });
  });
  it('preserves an explicit empty selection without falling back to all', () => {
    expect(resolveIcpMiningConfiguration({ activities: { icp_lead_generation: { all_lists: false } } }))
      .toMatchObject({ allLists: false, listIds: [] });
  });
  it.each([null, 'false', 0])('rejects malformed all_lists %s', all_lists => {
    expect(() => resolveIcpMiningConfiguration({ activities: { icp_lead_generation: { all_lists } } })).toThrow('all_lists');
  });
  it.each([null, id, [1], ['not-uuid'], [` ${id}`], Array(1001).fill(id)])('rejects malformed or oversized list selections', list_ids => {
    expect(() => resolveIcpMiningConfiguration({ activities: { icp_lead_generation: { list_ids } } })).toThrow('list_ids');
  });
});