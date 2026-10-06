const mockActivities = {
  fetchDueSubscriptionsActivity: jest.fn(),
  fetchSubscriptionContactsActivity: jest.fn(),
  processSubscriptionRenewalActivity: jest.fn(),
  notifySubscriptionRenewalActivity: jest.fn(),
};
const mockPatched = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities,
  patched: (name: string) => mockPatched(name),
  ApplicationFailure: jest.requireActual('@temporalio/common').ApplicationFailure,
}));

import { processSubscriptionsWorkflow } from '../src/temporal/workflows/processSubscriptionsWorkflow';

describe('subscription renewal orchestration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPatched.mockReturnValue(true);
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([]);
    mockActivities.fetchSubscriptionContactsActivity.mockResolvedValue({});
    mockActivities.processSubscriptionRenewalActivity.mockResolvedValue({ sale_id: 'sale' });
    mockActivities.notifySubscriptionRenewalActivity.mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns an empty successful batch without creating records or sending notifications', async () => {
    await expect(processSubscriptionsWorkflow()).resolves.toEqual({ processed: 0, errors: 0 });
    expect(mockActivities.processSubscriptionRenewalActivity).not.toHaveBeenCalled();
    expect(mockActivities.notifySubscriptionRenewalActivity).not.toHaveBeenCalled();
  });

  it('passes the renewal and batch contact into the notification', async () => {
    const sub = { id: 'subscription' };
    const contact = { email: 'customer@example.test', name: 'Customer', language: 'es-MX' };
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([sub]);
    mockActivities.fetchSubscriptionContactsActivity.mockResolvedValue({ subscription: contact });
    await expect(processSubscriptionsWorkflow()).resolves.toEqual({ processed: 1, errors: 0 });
    expect(mockActivities.notifySubscriptionRenewalActivity).toHaveBeenCalledWith({
      sub, renewalData: { sale_id: 'sale' }, contact,
    });
  });

  it('processes later subscriptions and reports a real Temporal failure after renewal errors', async () => {
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
    mockActivities.processSubscriptionRenewalActivity
      .mockRejectedValueOnce(new Error('Insert failed')).mockResolvedValueOnce({ sale_id: 'sale' });
    await expect(processSubscriptionsWorkflow()).rejects.toMatchObject({
      type: 'SUBSCRIPTION_RENEWALS_FAILED', nonRetryable: true, details: [{ processed: 1, errors: 1 }],
    });
    expect(mockActivities.processSubscriptionRenewalActivity).toHaveBeenCalledTimes(2);
    expect(mockActivities.notifySubscriptionRenewalActivity).toHaveBeenCalledTimes(1);
  });

  it('reports notification failure without retrying invoice creation in the workflow', async () => {
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([{ id: 'subscription' }]);
    mockActivities.notifySubscriptionRenewalActivity.mockRejectedValue(new Error('Email failed'));
    await expect(processSubscriptionsWorkflow()).rejects.toMatchObject({
      type: 'SUBSCRIPTION_RENEWALS_FAILED', details: [{ processed: 0, errors: 1 }],
    });
    expect(mockActivities.processSubscriptionRenewalActivity).toHaveBeenCalledTimes(1);
  });

  it('falls back to individual contacts on batch lookup errors', async () => {
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([{ id: 'subscription' }]);
    mockActivities.fetchSubscriptionContactsActivity.mockRejectedValue(new Error('Contact lookup failed'));
    await expect(processSubscriptionsWorkflow()).resolves.toEqual({ processed: 1, errors: 0 });
    expect(mockActivities.notifySubscriptionRenewalActivity.mock.calls[0][0].contact).toBeUndefined();
  });

  it('preserves historical completion behavior when replaying without the failure patch', async () => {
    mockPatched.mockImplementation((name) => name === 'subscription-renewals-batch-contacts-v1');
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([{ id: 'subscription' }]);
    mockActivities.processSubscriptionRenewalActivity.mockRejectedValue(new Error('Legacy failure'));
    await expect(processSubscriptionsWorkflow()).resolves.toEqual({ processed: 0, errors: 1 });
  });

  it('preserves the old notification arguments without the contact patch', async () => {
    mockPatched.mockReturnValue(false);
    const sub = { id: 'subscription' };
    mockActivities.fetchDueSubscriptionsActivity.mockResolvedValue([sub]);
    await processSubscriptionsWorkflow();
    expect(mockActivities.fetchSubscriptionContactsActivity).not.toHaveBeenCalled();
    expect(mockActivities.notifySubscriptionRenewalActivity).toHaveBeenCalledWith({ sub, renewalData: { sale_id: 'sale' } });
  });

  it('propagates discovery failures rather than marking an empty batch successful', async () => {
    mockActivities.fetchDueSubscriptionsActivity.mockRejectedValue(new Error('Discovery failed'));
    await expect(processSubscriptionsWorkflow()).rejects.toThrow('Discovery failed');
  });
});