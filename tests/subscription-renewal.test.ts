import type { SupabaseClient } from '@supabase/supabase-js';
import { notifySubscriptionRenewalActivity, processSubscriptionRenewalActivity } from '../src/temporal/activities/subscriptionActivities';
import { apiService } from '../src/temporal/services/apiService';
import { getSupabaseService, type SupabaseService } from '../src/temporal/services/supabaseService';
import {
  nextSubscriptionBillingDate,
  subscriptionRenewalRecordId,
  subscriptionInvoiceMetadata,
  type Subscription,
} from '../src/temporal/services/supabase-impl/subscriptions';

jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: jest.fn() }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: jest.fn() } }));

const subscription: Subscription = {
  id: '673bbd23-13a5-4ba7-91a1-5ab2338832a3',
  site_id: '90af1cc6-5a65-48fa-9412-68348b505357',
  lead_id: '225d447c-8f96-46cb-85de-61dd204303a3',
  catalog_item_id: 'cfa2c103-3dff-4dbc-911e-6bb6e04923b6',
  status: 'active', amount: 1500,
  start_date: '2026-09-22T19:23:26.414192Z',
  next_billing_date: '2026-10-01T00:00:00Z',
};

type Row = Record<string, any>;
type DatabaseError = { message: string; code?: string };

// A local PostgREST test double enforcing the confirmed required fields and PKs.
function database() {
  const rows: Record<string, Row[]> = {
    leads: [{ id: subscription.lead_id, site_id: subscription.site_id, assignee_id: 'assigned-user' }],
    sites: [{ id: subscription.site_id, user_id: 'site-owner' }],
    subscriptions: [{ ...subscription }], sales: [], sale_orders: [],
  };
  const failures: Record<string, DatabaseError | undefined> = {};
  const lostResponses = new Set<string>();
  const beforeInsert: Record<string, (() => void) | undefined> = {};
  const operations: { table: string; action: string; payload?: Row; filters: Row }[] = [];
  const client = {
    from: jest.fn((table: string) => {
      let action = 'read';
      let payload: Row | undefined;
      const filters: Row = {};
      const predicates: ((row: Row) => boolean)[] = [];
      const valueAt = (row: Row, key: string) => {
        const [column, property] = key.split('->>');
        return property ? row[column]?.[property] ?? null : row[column];
      };
      const execute = async () => {
        operations.push({ table, action, payload, filters: { ...filters } });
        const failure = failures[`${action}:${table}`];
        if (failure) {
          delete failures[`${action}:${table}`];
          return { data: null, error: failure };
        }
        const matches = (row: Row) => Object.entries(filters).every(([key, value]) => valueAt(row, key) === value)
          && predicates.every((predicate) => predicate(row));
        if (action === 'read') return { data: rows[table].find(matches) || null, error: null };
        if (action === 'update') {
          for (const row of rows[table].filter(matches)) Object.assign(row, payload);
          return { data: null, error: null };
        }
        const required = table === 'sales'
          ? ['id', 'amount', 'status', 'title', 'sale_date', 'site_id', 'user_id']
          : ['id', 'sale_id', 'order_number', 'site_id', 'user_id'];
        for (const field of required) {
          if (payload?.[field] == null) {
            return { data: null, error: { code: '23502', message: `Missing required ${table}.${field}` } };
          }
        }
        beforeInsert[table]?.();
        delete beforeInsert[table];
        if (rows[table].some((row) => row.id === payload?.id)) {
          return { data: null, error: { code: '23505', message: 'Duplicate primary key' } };
        }
        rows[table].push({ ...payload });
        if (lostResponses.delete(table)) throw new Error('Response lost after commit');
        return { data: { ...payload }, error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        is: (key: string, value: unknown) => { predicates.push((row) => valueAt(row, key) === value); return query; },
        like: (key: string, value: string) => {
          predicates.push((row) => typeof valueAt(row, key) === 'string' && valueAt(row, key).startsWith(value.slice(0, -1)));
          return query;
        },
        gte: (key: string, value: string) => { predicates.push((row) => valueAt(row, key) >= value); return query; },
        lt: (key: string, value: string) => { predicates.push((row) => valueAt(row, key) < value); return query; },
        order: () => query,
        limit: () => query,
        insert: (value: Row) => { action = 'insert'; payload = value; return query; },
        update: (value: Row) => { action = 'update'; payload = value; return query; },
        maybeSingle: execute,
        single: execute,
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject),
      };
      return query;
    }),
  } as unknown as SupabaseClient;
  return { rows, failures, lostResponses, beforeInsert, operations, client };
}

