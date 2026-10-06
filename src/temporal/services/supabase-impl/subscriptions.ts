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
  newNextBillingDate: string
): Promise<void> {
  const { error } = await client
    .from('subscriptions')
    .update({ 
      next_billing_date: newNextBillingDate,
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
  product_details: { subscription_id: string; billing_cycle: string };
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
}

// Primary-key uniqueness is the concurrency guard; never upsert financial data.
async function getOrCreateSubscriptionRecord(
  client: SupabaseClient,
  table: 'sales' | 'sale_orders',
  payload: SubscriptionSaleData | (SubscriptionSaleOrderData & { sale_id: string })
): Promise<SubscriptionRecord> {
  const find = () => client.from(table)
    .select('id, public_access_token')
    .eq('id', payload.id)
    .eq('site_id', payload.site_id)
    .maybeSingle();

  const existing = await find();
  if (existing.error) {
    throw new Error(`Failed to find subscription ${table}: ${existing.error.message}`);
  }
  if (existing.data) return existing.data;

  const inserted = await client.from(table).insert(payload)
    .select('id, public_access_token').single();
  if (!inserted.error && inserted.data) return inserted.data;

  if (inserted.error?.code === '23505') {
    const concurrent = await find();
    if (concurrent.error) {
      throw new Error(`Failed to find concurrent subscription ${table}: ${concurrent.error.message}`);
    }
    if (concurrent.data) return concurrent.data;
  }
  throw new Error(`Failed to generate subscription ${table}: ${inserted.error?.message || 'No record returned'}`);
}

export async function generateSubscriptionSale(
  client: SupabaseClient,
  saleData: SubscriptionSaleData,
  saleOrderData: SubscriptionSaleOrderData
): Promise<SubscriptionRecord & { sale_order: SubscriptionRecord }> {
  console.log('📝 Generating sale for subscription...');

  const sale = await getOrCreateSubscriptionRecord(client, 'sales', saleData);
  const order = await getOrCreateSubscriptionRecord(client, 'sale_orders', {
    ...saleOrderData,
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
