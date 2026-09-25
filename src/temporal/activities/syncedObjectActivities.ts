import { supabaseServiceRole as supabaseAdmin } from '../../lib/supabase/client';

function tenantSchema() {
  return process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA
    || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA
    || 'public';
}

export interface SyncedObjectClaimRequest {
  siteId: string;
  objectType: 'social_comment' | 'social_post';
  externalId: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export interface SyncedObjectClaimResult {
  claimed: boolean;
  externalId: string;
  claimToken?: string;
}

export interface FinishSyncedObjectClaimRequest {
  siteId: string;
  objectType: 'social_comment' | 'social_post';
  externalId: string;
  claimToken: string;
  status: 'completed' | 'error';
  errorMessage?: string;
}

const CLAIM_BATCH_SIZE = 100;

function claimGroupKey(request: SyncedObjectClaimRequest): string {
  return `${request.siteId}\u0000${request.objectType}`;
}

export async function claimSyncedObjectsBatchActivity(
  requests: SyncedObjectClaimRequest[]
): Promise<SyncedObjectClaimResult[]> {
  if (requests.length === 0) return [];

  const schema = tenantSchema();
  const groups = new Map<string, Map<string, SyncedObjectClaimRequest>>();

  for (const request of requests) {
    const key = claimGroupKey(request);
    const group = groups.get(key) || new Map<string, SyncedObjectClaimRequest>();
    group.set(request.externalId, request);
    groups.set(key, group);
  }

  const results: SyncedObjectClaimResult[] = [];

  for (const group of groups.values()) {
    const uniqueRequests = [...group.values()];
    const { siteId, objectType } = uniqueRequests[0];

    for (let index = 0; index < uniqueRequests.length; index += CLAIM_BATCH_SIZE) {
      const chunk = uniqueRequests.slice(index, index + CLAIM_BATCH_SIZE);
      const now = new Date().toISOString();
      const externalIds = chunk.map((request) => request.externalId);

      const { error: resetError } = await supabaseAdmin
        .schema(schema)
        .from('synced_objects')
        .update({
          status: 'error',
          claim_token: null,
          claim_expires_at: null,
          error_message: 'Processing lease expired before completion',
          updated_at: now,
        })
        .eq('site_id', siteId)
        .eq('object_type', objectType)
        .in('external_id', externalIds)
        .eq('status', 'processing')
        .lt('claim_expires_at', now);

      if (resetError) {
        throw new Error(`Failed to reset expired ${objectType} claims: ${resetError.message}`);
      }

      const { data, error } = await supabaseAdmin
        .schema(schema)
        .rpc('claim_synced_objects_batch', {
          p_site_id: siteId,
          p_object_type: objectType,
          p_objects: chunk.map((request) => ({
            external_id: request.externalId,
            provider: request.provider,
            metadata: request.metadata || {},
          })),
        });

      if (error) {
        throw new Error(`Failed to claim ${objectType} batch: ${error.message}`);
      }

      const claimedTokens = new Map<string, string>();
      for (const row of Array.isArray(data) ? data : []) {
        if (typeof row?.external_id === 'string' && typeof row?.claimed_token === 'string') {
          claimedTokens.set(row.external_id, row.claimed_token);
        }
      }

      for (const request of chunk) {
        const claimToken = claimedTokens.get(request.externalId);
        results.push({
          claimed: Boolean(claimToken),
          externalId: request.externalId,
          ...(claimToken ? { claimToken } : {}),
        });
      }
    }
  }

  return results;
}

export async function claimSyncedObjectActivity(
  request: SyncedObjectClaimRequest
): Promise<SyncedObjectClaimResult> {
  const [result] = await claimSyncedObjectsBatchActivity([request]);
  return result;
}

export async function finishSyncedObjectClaimActivity(
  request: FinishSyncedObjectClaimRequest
): Promise<void> {
  const schema = tenantSchema();
  const now = new Date().toISOString();
  const updateData = {
    status: request.status,
    claim_token: null,
    claim_expires_at: null,
    last_processed_at: request.status === 'completed' ? now : null,
    error_message: request.status === 'error' ? request.errorMessage || 'Processing failed' : null,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .schema(schema)
    .from('synced_objects')
    .update(updateData)
    .eq('site_id', request.siteId)
    .eq('object_type', request.objectType)
    .eq('external_id', request.externalId)
    .eq('claim_token', request.claimToken)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to finish ${request.objectType} ${request.externalId}: ${error.message}`);
  }

  if (data?.id) {
    return;
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .schema(schema)
    .from('synced_objects')
    .select('status')
    .eq('site_id', request.siteId)
    .eq('object_type', request.objectType)
    .eq('external_id', request.externalId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to verify ${request.objectType} ${request.externalId}: ${lookupError.message}`);
  }

  if (existing?.status !== request.status) {
    throw new Error(`Claim for ${request.objectType} ${request.externalId} is no longer owned by this workflow`);
  }
}
