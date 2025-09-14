"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookDispatchWorkflow = webhookDispatchWorkflow;
const workflow_1 = require("@temporalio/workflow");
const activities = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 1, // We handle retries inside delivery activity
    },
});
const { getActiveWebhookEndpointsActivity, getActiveWebhookSubscriptionsActivity, fetchRecordByTableAndIdActivity, deliverToWebhookEndpointActivity, } = activities;
async function webhookDispatchWorkflow(input) {
    const { site_id, table, event_type, object_id, event, subscription_ids } = input;
    console.log(`🔔 WebhookDispatchWorkflow start: site=${site_id} event=${event_type} table=${table} id=${object_id}`);
    // 1) Get all active endpoints for the site
    const endpoints = await getActiveWebhookEndpointsActivity(site_id);
    console.log(`📡 Endpoints found: ${endpoints.length}`);
    if (endpoints.length > 0) {
        console.log('📡 Endpoints detail:', endpoints.map(e => ({ id: e.id, is_active: e.is_active, handshake_status: e.handshake_status })));
    }
    // 2) Get subscriptions for event type
    const normalizedEvent = (event || `${table}.${event_type}`).toLowerCase();
    const altEvent = normalizedEvent.replace(/s\./, '.'); // tasks.created -> task.created
    const subscriptions = await getActiveWebhookSubscriptionsActivity({
        site_id,
        event_types: Array.from(new Set([normalizedEvent, altEvent])),
        subscription_ids,
    });
    console.log(`🧾 Subscriptions found: ${subscriptions.length}`);
    if (subscriptions.length > 0) {
        console.log('🧾 Subscription endpoint_ids:', subscriptions.map(s => s.endpoint_id));
    }
    if (endpoints.length === 0 || subscriptions.length === 0) {
        if (endpoints.length === 0) {
            console.log('⛔ No active endpoints matched for site. Skipping delivery.');
        }
        if (subscriptions.length === 0) {
            console.log('⛔ No active subscriptions matched for event. Skipping delivery.');
        }
        return { success: true, delivered: 0, attempted: 0, skipped: endpoints.length, deliveries: [] };
    }
    // Map endpoint_id -> subscription
    const endpointIdToSubscription = new Map();
    for (const sub of subscriptions) {
        endpointIdToSubscription.set(sub.endpoint_id, { id: sub.id });
    }
    // 3) Fetch the object record
    const record = await fetchRecordByTableAndIdActivity({ table, id: object_id });
    // 4) Deliver to all endpoints that have a subscription
    const targetEndpoints = endpoints.filter((e) => endpointIdToSubscription.has(e.id));
    console.log(`🚚 Delivering to ${targetEndpoints.length} endpoints with active subscription for event`);
    if (targetEndpoints.length > 0) {
        console.log('🚚 Target endpoint_ids:', targetEndpoints.map(e => e.id));
    }
    const results = [];
    // deliver sequentially to keep logs tidy; could be parallelized if needed
    for (const endpoint of targetEndpoints) {
        const subscription = endpointIdToSubscription.get(endpoint.id) || null;
        const result = await deliverToWebhookEndpointActivity({
            site_id,
            endpoint,
            subscription: subscription ? { id: subscription.id } : null,
            event_type,
            event: normalizedEvent,
            table,
            object_id,
            record,
        });
        results.push({
            endpoint_id: endpoint.id,
            delivered: result.delivered,
            attempts: result.attempts,
            delivery_id: result.delivery_id,
            status: result.responseStatus,
        });
    }
    const deliveredCount = results.filter(r => r.delivered).length;
    return {
        success: true,
        delivered: deliveredCount,
        attempted: results.length,
        skipped: endpoints.length - targetEndpoints.length,
        deliveries: results,
    };
}
