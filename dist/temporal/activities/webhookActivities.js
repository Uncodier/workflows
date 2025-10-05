"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveWebhookEndpointsActivity = getActiveWebhookEndpointsActivity;
exports.getActiveWebhookSubscriptionsActivity = getActiveWebhookSubscriptionsActivity;
exports.fetchRecordByTableAndIdActivity = fetchRecordByTableAndIdActivity;
exports.deliverToWebhookEndpointActivity = deliverToWebhookEndpointActivity;
const crypto_1 = __importDefault(require("crypto"));
function toPastTense(eventType) {
    const t = eventType.toLowerCase();
    if (t === 'create' || t === 'created' || t === 'insert')
        return 'created';
    if (t === 'update' || t === 'updated' || t === 'modify')
        return 'updated';
    if (t === 'delete' || t === 'deleted' || t === 'remove')
        return 'deleted';
    return t;
}
function singularize(noun) {
    const n = noun.toLowerCase();
    if (n.endsWith('ies'))
        return n.slice(0, -3) + 'y';
    if (n.endsWith('ses'))
        return n.slice(0, -2); // classes -> classe (best-effort)
    if (n.endsWith('s'))
        return n.slice(0, -1);
    return n;
}
function buildEventName(table, eventType) {
    const past = toPastTense(eventType);
    return `${singularize(table)}.${past}`;
}
function signPayload(secret, payload) {
    if (!secret)
        return null;
    try {
        return crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex');
    }
    catch {
        return null;
    }
}
/**
 * Get active webhook endpoints for a site
 */
async function getActiveWebhookEndpointsActivity(siteId) {
    const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
    const { data, error } = await supabaseServiceRole
        .from('webhooks_endpoints')
        .select('id, site_id, name, description, target_url, secret, is_active, handshake_status')
        .eq('site_id', siteId)
        .eq('is_active', true);
    if (error) {
        throw new Error(`Failed to fetch webhook endpoints: ${error.message}`);
    }
    // Allow endpoints even if handshake is pending during initial setup/testing
    const filtered = (data || []).filter((e) => {
        const status = (e.handshake_status || 'none').toLowerCase();
        return status === 'verified' || status === 'none' || status === 'pending';
    });
    return filtered;
}
/**
 * Get active webhook subscriptions for a site and event_type
 */
