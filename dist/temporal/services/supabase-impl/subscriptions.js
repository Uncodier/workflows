"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDueSubscriptions = fetchDueSubscriptions;
exports.updateSubscriptionNextBilling = updateSubscriptionNextBilling;
exports.generateSubscriptionSale = generateSubscriptionSale;
exports.generateSubscriptionPurchase = generateSubscriptionPurchase;
const crypto_1 = require("crypto");
async function fetchDueSubscriptions(client) {
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
async function updateSubscriptionNextBilling(client, subscriptionId, newNextBillingDate) {
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
async function generateSubscriptionSale(client, saleData, saleOrderData) {
    console.log('📝 Generating sale for subscription...');
    // Start a transaction-like process (or insert sequence)
    const { data: sale, error: saleError } = await client
        .from('sales')
        .insert(saleData)
        .select()
        .single();
    if (saleError) {
        console.error('❌ Error generating sale:', saleError);
        throw new Error(`Failed to generate sale: ${saleError.message}`);
    }
    if (saleOrderData) {
        saleOrderData.sale_id = sale.id;
        // Generate public access token for the Sale Order
        if (!saleOrderData.public_access_token) {
            saleOrderData.public_access_token = (0, crypto_1.randomBytes)(24).toString('base64url');
        }
        const { data: order, error: orderError } = await client
            .from('sale_orders')
            .insert(saleOrderData)
            .select('id, public_access_token')
            .single();
        if (orderError) {
            console.error('❌ Error generating sale_order:', orderError);
            throw new Error(`Failed to generate sale order: ${orderError.message}`);
        }
        // Attach order details to sale result for further use
        sale.sale_order = order;
    }
    return sale;
}
async function generateSubscriptionPurchase(client, purchaseData, purchaseItemData) {
    console.log('📝 Generating purchase for subscription...');
    // Generate public access token for the Purchase (Vendor Bill)
    if (!purchaseData.public_access_token) {
        purchaseData.public_access_token = (0, crypto_1.randomBytes)(24).toString('base64url');
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
