import { getSupabaseService } from '../services/supabaseService';
import { apiService } from '../services/apiService';
import { 
  fetchDueSubscriptions, 
  generateSubscriptionSale, 
  generateSubscriptionPurchase,
  updateSubscriptionNextBilling,
  Subscription
} from '../services/supabase-impl/subscriptions';

export async function fetchDueSubscriptionsActivity(): Promise<Subscription[]> {
  const supabase = getSupabaseService().getClient();
  return fetchDueSubscriptions(supabase);
}

export interface SubscriptionContact {
  email: string | null;
  name: string;
  language: string;
}

export async function fetchSubscriptionContactsActivity(
  subscriptions: Subscription[]
): Promise<Record<string, SubscriptionContact>> {
  const supabase = getSupabaseService().getClient();
  const buyerIds = [...new Set(
    subscriptions.map((subscription) => subscription.buyer_user_id).filter(Boolean)
  )] as string[];
  const leadIds = [...new Set(
    subscriptions.map((subscription) => subscription.lead_id).filter(Boolean)
  )] as string[];

  const [profileResult, leadResult] = await Promise.all([
    buyerIds.length > 0
      ? supabase.from('profiles').select('id, email, name').in('id', buyerIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? supabase.from('leads').select('id, email, name, language').in('id', leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profileResult.error || leadResult.error) {
    const error = profileResult.error || leadResult.error;
    throw new Error(`Failed to fetch subscription contacts: ${error?.message}`);
  }

  const profiles = new Map((profileResult.data || []).map((row) => [row.id, row]));
  const leads = new Map((leadResult.data || []).map((row) => [row.id, row]));
  const result: Record<string, SubscriptionContact> = {};

  for (const subscription of subscriptions) {
    const profile = subscription.buyer_user_id
      ? profiles.get(subscription.buyer_user_id)
      : undefined;
    const lead = subscription.lead_id
      ? leads.get(subscription.lead_id)
      : undefined;

    result[subscription.id] = profile
      ? {
          email: profile.email || null,
          name: profile.name || 'Customer',
          language: 'es-MX',
        }
      : {
          email: lead?.email || null,
          name: lead?.name || 'Customer',
          language: lead?.language || 'es-MX',
        };
  }

  return result;
}

export interface ProcessSubscriptionRenewalResult {
  sale_id: string;
  amount: number;
  currency: string;
  next_billing_date: string;
  public_access_token?: string;
}

export async function processSubscriptionRenewalActivity(sub: Subscription): Promise<ProcessSubscriptionRenewalResult> {
  const supabase = getSupabaseService().getClient();
  
  const currentNext = new Date(sub.next_billing_date);
  currentNext.setMonth(currentNext.getMonth() + 1);
  const nextBillingStr = currentNext.toISOString();

  const saleData: any = {
    site_id: sub.site_id,
    amount: sub.amount,
    amount_due: sub.amount,
    currency: 'USD',
    status: 'pending',
    title: 'Subscription Renewal',
    sale_date: new Date().toISOString(),
    buyer_user_id: sub.buyer_user_id,
    product_details: { subscription_id: sub.id },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let tokenToReturn: string | undefined;

  // We are generating sale_order, so we also need to generate the public token there or get it back
  const saleOrderData = {
    site_id: sub.site_id,
    subtotal: sub.amount,
    total: sub.amount,
    status: 'pending',
    buyer_user_id: sub.buyer_user_id,
    items: [{
      catalog_item_id: sub.catalog_item_id,
      quantity: 1,
      unit_price: sub.amount
    }]
  };

  const sale = await generateSubscriptionSale(supabase, saleData, saleOrderData);
  
  // extract token
  tokenToReturn = sale.sale_order?.public_access_token;

  await updateSubscriptionNextBilling(supabase, sub.id, nextBillingStr);

  return {
    sale_id: sale.id,
    amount: sub.amount,
    currency: 'USD',
    next_billing_date: nextBillingStr,
    public_access_token: tokenToReturn
  };
}

export interface NotifySubscriptionRenewalParams {
  sub: Subscription;
  renewalData: ProcessSubscriptionRenewalResult;
  contact?: SubscriptionContact;
}

export async function notifySubscriptionRenewalActivity(params: NotifySubscriptionRenewalParams): Promise<void> {
  const { sub, renewalData } = params;
  const supabase = getSupabaseService().getClient();

  let userEmail = params.contact?.email || null;
  let userName = params.contact?.name || 'Customer';
  let userLang = params.contact?.language || 'es-MX';

  if (!params.contact && sub.buyer_user_id) {
    const { data: profile } = await supabase.from('profiles').select('email, name').eq('id', sub.buyer_user_id).maybeSingle();
    if (profile?.email) {
      userEmail = profile.email;
      if (profile.name) userName = profile.name;
    }
  } else if (!params.contact && sub.lead_id) {
    const { data: lead } = await supabase.from('leads').select('email, name, language').eq('id', sub.lead_id).maybeSingle();
    if (lead?.email) {
      userEmail = lead.email;
      if (lead.name) userName = lead.name;
      if (lead.language) userLang = lead.language;
    }
  }

  if (userEmail) {
    const currentNext = new Date(renewalData.next_billing_date);
    
    let markdownMessage = `
# Aviso de Cobro de Suscripción

Hola ${userName},

Tienes una nueva orden de pago pendiente para la renovación de tu suscripción.

**Detalles de la transacción:**
- **Fecha:** ${new Date().toLocaleDateString(userLang)}
- **Monto a Pagar:** $${renewalData.amount} ${renewalData.currency}
- **Número de Orden:** ${renewalData.sale_id}
- **Siguiente Cobro Programado:** ${currentNext.toLocaleDateString(userLang)}
`.trim();

    if (renewalData.public_access_token) {
      markdownMessage += `\n\n[Ver Detalles de la Orden de Compra (SO)](https://makinari.com/so/${renewalData.public_access_token})`;
    }

    markdownMessage += `\n\nGracias por tu preferencia. Si tienes alguna duda, responde a este correo.`;

    const locale = userLang.startsWith('es') ? 'es' : 'en';

    const response = await apiService.post('/api/notifications/subscriptionRenewal', {
      email: userEmail,
      subject: 'Aviso de Cobro de Suscripción',
      message: markdownMessage,
      site_id: sub.site_id,
      locale: locale
    });

    if (!response.success) {
      throw new Error(`Failed to send receipt to ${userEmail}: ${response.error?.message}`);
    }
  }
}
