const mockClient = { from: jest.fn() };
const mockSave = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));
jest.mock('../src/temporal/services/supabase-impl/icpMiningScheduledStatus', () => ({
  saveIcpMiningScheduledStatus: mockSave,
}));

import { saveIcpMiningScheduledStatusActivity } from '../src/temporal/activities/icpMiningScheduledStatusActivity';
import { SupabaseService } from '../src/temporal/services/supabaseService';

const update = { siteId: 'site', workflowId: 'timer', scheduleId: 'timer', nextRun: '2026-10-01T12:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(SupabaseService.prototype, 'getConnectionStatus').mockResolvedValue(true);
  mockSave.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('ICP scheduled status activity/service wiring', () => {
  it('uses the existing service client and dedicated method, never the generic upsert', async () => {
    const genericUpsert = jest.spyOn(SupabaseService.prototype, 'batchUpsertCronStatus');
    await expect(saveIcpMiningScheduledStatusActivity(update)).resolves.toBeUndefined();
    expect(SupabaseService.prototype.getConnectionStatus).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(mockClient, update);
    expect(genericUpsert).not.toHaveBeenCalled();
  });

  it('propagates persistence errors so the scheduler can report failure', async () => {
    const error = new Error('conditional write failed');
    mockSave.mockRejectedValue(error);
    await expect(saveIcpMiningScheduledStatusActivity(update)).rejects.toBe(error);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('fails safely when the existing service connection check fails', async () => {
    jest.mocked(SupabaseService.prototype.getConnectionStatus).mockResolvedValue(false);
    await expect(saveIcpMiningScheduledStatusActivity(update)).rejects.toThrow('Database not connected');
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});