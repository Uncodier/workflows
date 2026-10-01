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
  getIcpMiningConfigurationActivity: jest.fn(),
  isIcpDispatcherEnabledActivity: jest.fn(),
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
    mockActivities.isIcpDispatcherEnabledActivity.mockResolvedValue(false);
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
    mockActivities.getIcpMiningConfigurationActivity.mockResolvedValue({ targetLeads: 150, researchEnabled: false });
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [] });
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows ICP pages independently of outbound health', async () => {
    const result = await idealClientProfilePageSearchWorkflow({
      role_query_id: 'query-1', page: 0, page_size: 20, site_id: 'site-1', userId: 'user-1',
    });
    expect(result).toMatchObject({ success: true, processed: 0 });
    expect(mockActivities.validateCommunicationChannelsActivity).not.toHaveBeenCalled();
    expect(mockActivities.callPersonRoleSearchActivity).toHaveBeenCalled();
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

  it('fetches pending ICP work independently of status and outbound health', async () => {
    const result = await idealClientProfileMiningWorkflow({ site_id: 'site-1', userId: 'user-1' });
    expect(result).toMatchObject({ success: true, processed: 0 });
    expect(mockActivities.getPendingIcpMiningActivity).toHaveBeenCalled();
    expect(mockActivities.validateWorkflowConfigActivity).not.toHaveBeenCalled();
    expect(mockActivities.validateCommunicationChannelsActivity).not.toHaveBeenCalled();
  });

  it('preserves the historical ICP outbound gate on pre-decoupling histories', async () => {
    mockPatched.mockImplementation((key: string) => key.endsWith('outbound-health-gate-v1'));
    const result = await idealClientProfileMiningWorkflow({ site_id: 'site-1', userId: 'user-1' });
    expect(result.success).toBe(false);
    expect(mockActivities.validateCommunicationChannelsActivity).toHaveBeenCalled();
    expect(mockActivities.getIcpMiningConfigurationActivity).not.toHaveBeenCalled();
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