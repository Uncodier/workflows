"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDueSubscriptionsActivity = fetchDueSubscriptionsActivity;
exports.processSubscriptionRenewalActivity = processSubscriptionRenewalActivity;
exports.notifySubscriptionRenewalActivity = notifySubscriptionRenewalActivity;
const supabaseService_1 = require("../services/supabaseService");
const apiService_1 = require("../services/apiService");
const subscriptions_1 = require("../services/supabase-impl/subscriptions");
async function fetchDueSubscriptionsActivity() {
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    return (0, subscriptions_1.fetchDueSubscriptions)(supabase);
}
async function processSubscriptionRenewalActivity(sub) {
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    const currentNext = new Date(sub.next_billing_date);
    currentNext.setMonth(currentNext.getMonth() + 1);
    const nextBillingStr = currentNext.toISOString();
    const saleData = {
        site_id: sub.site_id,
        amount: sub.amount,
        currency: 'USD',
        status: 'completed',
        title: 'Subscription Renewal',
        sale_date: new Date().toISOString(),
        buyer_user_id: sub.buyer_user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    let tokenToReturn;
    // We are generating sale_order, so we also need to generate the public token there or get it back
    const saleOrderData = {
        site_id: sub.site_id,
        subtotal: sub.amount,
        total: sub.amount,
        status: 'completed',
        buyer_user_id: sub.buyer_user_id,
        items: [{
                catalog_item_id: sub.catalog_item_id,
                quantity: 1,
                unit_price: sub.amount
            }]
    };
    const sale = await (0, subscriptions_1.generateSubscriptionSale)(supabase, saleData, saleOrderData);
    // extract token
    tokenToReturn = sale.sale_order?.public_access_token;
    await (0, subscriptions_1.updateSubscriptionNextBilling)(supabase, sub.id, nextBillingStr);
    return {
        sale_id: sale.id,
        amount: sub.amount,
        currency: 'USD',
        next_billing_date: nextBillingStr,
        public_access_token: tokenToReturn
    };
}
async function notifySubscriptionRenewalActivity(params) {
    const { sub, renewalData } = params;
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    let userEmail = null;
    let userName = 'Customer';
    let userLang = 'es-MX';
    if (sub.buyer_user_id) {
        const { data: profile } = await supabase.from('profiles').select('email, name').eq('id', sub.buyer_user_id).maybeSingle();
        if (profile?.email) {
            userEmail = profile.email;
            if (profile.name)
                userName = profile.name;
        }
    }
    else if (sub.lead_id) {
        const { data: lead } = await supabase.from('leads').select('email, name, language').eq('id', sub.lead_id).maybeSingle();
        if (lead?.email) {
            userEmail = lead.email;
            if (lead.name)
                userName = lead.name;
            if (lead.language)
                userLang = lead.language;
        }
    }
    if (userEmail) {
        const currentNext = new Date(renewalData.next_billing_date);
        let markdownMessage = `
# Recibo de Suscripción

Hola ${userName},

Tu suscripción ha sido renovada exitosamente.

**Detalles de la transacción:**
- **Fecha:** ${new Date().toLocaleDateString(userLang)}
- **Monto Total:** $${renewalData.amount} ${renewalData.currency}
- **Número de Orden:** ${renewalData.sale_id}
- **Próximo Cobro:** ${currentNext.toLocaleDateString(userLang)}
`.trim();
        if (renewalData.public_access_token) {
            markdownMessage += `\n\n[Ver Detalles de la Orden de Compra (SO)](https://makinari.com/so/${renewalData.public_access_token})`;
        }
        markdownMessage += `\n\nGracias por tu preferencia. Si tienes alguna duda, responde a este correo.`;
        const locale = userLang.startsWith('es') ? 'es' : 'en';
        const response = await apiService_1.apiService.post('/api/notifications/subscriptionRenewal', {
            email: userEmail,
            subject: 'Recibo de Renovación de Suscripción',
            message: markdownMessage,
            site_id: sub.site_id,
            locale: locale
        });
        if (!response.success) {
            throw new Error(`Failed to send receipt to ${userEmail}: ${response.error?.message}`);
        }
    }
}
