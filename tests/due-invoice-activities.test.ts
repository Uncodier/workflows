const mockService = { fetchSites: jest.fn(), fetchCompleteSettings: jest.fn(), getClient: jest.fn() };
const mockPost = jest.fn();
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: () => mockService }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: (...args: unknown[]) => mockPost(...args) } }));
import { fetchDueInvoicePageActivity, fetchDueInvoiceSitesActivity, remindDueInvoiceActivity } from '../src/temporal/activities/dueInvoiceActivities';

const settings = {
  site_id: 'site', business_hours: { timezone: 'UTC' },
  channels: { email: { status: 'active', email: 'billing@example.test' } },
  activities: { invoices_due: { status: 'active', channel_accounts: { email: ['email'] } } },
};
describe('due invoice activities', () => {
  let query: Record<string, jest.Mock>;
  beforeEach(() => {
    jest.resetAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-10-06T16:00:00Z'));
    mockService.fetchSites.mockResolvedValue([{ id: 'site' }, { id: 'archived', archived_at: '2026-01-01' }, { id: 'off' }]);
    mockService.fetchCompleteSettings.mockResolvedValue([settings]);
    query = Object.fromEntries(['select', 'eq', 'gt', 'lte', 'or', 'order', 'limit'].map(key => [key, jest.fn()]));
    for (const method of Object.values(query)) method.mockImplementation(() => query);
    query.limit.mockResolvedValue({ data: [{ id: 'sale', site_id: 'site', due_date: '2026-10-01' }], error: null });
    mockService.getClient.mockReturnValue({ from: jest.fn(() => query) });
  });
  afterEach(() => jest.useRealTimers());
  it('selects only opt-in nonarchived tenants from fresh settings', async () => {
    await expect(fetchDueInvoiceSitesActivity()).resolves.toEqual(['site']);
    expect(mockService.fetchCompleteSettings).toHaveBeenCalledWith(['site', 'off']);
  });
  it('does not query sales when configuration becomes inactive', async () => {
    mockService.fetchCompleteSettings.mockResolvedValue([{ ...settings, activities: {} }]);
    await expect(fetchDueInvoicePageActivity({ site_id: 'site' })).resolves.toEqual({ invoices: [], hasMore: false });
    expect(mockService.getClient).not.toHaveBeenCalled();
  });
  it('scopes unpaid due sales to the tenant and local calendar day', async () => {
    await expect(fetchDueInvoicePageActivity({ site_id: 'site' })).resolves.toMatchObject({
      localDate: '2026-10-06', hasMore: false, invoices: [{ id: 'sale' }],
    });
    expect(query.eq).toHaveBeenCalledWith('site_id', 'site');
    expect(query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(query.gt).toHaveBeenCalledWith('amount_due', 0);
    expect(query.lte).toHaveBeenCalledWith('due_date', '2026-10-06');
  });
  it('validates cursor values before interpolating filters', async () => {
    await expect(fetchDueInvoicePageActivity({ site_id: 'site', cursor: { due_date: '2026-10-01', id: 'bad),status.eq.completed' } }))
      .rejects.toThrow('Invalid due invoice cursor');
    expect(query.or).not.toHaveBeenCalled();
  });
  it('propagates financial lookup failures', async () => {
    query.limit.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    await expect(fetchDueInvoicePageActivity({ site_id: 'site' })).rejects.toThrow('Unavailable');
  });
  it('passes the stable claim key to the real API contract and fails on unconfirmed results', async () => {
    const params = { site_id: 'site', sale_id: 'sale', reminder_key: 'invoice-due:sale:2026-10-06' };
    mockPost.mockResolvedValue({ success: true, data: { success: true, skipped: true } });
    await expect(remindDueInvoiceActivity(params)).resolves.toEqual({ success: true, skipped: true });
    expect(mockPost).toHaveBeenCalledWith('/api/agents/sales/dueInvoices', { ...params, outreach_activity: 'invoices_due' });
    mockPost.mockResolvedValue({ success: false, error: { message: 'Unconfirmed' } });
    await expect(remindDueInvoiceActivity(params)).rejects.toThrow('Unconfirmed');
  });
});