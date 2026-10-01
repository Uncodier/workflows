const mockStart = jest.fn();
const mockFetchSites = jest.fn();
const mockFetchSettings = jest.fn();
const mockSaveCron = jest.fn();
jest.mock('../src/temporal/client', () => ({ getTemporalClient: async () => ({ workflow: { start: mockStart } }) }));
jest.mock('../src/config/config', () => ({ temporalConfig: { taskQueue: 'test' } }));
jest.mock('../src/temporal/services', () => ({}));
jest.mock('../src/temporal/activities/cronActivities', () => ({ saveCronStatusActivity: mockSaveCron }));
jest.mock('../src/temporal/activities/supabaseActivities', () => ({}));
jest.mock('../src/temporal/activities/outreachConfigurationActivity', () => ({ getOutreachConfigurationActivity: jest.fn() }));
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: () => ({
  fetchSites: mockFetchSites, fetchCompleteSettings: mockFetchSettings,
}) }));
import { scheduleIndividualLeadGenerationActivity } from '../src/temporal/activities/workflowSchedulingActivities';

describe('always-on ICP scheduling', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T15:00:00Z'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockFetchSites.mockResolvedValue([{ id: 'site', user_id: 'user', name: 'Test' }]);
    mockFetchSettings.mockResolvedValue([{ site_id: 'site', activities: {
      icp_lead_generation: { status: 'inactive', target_leads: 25, research_enabled: true },
      local_lead_generation: { status: 'inactive' }, leads_follow_up: { status: 'inactive' },
      leads_initial_cold_outreach: { status: 'inactive' }, daily_resume_and_stand_up: { status: 'inactive' },
    } }]);
    mockStart.mockResolvedValue({ workflowId: 'scheduled' });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  it('schedules mining with no channels while every outreach/generation toggle is off', async () => {
    const result = await scheduleIndividualLeadGenerationActivity({ openSites: [] });
    expect(result.failed).toBe(0);
    expect(result.scheduled).toBe(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][1].args[0]).toMatchObject({
      targetWorkflow: 'idealClientProfileMiningWorkflow', targetArgs: [{ site_id: 'site', userId: 'user' }],
    });
    // Controls are loaded at execution, not snapshotted when tomorrow's timer is created.
    const timer = mockStart.mock.calls[0][1];
    const miningArgs = timer.args[0].targetArgs[0];
    for (const key of ['targetLeadsWithEmail', 'researchEnabled', 'icp_mining_id', 'allLists', 'listIds']) {
      expect(miningArgs).not.toHaveProperty(key);
    }
    expect(miningArgs.scheduleId).toBe(timer.workflowId);
    expect(mockSaveCron).toHaveBeenCalledWith(expect.objectContaining({ activityName: 'idealClientProfileMiningWorkflow' }));
  });
});