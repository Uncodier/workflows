const mockPatched = jest.fn();
const mockWorkflowInfo = jest.fn();
const mockActivities = {
  logWorkflowExecutionActivity: jest.fn(),
  saveCronStatusActivity: jest.fn(),
  getRoleQueryByIdActivity: jest.fn(),
  validateCommunicationChannelsActivity: jest.fn(),
  callPersonRoleSearchActivity: jest.fn(),
  getSegmentIdFromRoleQueryActivity: jest.fn(),
  validateAndCleanStuckCronStatusActivity: jest.fn(),
  getSiteActivity: jest.fn(),
  callRegionSearchApiActivity: jest.fn(),
  validateWorkflowConfigActivity: jest.fn(),
  getPendingIcpMiningActivity: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: () => mockActivities,
  patched: mockPatched,
  workflowInfo: mockWorkflowInfo,
  upsertSearchAttributes: jest.fn(),
}));

import { idealClientProfilePageSearchWorkflow } from '../src/temporal/workflows/idealClientProfilePageSearchWorkflow';
import { leadGenerationDomainSearchWorkflow } from '../src/temporal/workflows/leadGenerationDomainSearchWorkflow';
import { leadGenerationWorkflow } from '../src/temporal/workflows/leadGenerationWorkflow';
import { idealClientProfileMiningWorkflow } from '../src/temporal/workflows/idealClientProfileMiningWorkflow';

describe('outbound health boundary before billable search', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPatched.mockReturnValue(true);
    mockWorkflowInfo.mockReturnValue({ workflowId: 'health-test', startTime: new Date() });
    mockActivities.validateCommunicationChannelsActivity.mockResolvedValue({ success: true, hasAnyChannel: false });
    mockActivities.getRoleQueryByIdActivity.mockResolvedValue({ success: true, roleQuery: { query: {} } });
    mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({
      canProceed: true, wasStuck: false, reason: 'ok',
    });
    mockActivities.validateWorkflowConfigActivity.mockResolvedValue({ shouldExecute: true, reason: 'ok' });
    mockActivities.callPersonRoleSearchActivity.mockResolvedValue({ success: true, hasMore: false });
  });

  afterEach(() => jest.restoreAllMocks());

  it('blocks a direct ICP page before Finder when no outbound channel is healthy', async () => {
    const result = await idealClientProfilePageSearchWorkflow({
      role_query_id: 'query-1', page: 0, page_size: 20, site_id: 'site-1', userId: 'user-1',
    });
    expect(result).toMatchObject({ success: false, processed: 0 });
    expect(mockActivities.validateCommunicationChannelsActivity).toHaveBeenCalledWith({
      site_id: 'site-1', requireHealthyOutbound: true,
    });
    expect(mockActivities.callPersonRoleSearchActivity).not.toHaveBeenCalled();
  });

  it('blocks a direct domain page before Finder', async () => {
    const result = await leadGenerationDomainSearchWorkflow({
      domains: ['example.invalid'], page: 0, page_size: 20, site_id: 'site-1', userId: 'user-1',
    });
    expect(result).toMatchObject({ success: false, processed: 0 });
    expect(mockActivities.callPersonRoleSearchActivity).not.toHaveBeenCalled();
  });

  it('blocks lead generation before region search credits are spent', async () => {
    const result = await leadGenerationWorkflow({ site_id: 'site-1' });
    expect(result).toMatchObject({ success: false, siteId: 'site-1' });
    expect(mockActivities.callRegionSearchApiActivity).not.toHaveBeenCalled();
    expect(mockActivities.getSiteActivity).not.toHaveBeenCalled();
  });

  it('blocks ICP mining before fetching pending work', async () => {
    const result = await idealClientProfileMiningWorkflow({ site_id: 'site-1', userId: 'user-1' });
    expect(result).toMatchObject({ success: false, processed: 0 });
    expect(mockActivities.getPendingIcpMiningActivity).not.toHaveBeenCalled();
  });

  it('preserves the legacy page command sequence when the patch is absent', async () => {
    mockPatched.mockReturnValue(false);
    const result = await idealClientProfilePageSearchWorkflow({
      role_query_id: 'query-1', page: 0, page_size: 20, site_id: 'site-1', userId: 'user-1',
    });
    expect(mockPatched).toHaveBeenCalledWith('icp-page-outbound-health-gate-v1');
    expect(mockActivities.validateCommunicationChannelsActivity).not.toHaveBeenCalled();
    expect(mockActivities.callPersonRoleSearchActivity).toHaveBeenCalledTimes(1);
    expect(result.hasMore).toBe(false);
  });
});