describe('subscription invoice renewals', () => {
  let db: ReturnType<typeof database>;
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T19:00:00Z'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db = database();
    jest.mocked(getSupabaseService).mockReturnValue({ getClient: () => db.client } as unknown as SupabaseService);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('uses the lead assignee for both records and links the invoice to its subscription/customer', async () => {
    const result = await processSubscriptionRenewalActivity(subscription);
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(1);
    expect(db.rows.sales[0]).toMatchObject({
      user_id: 'assigned-user', subscription_id: subscription.id, lead_id: subscription.lead_id,
      amount: 1500, amount_due: 1500, currency: 'USD', status: 'pending', sale_date: '2026-10-06',
      product_details: { subscription_id: subscription.id, billing_cycle: '2026-10-01T00:00:00.000Z',
        billing_period_start: '2026-10-01', billing_period_end: '2026-11-01' },
    });
    expect(db.rows.sale_orders[0]).toMatchObject({
      user_id: 'assigned-user', sale_id: result.sale_id, currency: 'USD',
      order_number: `SO-SUB-${result.sale_id.toUpperCase()}`,
      items: [{ catalog_item_id: subscription.catalog_item_id, quantity: 1, unit_price: 1500 }],
    });
    expect(result.public_access_token).toMatch(/^[\w-]{32}$/);
    expect(db.rows.subscriptions[0].next_billing_date).toBe('2026-11-01T00:00:00.000Z');
    expect(db.operations.some((op) => op.table === 'sites')).toBe(false);
  });

  it.each(['unassigned', 'missing', 'no-lead', 'other-site'])('uses site owner for a %s lead, never the buyer', async (scenario) => {
    if (scenario === 'unassigned') db.rows.leads[0].assignee_id = null;
    if (scenario === 'missing') db.rows.leads = [];
    if (scenario === 'other-site') db.rows.leads[0].site_id = 'other-tenant';
    await processSubscriptionRenewalActivity({
      ...subscription, buyer_user_id: 'customer-user',
      lead_id: scenario === 'no-lead' ? undefined : subscription.lead_id,
    });
    expect(db.rows.sales[0].user_id).toBe('site-owner');
    expect(db.rows.sale_orders[0].user_id).toBe('site-owner');
    expect(db.rows.sales[0].buyer_user_id).toBe('customer-user');
  });

  it('preserves buyer and owner-site references', async () => {
    await processSubscriptionRenewalActivity({ ...subscription, buyer_user_id: 'buyer', owner_site_id: 'owner-site' });
    for (const table of ['sales', 'sale_orders']) {
      expect(db.rows[table][0]).toMatchObject({ buyer_user_id: 'buyer', owner_site_id: 'owner-site' });
    }
  });

  it.each(['leads', 'sites'])('does not write financial records if the %s lookup fails', async (table) => {
    db.rows.leads[0].assignee_id = null;
    db.failures[`read:${table}`] = { message: 'Database unavailable' };
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Database unavailable');
    expect(db.rows.sales).toHaveLength(0);
    expect(db.rows.sale_orders).toHaveLength(0);
  });

  it('fails before inserting when neither assignee nor owner exists', async () => {
    db.rows.leads[0].assignee_id = null;
    db.rows.sites[0].user_id = null;
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('No lead assignee or site owner');
    expect(db.rows.sales).toHaveLength(0);
  });

  it.each(['insert:sales', 'insert:sale_orders', 'update:subscriptions'])(
    'recovers from %s failure without duplicating invoices or advancing the date early', async (operation) => {
      db.failures[operation] = { message: 'Temporary failure' };
      await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Temporary failure');
      expect(db.rows.subscriptions[0].next_billing_date).toBe(subscription.next_billing_date);
      await processSubscriptionRenewalActivity(subscription);
      expect(db.rows.sales).toHaveLength(1);
      expect(db.rows.sale_orders).toHaveLength(1);
      expect(db.rows.subscriptions[0].next_billing_date).toBe('2026-11-01T00:00:00.000Z');
    }
  );

  it.each(['sales', 'sale_orders'])('reuses committed %s after its response is lost', async (table) => {
    db.lostResponses.add(table);
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Response lost after commit');
    await processSubscriptionRenewalActivity(subscription);
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(1);
  });

  it('reuses existing records and public token without overwriting payment state', async () => {
    const first = await processSubscriptionRenewalActivity(subscription);
    db.rows.sales[0].status = 'completed';
    db.rows.sales[0].amount_due = 0;
    const second = await processSubscriptionRenewalActivity(subscription);
    expect(second).toEqual(first);
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sales[0]).toMatchObject({ status: 'completed', amount_due: 0 });
    expect(db.rows.sale_orders).toHaveLength(1);
  });

  it('recovers concurrent primary-key conflicts for the same cycle', async () => {
    const results = await Promise.all([
      processSubscriptionRenewalActivity(subscription), processSubscriptionRenewalActivity(subscription),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(1);
  });

  it('fails closed on existing invoice lookup errors', async () => {
    db.failures['read:sales'] = { message: 'Lookup unavailable' };
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Lookup unavailable');
    expect(db.rows.sales).toHaveLength(0);
  });

  it.each(['pending', 'completed', 'cancelled', 'refunded'])('reuses a %s manual invoice issued on a different date', async (status) => {
    const invoice = {
      id: 'manually-created-invoice', site_id: subscription.site_id, subscription_id: subscription.id,
      status, amount: 950, amount_due: status === 'completed' ? 0 : 950,
      currency: 'MXN', sale_date: '2026-09-29', due_date: '2026-10-15', channel: 'manual',
      product_details: subscriptionInvoiceMetadata(subscription),
    };
    db.rows.sales.push(invoice);
    const original = JSON.stringify(db.rows.sales);
    db.rows.leads = [];
    db.rows.sites = [];
    const result = await processSubscriptionRenewalActivity({ ...subscription, due_date: '2026-10-11' });
    expect(result).toEqual({
      sale_id: invoice.id, amount: 950, currency: 'MXN', due_date: '2026-10-15',
      next_billing_date: '2026-11-01T00:00:00.000Z', existing_invoice: true,
    });
    expect(JSON.stringify(db.rows.sales)).toBe(original);
    expect(db.rows.sale_orders).toHaveLength(0);
    expect(db.rows.subscriptions[0]).toMatchObject({ next_billing_date: result.next_billing_date, due_date: '2026-11-11' });
    expect(db.operations.filter((operation) => operation.action === 'insert')).toHaveLength(0);
  });

  it.each(['2026-10-01', '2026-10-06', '2026-10-31'])('recognizes a legacy manual invoice without period metadata issued on %s', async (saleDate) => {
    db.rows.sales.push({
      id: 'legacy-manual', site_id: subscription.site_id, subscription_id: subscription.id,
      sale_date: saleDate, amount: 1500, currency: 'USD', status: 'pending',
    });
    const result = await processSubscriptionRenewalActivity(subscription);
    expect(result).toMatchObject({ sale_id: 'legacy-manual', existing_invoice: true });
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(0);
  });

  it('recognizes the existing billing_cycle metadata even if the issue date is outside the period', async () => {
    db.rows.sales.push({
      id: 'old-generator', site_id: subscription.site_id, subscription_id: subscription.id,
      sale_date: '2026-11-06', amount: 1500, currency: 'USD', status: 'pending',
      product_details: { subscription_id: subscription.id, billing_cycle: '2026-10-01T00:00:00.000Z' },
    });
    expect(await processSubscriptionRenewalActivity(subscription)).toMatchObject({ sale_id: 'old-generator', existing_invoice: true });
    expect(db.rows.sales).toHaveLength(1);
  });

  it.each(['other-site', 'other-subscription', 'previous-date', 'next-date', 'other-cycle', 'other-period'])
    ('does not suppress renewal because of an invoice for %s', async (scenario) => {
      const invoice: Row = {
        id: 'unrelated-invoice', site_id: subscription.site_id, subscription_id: subscription.id,
        sale_date: '2026-10-06', amount: 1500, currency: 'USD', status: 'pending',
      };
      if (scenario === 'other-site') invoice.site_id = 'other-tenant';
      if (scenario === 'other-subscription') invoice.subscription_id = 'another-subscription';
      if (scenario === 'previous-date') invoice.sale_date = '2026-09-30';
      if (scenario === 'next-date') invoice.sale_date = '2026-11-01';
      if (scenario === 'other-cycle') invoice.product_details = { billing_cycle: '2026-09-01T00:00:00.000Z' };
      if (scenario === 'other-period') invoice.product_details = { billing_period_start: '2026-09-01' };
      db.rows.sales.push(invoice);
      const result = await processSubscriptionRenewalActivity(subscription);
      expect(result.sale_id).toBe(subscriptionRenewalRecordId(subscription, 'sale'));
      expect(result.existing_invoice).toBeUndefined();
      expect(db.rows.sales).toHaveLength(2);
      expect(db.rows.sale_orders).toHaveLength(1);
    });

  it('does not resend a new-invoice notification for a reused invoice', async () => {
    await notifySubscriptionRenewalActivity({
      sub: subscription,
      renewalData: { sale_id: 'manual', amount: 1500, currency: 'USD', next_billing_date: '2026-11-01', existing_invoice: true },
      contact: { email: 'customer@example.test', name: 'Customer', language: 'es-MX' },
    });
    expect(apiService.post).not.toHaveBeenCalled();
    expect(db.operations).toHaveLength(0);
  });

  it('reuses the manual period invoice when the manual generator wins a shared-UUID insert race', async () => {
    db.beforeInsert.sales = () => db.rows.sales.push({
      id: subscriptionRenewalRecordId(subscription, 'sale'), site_id: subscription.site_id,
      subscription_id: subscription.id, amount: 975, currency: 'MXN', status: 'pending',
      due_date: '2026-10-18', channel: 'manual', product_details: subscriptionInvoiceMetadata(subscription),
    });
    const result = await processSubscriptionRenewalActivity(subscription);
    expect(result).toMatchObject({ amount: 975, currency: 'MXN', due_date: '2026-10-18', existing_invoice: true });
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(0);
    expect(db.rows.subscriptions[0].next_billing_date).toBe(result.next_billing_date);
  });

  it.each(['other-subscription', 'other-period'])('fails closed if a deterministic invoice ID was reassigned to %s', async (scenario) => {
    db.rows.sales.push({
      id: subscriptionRenewalRecordId(subscription, 'sale'), site_id: subscription.site_id,
      subscription_id: scenario === 'other-subscription' ? 'other-subscription' : subscription.id,
      amount: 1500, currency: 'USD', channel: 'manual', sale_date: '2026-09-01',
      product_details: { billing_period_start: scenario === 'other-period' ? '2026-09-01' : '2026-10-01' },
    });
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('does not match');
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(0);
    expect(db.rows.subscriptions[0].next_billing_date).toBe(subscription.next_billing_date);
  });

  it('does not reuse a deterministic order ID reassigned to another invoice', async () => {
    db.rows.sale_orders.push({ id: subscriptionRenewalRecordId(subscription, 'order'), site_id: subscription.site_id, sale_id: 'other-invoice' });
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('linked to a different invoice');
    expect(db.rows.subscriptions[0].next_billing_date).toBe(subscription.next_billing_date);
    expect(db.rows.sale_orders).toHaveLength(1);
  });

  it('recovers a missing order using the persisted invoice amount and currency, not changed subscription terms', async () => {
    db.rows.sales.push({
      id: subscriptionRenewalRecordId(subscription, 'sale'), site_id: subscription.site_id,
      subscription_id: subscription.id, amount: 950, currency: 'MXN', status: 'pending',
      product_details: subscriptionInvoiceMetadata(subscription),
    });
    const result = await processSubscriptionRenewalActivity({ ...subscription, amount: 2500 });
    expect(result).toMatchObject({ amount: 950, currency: 'MXN' });
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders[0]).toMatchObject({
      subtotal: 950, total: 950, currency: 'MXN', sale_id: result.sale_id,
      items: [{ catalog_item_id: subscription.catalog_item_id, quantity: 1, unit_price: 950 }],
    });
  });

  it('retries billing advancement without duplicating a preexisting manual invoice', async () => {
    db.rows.sales.push({
      id: 'manual', site_id: subscription.site_id, subscription_id: subscription.id,
      sale_date: '2026-10-06', amount: 1500, currency: 'USD', status: 'pending',
    });
    db.failures['update:subscriptions'] = { message: 'Billing update unavailable' };
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Billing update unavailable');
    expect(db.rows.subscriptions[0].next_billing_date).toBe(subscription.next_billing_date);
    expect(await processSubscriptionRenewalActivity(subscription)).toMatchObject({ sale_id: 'manual', existing_invoice: true });
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(0);
  });

  it('checks a non-calendar monthly period with an exclusive clamped end date', async () => {
    const sub = { ...subscription, next_billing_date: '2026-01-31T18:00:00Z' };
    expect(subscriptionInvoiceMetadata(sub)).toMatchObject({ billing_period_start: '2026-01-31', billing_period_end: '2026-02-28' });
    db.rows.sales.push({
      id: 'manual-february', site_id: subscription.site_id, subscription_id: subscription.id,
      sale_date: '2026-02-10', amount: 1500, currency: 'USD', status: 'pending',
    });
    expect(await processSubscriptionRenewalActivity(sub)).toMatchObject({ sale_id: 'manual-february', existing_invoice: true });
  });

  it('fails closed on order lookup errors and resumes the same invoice on retry', async () => {
    db.failures['read:sale_orders'] = { message: 'Order lookup unavailable' };
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Order lookup unavailable');
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(0);
    expect(db.rows.subscriptions[0].next_billing_date).toBe(subscription.next_billing_date);
    await processSubscriptionRenewalActivity(subscription);
    expect(db.rows.sales).toHaveLength(1);
    expect(db.rows.sale_orders).toHaveLength(1);
  });

  it('does not treat an unrelated unique conflict as a completed invoice', async () => {
    db.failures['insert:sales'] = { code: '23505', message: 'Unrelated unique conflict' };
    await expect(processSubscriptionRenewalActivity(subscription)).rejects.toThrow('Unrelated unique conflict');
    expect(db.rows.sale_orders).toHaveLength(0);
    expect(db.rows.subscriptions[0].next_billing_date).toBe(subscription.next_billing_date);
  });

  it('creates a new invoice only for the next billing cycle', async () => {
    const first = await processSubscriptionRenewalActivity(subscription);
    const nextCycle = { ...subscription, next_billing_date: first.next_billing_date };
    const second = await processSubscriptionRenewalActivity(nextCycle);
    expect(second.sale_id).not.toBe(first.sale_id);
    expect(second.next_billing_date).toBe('2026-12-01T00:00:00.000Z');
    expect(db.rows.sales).toHaveLength(2);
    expect(db.rows.sale_orders).toHaveLength(2);
  });

  it('creates distinct stable UUIDv5 keys per tenant, subscription, cycle and record kind', () => {
    const id = subscriptionRenewalRecordId(subscription, 'sale');
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(subscriptionRenewalRecordId({ ...subscription, next_billing_date: '2026-09-30T18:00:00-06:00' }, 'sale')).toBe(id);
    const ids = [id, subscriptionRenewalRecordId(subscription, 'order'),
      subscriptionRenewalRecordId({ ...subscription, site_id: 'other-site' }, 'sale'),
      subscriptionRenewalRecordId({ ...subscription, id: 'other-subscription' }, 'sale'),
      subscriptionRenewalRecordId({ ...subscription, next_billing_date: '2026-11-01T00:00:00Z' }, 'sale')];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ['2026-01-31T12:34:56Z', '2026-02-28T12:34:56.000Z'],
    ['2028-01-31T12:34:56Z', '2028-02-29T12:34:56.000Z'],
    ['2026-12-31T00:00:00Z', '2027-01-31T00:00:00.000Z'],
  ])('advances %s by one valid UTC month', (current, next) => {
    expect(nextSubscriptionBillingDate(current)).toBe(next);
  });

  it('rejects invalid billing dates before any writes', async () => {
    await expect(processSubscriptionRenewalActivity({ ...subscription, next_billing_date: 'invalid' }))
      .rejects.toThrow('Invalid subscription next billing date');
    expect(db.operations).toHaveLength(0);
  });

  it('copies the current due date to the invoice and advances subscription net terms with the billing date', async () => {
    const result = await processSubscriptionRenewalActivity({ ...subscription, due_date: '2026-10-11' });
    expect(db.rows.sales[0].due_date).toBe('2026-10-11');
    expect(db.rows.subscriptions[0]).toMatchObject({ next_billing_date: '2026-11-01T00:00:00.000Z', due_date: '2026-11-11' });
    expect(result.due_date).toBe('2026-10-11');
  });

  it('preserves the due date on failed invoice generation and rejects invalid dates before writes', async () => {
    await expect(processSubscriptionRenewalActivity({ ...subscription, due_date: '2026-02-30' }))
      .rejects.toThrow('Invalid invoice due date');
    expect(db.operations).toHaveLength(0);
    db.rows.subscriptions[0].due_date = '2026-10-11';
    db.failures['insert:sale_orders'] = { message: 'Order unavailable' };
    await expect(processSubscriptionRenewalActivity({ ...subscription, due_date: '2026-10-11' }))
      .rejects.toThrow('Order unavailable');
    expect(db.rows.subscriptions[0].due_date).toBe('2026-10-11');
  });
});