async function getActiveWebhookSubscriptionsActivity(params) {
    const { site_id, event_type, event_types, subscription_ids } = params;
    const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
    let query = supabaseServiceRole
        .from('webhooks_subscriptions')
        .select('id, site_id, endpoint_id, event_type, is_active')
        .eq('site_id', site_id)
        .eq('is_active', true);
    if (event_types && event_types.length > 0) {
        query = query.in('event_type', event_types);
    }
    else if (event_type) {
        query = query.eq('event_type', event_type);
    }
    if (subscription_ids && subscription_ids.length > 0) {
        query = query.in('id', subscription_ids);
    }
    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to fetch webhook subscriptions: ${error.message}`);
    }
    return (data || []);
}
/**
 * Generic fetch by table and id
 */
async function fetchRecordByTableAndIdActivity(request) {
    const { table, id } = request;
    const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
    const { data, error } = await supabaseServiceRole
        .from(table)
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        throw new Error(`Failed to fetch record from ${table} with id ${id}: ${error.message}`);
    }
    return data;
}
/**
 * Deliver payload to a single webhook endpoint with retries, recording delivery rows
 */
async function deliverToWebhookEndpointActivity(request) {
    const { site_id, endpoint, subscription, event_type, event, table, object_id, record, maxAttempts = 5, attemptDelaysMs = [1000, 3000, 10000, 30000, 60000], } = request;
    const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
    const deliveryId = crypto_1.default.randomUUID();
    const effectiveEvent = event || buildEventName(table, event_type);
    // Create delivery row as pending
    {
        const payloadPreview = { id: object_id, table, event, site_id };
        const { error: insertError } = await supabaseServiceRole
            .from('webhooks_deliveries')
            .insert({
            id: deliveryId,
            site_id,
            endpoint_id: endpoint.id,
            subscription_id: subscription?.id || null,
            event_type: effectiveEvent,
            payload: payloadPreview, // Full payload will be reconstructed on attempt
            status: 'pending',
            attempt_count: 0,
        });
        if (insertError) {
            throw new Error(`Failed to create delivery record: ${insertError.message}`);
        }
    }
    let attempts = 0;
    let lastStatus;
    let lastBody;
    while (attempts < maxAttempts) {
        attempts += 1;
        const payload = {
            id: deliveryId,
            type: effectiveEvent,
            site_id,
            table,
            object_id,
            data: record,
            attempt: attempts,
            timestamp: new Date().toISOString(),
        };
        const body = JSON.stringify(payload);
        const signature = signPayload(endpoint.secret, body);
        try {
            // First try GET
            const commonHeaders = {
                'X-Webhook-Event': effectiveEvent,
                'X-Webhook-Delivery': deliveryId,
                ...(signature ? { 'X-Webhook-Signature': signature } : {}),
            };
            let delivered = false;
            try {
                const url = new URL(endpoint.target_url);
                // Include minimal context as query params
                url.searchParams.set('delivery_id', deliveryId);
                url.searchParams.set('event', effectiveEvent);
                url.searchParams.set('site_id', site_id);
                url.searchParams.set('table', table);
                url.searchParams.set('object_id', object_id);
                const getRes = await fetch(url.toString(), {
                    method: 'GET',
                    headers: commonHeaders,
                });
                lastStatus = getRes.status;
                lastBody = await getRes.text();
                delivered = getRes.ok && getRes.status >= 200 && getRes.status < 300;
                if (delivered) {
                    const { error: updateError } = await supabaseServiceRole
                        .from('webhooks_deliveries')
                        .update({
                        attempt_count: attempts,
                        last_attempt_at: new Date().toISOString(),
                        response_status: lastStatus,
                        response_body: lastBody,
                        status: 'delivered',
                        delivered_at: new Date().toISOString(),
                    })
                        .eq('id', deliveryId);
                    if (updateError) {
                        console.error(`Failed to update delivery ${deliveryId}: ${updateError.message}`);
                    }
                    return { delivered: true, attempts, responseStatus: lastStatus, responseBody: lastBody, delivery_id: deliveryId };
                }
            }
            catch {
                // If GET URL is invalid or GET fails at network level, we'll fallback to POST
            }
            // Fallback to POST
            const postRes = await fetch(endpoint.target_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...commonHeaders,
                },
                body,
            });
            lastStatus = postRes.status;
            lastBody = await postRes.text();
            const deliveredPost = postRes.ok && postRes.status >= 200 && postRes.status < 300;
            const { error: updateError } = await supabaseServiceRole
                .from('webhooks_deliveries')
                .update({
                attempt_count: attempts,
                last_attempt_at: new Date().toISOString(),
                response_status: lastStatus,
                response_body: lastBody,
                status: deliveredPost ? 'delivered' : (attempts < maxAttempts ? 'retrying' : 'failed'),
                delivered_at: deliveredPost ? new Date().toISOString() : null,
            })
                .eq('id', deliveryId);
            if (updateError) {
                // Not fatal for delivery flow, but log it in console
                console.error(`Failed to update delivery ${deliveryId}: ${updateError.message}`);
            }
            if (deliveredPost) {
                return { delivered: true, attempts, responseStatus: lastStatus, responseBody: lastBody, delivery_id: deliveryId };
            }
        }
        catch (err) {
            lastStatus = undefined;
            lastBody = err instanceof Error ? err.message : String(err);
            const { error: updateError } = await supabaseServiceRole
                .from('webhooks_deliveries')
                .update({
                attempt_count: attempts,
                last_attempt_at: new Date().toISOString(),
                response_status: null,
                response_body: lastBody,
                status: attempts < maxAttempts ? 'retrying' : 'failed',
            })
                .eq('id', deliveryId);
            if (updateError) {
                console.error(`Failed to update delivery after exception ${deliveryId}: ${updateError.message}`);
            }
        }
        // Backoff before next attempt
        const delay = attemptDelaysMs[Math.min(attempts - 1, attemptDelaysMs.length - 1)];
        await new Promise((r) => setTimeout(r, delay));
    }
    return { delivered: false, attempts, responseStatus: lastStatus, responseBody: lastBody, delivery_id: deliveryId };
}
