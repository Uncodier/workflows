import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

export interface Subscription {
  id: string;
  site_id: string;
  lead_id?: string;
  catalog_item_id?: string;
  status: string;
  start_date: string;
  next_billing_date: string;
  due_date?: string | null;
  amount: number;
  buyer_user_id?: string;
  owner_site_id?: string;
  end_date?: string;
}

export async function fetchDueSubscriptions(client: SupabaseClient): Promise<Subscription[]> {
  console.log('🔍 Fetching due subscriptions...');
  
  const now = new Date().toISOString();

  const { data, error } = await client
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .lte('next_billing_date', now);

  if (error) {
    console.error('❌ Error fetching due subscriptions:', error);
    throw new Error(`Failed to fetch due subscriptions: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} due subscriptions`);
  return data || [];
}

export async function updateSubscriptionNextBilling(
  client: SupabaseClient,
  subscriptionId: string,
  newNextBillingDate: string,
  nextDueDate?: string
): Promise<void> {
  const { error } = await client
    .from('subscriptions')
    .update({ 
      next_billing_date: newNextBillingDate,
      ...(nextDueDate ? { due_date: nextDueDate } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('id', subscriptionId);

  if (error) {
    console.error(`❌ Error updating subscription ${subscriptionId}:`, error);
    throw new Error(`Failed to update subscription next billing date: ${error.message}`);
  }
}

export async function resolveSubscriptionUserId(
  client: SupabaseClient,
  sub: Subscription
): Promise<string> {
  if (sub.lead_id) {
    const { data: lead, error } = await client
      .from('leads')
      .select('assignee_id')
      .eq('id', sub.lead_id)
      .eq('site_id', sub.site_id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch subscription lead assignee: ${error.message}`);
    }
    if (lead?.assignee_id) return lead.assignee_id;
  }

  const { data: site, error } = await client
    .from('sites')
    .select('user_id')
    .eq('id', sub.site_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch subscription site owner: ${error.message}`);
  }
  if (!site?.user_id) {
    throw new Error(`No lead assignee or site owner available for subscription ${sub.id}`);
  }
  return site.user_id;
}

export function subscriptionRenewalRecordId(sub: Subscription, kind: 'sale' | 'order'): string {
  const cycle = new Date(sub.next_billing_date).toISOString();
  // UUIDv5 under the standard URL namespace, compatible with existing UUID validators.
  const bytes = createHash('sha1')
    .update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex'))
    .update(JSON.stringify(['subscription-renewal-v1', kind, sub.site_id, sub.id, cycle]))
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nextSubscriptionBillingDate(current: string): string {
  const date = new Date(current);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid subscription next billing date');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function subscriptionInvoiceMetadata(sub: Subscription) {
  return {
    subscription_id: sub.id,
    billing_cycle: new Date(sub.next_billing_date).toISOString(),
    billing_period_start: new Date(sub.next_billing_date).toISOString().slice(0, 10),
    billing_period_end: nextSubscriptionBillingDate(sub.next_billing_date).slice(0, 10),
  };
}

export interface SubscriptionInvoiceRecord {
  id: string;
  amount: number;
  currency: string;
  due_date?: string | null;
  channel?: string | null;
  public_access_token?: string;
}

/** Explicit period metadata wins over the issue date; legacy invoices use the cycle's date range. */
export async function findSubscriptionPeriodInvoice(
  client: SupabaseClient,
  sub: Subscription
): Promise<SubscriptionInvoiceRecord | null> {
  const period = subscriptionInvoiceMetadata(sub);
  const query = () => client.from('sales')
    .select('id, amount, currency, due_date, channel, public_access_token')
    .eq('site_id', sub.site_id)
    .eq('subscription_id', sub.id);
  const candidates = [
    () => query().eq('product_details->>billing_period_start', period.billing_period_start),
    () => query().is('product_details->>billing_period_start', null)
      .like('product_details->>billing_cycle', `${period.billing_period_start}%`),
    () => query().is('product_details->>billing_period_start', null)
      .is('product_details->>billing_cycle', null)
      .gte('sale_date', period.billing_period_start).lt('sale_date', period.billing_period_end),
  ];
  for (const candidate of candidates) {
    const { data, error } = await candidate()
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (error) throw new Error(`Failed to find subscription period invoice: ${error.message}`);
    // All statuses represent an issued invoice. Never silently replace a paid,
    // cancelled or refunded invoice or overwrite its financial state.
    if (data) return data;
  }
  return null;
}

export interface SubscriptionSaleData {
  id: string;
  site_id: string;
  user_id: string;
  subscription_id: string;
  lead_id?: string;
  buyer_user_id?: string;
  owner_site_id?: string;
  amount: number;
  amount_due: number;
  currency: string;
  status: 'pending';
  title: string;
  sale_date: string;
  due_date?: string;
  product_details: ReturnType<typeof subscriptionInvoiceMetadata>;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionSaleOrderData {
  id: string;
  site_id: string;
  user_id: string;
  order_number: string;
  buyer_user_id?: string;
  owner_site_id?: string;
  subtotal: number;
  total: number;
  currency: string;
  status: 'pending';
  items: { catalog_item_id?: string; quantity: number; unit_price: number }[];
  public_access_token?: string;
}

interface SubscriptionRecord {
  id: string;
  public_access_token?: string;
  amount?: number;
  currency?: string;
  due_date?: string | null;
  channel?: string | null;
  subscription_id?: string;
  sale_id?: string;
  product_details?: { billing_period_start?: string; billing_cycle?: string } | null;
}

// Primary-key uniqueness is the concurrency guard; never upsert financial data.
async function getOrCreateSubscriptionRecord(
  client: SupabaseClient,
  table: 'sales' | 'sale_orders',
  payload: SubscriptionSaleData | (SubscriptionSaleOrderData & { sale_id: string })
): Promise<SubscriptionRecord> {
  const columns = table === 'sales'
    ? 'id, public_access_token, amount, currency, due_date, channel, subscription_id, product_details'
    : 'id, public_access_token, sale_id';
  const validate = (record: SubscriptionRecord): SubscriptionRecord => {
    if ('subscription_id' in payload) {
      const details = record.product_details;
      const period = payload.product_details.billing_period_start;
      if (record.subscription_id !== payload.subscription_id
        || (details?.billing_period_start != null && details.billing_period_start !== period)
        || (details?.billing_period_start == null && details?.billing_cycle != null
          && details.billing_cycle.slice(0, 10) !== period)) {
        throw new Error('Existing subscription invoice identity does not match its subscription or billing period');
      }
    } else if (record.sale_id !== payload.sale_id) {
      throw new Error('Existing subscription order is linked to a different invoice');
    }
    return record;
  };
  const find = () => client.from(table).select(columns)
    .eq('id', payload.id)
    .eq('site_id', payload.site_id)
    .maybeSingle<SubscriptionRecord>();

  const existing = await find();
  if (existing.error) {
    throw new Error(`Failed to find subscription ${table}: ${existing.error.message}`);
  }
  if (existing.data) return validate(existing.data);

  const inserted = await client.from(table).insert(payload).select(columns).single<SubscriptionRecord>();
  if (!inserted.error && inserted.data) return inserted.data;

  if (inserted.error?.code === '23505') {
    const concurrent = await find();
    if (concurrent.error) {
      throw new Error(`Failed to find concurrent subscription ${table}: ${concurrent.error.message}`);
    }
    if (concurrent.data) return validate(concurrent.data);
  }
  throw new Error(`Failed to generate subscription ${table}: ${inserted.error?.message || 'No record returned'}`);
}

export async function generateSubscriptionSale(
  client: SupabaseClient,
  saleData: SubscriptionSaleData,
  saleOrderData: SubscriptionSaleOrderData
): Promise<SubscriptionRecord & { sale_order?: SubscriptionRecord; existing_invoice?: boolean }> {
  console.log('📝 Generating sale for subscription...');

  const sale = await getOrCreateSubscriptionRecord(client, 'sales', saleData);
  // The manual period action shares this UUID. If it wins the insert race,
  // leave its invoice alone rather than creating a new order or notification.
  if (sale.channel === 'manual') return { ...sale, existing_invoice: true };
  const amount = Number(sale.amount ?? saleData.amount);
  const currency = sale.currency || saleData.currency;
  const order = await getOrCreateSubscriptionRecord(client, 'sale_orders', {
    ...saleOrderData,
    subtotal: amount,
    total: amount,
    currency,
    items: saleOrderData.items.map((item) => ({ ...item, unit_price: amount })),
    sale_id: sale.id,
    public_access_token: saleOrderData.public_access_token || randomBytes(24).toString('base64url'),
  });
  return { ...sale, sale_order: order };
}

export async function generateSubscriptionPurchase(
  client: SupabaseClient,
  purchaseData: any,
  purchaseItemData: any
): Promise<any> {
  console.log('📝 Generating purchase for subscription...');

  // Generate public access token for the Purchase (Vendor Bill)
  if (!purchaseData.public_access_token) {
    purchaseData.public_access_token = randomBytes(24).toString('base64url');
  }

  const { data: purchase, error: purchaseError } = await client
    .from('purchases')
    .insert(purchaseData)
    .select()
    .single();

  if (purchaseError) {
    console.error('❌ Error generating purchase:', purchaseError);
    throw new Error(`Failed to generate purchase: ${purchaseError.message}`);
  }

  if (purchaseItemData) {
    purchaseItemData.purchase_id = purchase.id;
    const { error: itemError } = await client
      .from('purchase_items')
      .insert(purchaseItemData);

    if (itemError) {
      console.error('❌ Error generating purchase_item:', itemError);
      throw new Error(`Failed to generate purchase item: ${itemError.message}`);
    }
  }

  return purchase;
}
