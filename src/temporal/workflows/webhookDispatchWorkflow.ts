import { proxyActivities } from '@temporalio/workflow';
import { resolveWebhookEventNames } from './helpers/webhookEventName';
import { resolveWebhookRecord } from './helpers/webhookRecord';

interface WebhookDispatchInput {
  site_id: string;
  table: string; // collection/table name
  event_type: 'CREATE' | 'UPDATE' | 'DELETE' | string;
  object_id: string;
  event?: string; // explicit event name (e.g., tasks.created)
  record?: unknown; // DB webhook snapshot; required to deliver deleted records
  subscription_ids?: string[]; // limit to specific subscriptions
  // If true, run immediately on main task queue; otherwise normal background is also on queue.
  // Placeholder for future priority/queue overrides.
  force_queue?: boolean;
}

interface WebhookDispatchResult {
  success: boolean;
  delivered: number;
  attempted: number;
  skipped: number;
  deliveries: Array<{ endpoint_id: string; delivered: boolean; attempts: number; delivery_id: string; status?: number }>;
}

const activities = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 1, // We handle retries inside delivery activity
  },
});

type Activities = {
  getActiveWebhookEndpointsActivity: (siteId: string) => Promise<{
    id: string; site_id: string; target_url: string; secret?: string | null; is_active: boolean; handshake_status?: string | null;
  }[]>;
  getActiveWebhookSubscriptionsActivity: (params: { site_id: string; event_type?: string; event_types?: string[]; subscription_ids?: string[] }) => Promise<{
    id: string; site_id: string; endpoint_id: string; event_type: string; is_active: boolean;
  }[]>;
  fetchRecordByTableAndIdActivity: (params: { table: string; id: string }) => Promise<any>;
  deliverToWebhookEndpointActivity: (req: {
    site_id: string;
    endpoint: { id: string; site_id: string; target_url: string; secret?: string | null };
    subscription?: { id: string } | null;
    event_type: string;
    event?: string;
    table: string;
    object_id: string;
    record: any;
    maxAttempts?: number;
    attemptDelaysMs?: number[];
  }) => Promise<{ delivered: boolean; attempts: number; responseStatus?: number; responseBody?: string; delivery_id: string }>;
};

const {
  getActiveWebhookEndpointsActivity,
  getActiveWebhookSubscriptionsActivity,
  fetchRecordByTableAndIdActivity,
  deliverToWebhookEndpointActivity,
} = activities as unknown as Activities;

export async function webhookDispatchWorkflow(input: WebhookDispatchInput): Promise<WebhookDispatchResult> {
  const {
    site_id,
    table,
    event_type,
    object_id,
    event,
    record: eventRecord,
    subscription_ids,
  } = input;

  console.log(`🔔 WebhookDispatchWorkflow start: site=${site_id} event=${event_type} table=${table} id=${object_id}`);

  // 1) Get all active endpoints for the site
  const endpoints = await getActiveWebhookEndpointsActivity(site_id);
  console.log(`📡 Endpoints found: ${endpoints.length}`);
  if (endpoints.length > 0) {
    console.log('📡 Endpoints detail:', endpoints.map(e => ({ id: e.id, is_active: (e as any).is_active, handshake_status: (e as any).handshake_status })));
  }

  // 2) Get subscriptions for event type
  const {
    canonical: normalizedEvent,
    candidates: subscriptionEvents,
  } = resolveWebhookEventNames({ table, eventType: event_type, event });
  const subscriptions = await getActiveWebhookSubscriptionsActivity({
    site_id,
    event_types: subscriptionEvents,
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
  const endpointIdToSubscription = new Map<string, { id: string }>();
  for (const sub of subscriptions) {
    endpointIdToSubscription.set(sub.endpoint_id, { id: sub.id });
  }

  // 3) Prefer the database event snapshot. Deleted rows cannot be fetched after commit.
  const record = await resolveWebhookRecord({
    record: eventRecord,
    table,
    objectId: object_id,
    fetchRecord: fetchRecordByTableAndIdActivity,
  });

  // 4) Deliver to all endpoints that have a subscription
  const targetEndpoints = endpoints.filter((e) => endpointIdToSubscription.has(e.id));
  console.log(`🚚 Delivering to ${targetEndpoints.length} endpoints with active subscription for event`);
  if (targetEndpoints.length > 0) {
    console.log('🚚 Target endpoint_ids:', targetEndpoints.map(e => e.id));
  }

  const results: Array<{ endpoint_id: string; delivered: boolean; attempts: number; delivery_id: string; status?: number }> = [];

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


