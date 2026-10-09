const mockPost = jest.fn();
const rows: Record<string, any> = {};
let readError: string | undefined;
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {
  from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
    data: rows[table] ?? null, error: readError === table ? { message: 'database unavailable' } : null,
  }) }) }) }),
} }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: (...args: any[]) => mockPost(...args) } }));
import { checkIcpMiningCreditsActivity, warnIcpMiningCreditsActivity } from '../src/temporal/activities/icpMiningCreditActivities';

beforeEach(() => {
  jest.clearAllMocks(); readError = undefined;
  rows.billing = { credits_available: 10 };
  rows.sites = { user_id: 'owner' };
  rows.profiles = { email: 'owner@example.com' };
  mockPost.mockResolvedValue({ success: true });
});

it('checks the persisted site balance and blocks zero credits', async () => {
  expect(await checkIcpMiningCreditsActivity('site')).toBe(true);
  rows.billing.credits_available = 0;
  expect(await checkIcpMiningCreditsActivity('site')).toBe(false);
});

it('fails closed if the balance is missing or unreadable', async () => {
  rows.billing = null;
  await expect(checkIcpMiningCreditsActivity('site')).rejects.toThrow('ICP credits unavailable');
  readError = 'billing';
  await expect(checkIcpMiningCreditsActivity('site')).rejects.toThrow('database unavailable');
});

it('emails the site owner about the run, not any mined lead', async () => {
  await warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('/api/agents/tools/sendEmail', expect.objectContaining({
    site_id: 'site', email: 'owner@example.com', subject: expect.stringContaining('ICP Mining'),
    message: expect.stringContaining('run'),
  }));
  expect(mockPost.mock.calls[0][1]).not.toHaveProperty('lead_id');
});

it('does not email anyone if the owner cannot be resolved', async () => {
  rows.profiles = null;
  await expect(warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' })).rejects.toThrow('recipient unavailable');
  expect(mockPost).not.toHaveBeenCalled();
});