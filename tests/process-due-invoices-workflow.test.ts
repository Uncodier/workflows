const mockActivities = {
  fetchDueInvoiceSitesActivity: jest.fn(),
  fetchDueInvoicePageActivity: jest.fn(),
  remindDueInvoiceActivity: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities,
  ApplicationFailure: jest.requireActual('@temporalio/common').ApplicationFailure,
}));
import { processDueInvoicesWorkflow } from '../src/temporal/workflows/processDueInvoicesWorkflow';

describe('due invoice orchestration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockActivities.fetchDueInvoiceSitesActivity.mockResolvedValue(['site']);
    mockActivities.fetchDueInvoicePageActivity.mockResolvedValue({ invoices: [], hasMore: false });
    mockActivities.remindDueInvoiceActivity.mockResolvedValue({ success: true });
  });
  afterEach(() => jest.restoreAllMocks());
  it('does not contact anything without an opted-in site', async () => {
    mockActivities.fetchDueInvoiceSitesActivity.mockResolvedValue([]);
    await expect(processDueInvoicesWorkflow()).resolves.toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(mockActivities.remindDueInvoiceActivity).not.toHaveBeenCalled();
  });
  it('uses stable invoice/day keys and continues to the next page after skipped intervals', async () => {
    const cursor = { id: 'sale-one', due_date: '2026-10-01' };
    mockActivities.fetchDueInvoicePageActivity
      .mockResolvedValueOnce({ invoices: [{ id: 'sale-one' }], localDate: '2026-10-06', hasMore: true, nextCursor: cursor })
      .mockResolvedValueOnce({ invoices: [{ id: 'sale-two' }], localDate: '2026-10-06', hasMore: false });
    mockActivities.remindDueInvoiceActivity.mockResolvedValueOnce({ success: true, skipped: true });
    await expect(processDueInvoicesWorkflow()).resolves.toEqual({ processed: 1, skipped: 1, errors: 0 });
    expect(mockActivities.fetchDueInvoicePageActivity).toHaveBeenLastCalledWith({ site_id: 'site', cursor });
    expect(mockActivities.remindDueInvoiceActivity).toHaveBeenCalledWith({
      site_id: 'site', sale_id: 'sale-two', reminder_key: 'invoice-due:sale-two:2026-10-06',
    });
  });
  it('continues later invoices and surfaces failure without replaying ambiguous contacts', async () => {
    mockActivities.fetchDueInvoicePageActivity.mockResolvedValue({
      invoices: [{ id: 'bad' }, { id: 'good' }], localDate: '2026-10-06', hasMore: false,
    });
    mockActivities.remindDueInvoiceActivity.mockRejectedValueOnce(new Error('Provider timeout'));
    await expect(processDueInvoicesWorkflow()).rejects.toMatchObject({
      type: 'DUE_INVOICE_REMINDERS_FAILED', nonRetryable: true, details: [{ processed: 1, skipped: 0, errors: 1 }],
    });
    expect(mockActivities.remindDueInvoiceActivity).toHaveBeenCalledTimes(2);
  });
  it('fails closed on discovery errors', async () => {
    mockActivities.fetchDueInvoiceSitesActivity.mockRejectedValue(new Error('Settings unavailable'));
    await expect(processDueInvoicesWorkflow()).rejects.toThrow('Settings unavailable');
  });
});