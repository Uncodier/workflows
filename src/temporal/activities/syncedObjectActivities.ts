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

export async function claimSyncedObjectActivity(
  request: SyncedObjectClaimRequest
): Promise<SyncedObjectClaimResult> {
  const schema = tenantSchema();
  const now = new Date().toISOString();

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
    .eq('site_id', request.siteId)
    .eq('object_type', request.objectType)
    .eq('external_id', request.externalId)
    .eq('status', 'processing')
    .lt('claim_expires_at', now);

  if (resetError) {
    throw new Error(`Failed to reset expired ${request.objectType} claim: ${resetError.message}`);
  }

  const { data, error } = await supabaseAdmin
    .schema(schema)
    .rpc('claim_synced_objects_batch', {
      p_site_id: request.siteId,
      p_object_type: request.objectType,
      p_objects: [
        {
          external_id: request.externalId,
          provider: request.provider,
          metadata: request.metadata || {},
        },
      ],
    });

  if (error) {
    throw new Error(`Failed to claim ${request.objectType} ${request.externalId}: ${error.message}`);
  }

  const claimedRow = Array.isArray(data)
    ? data.find((row: any) => row.external_id === request.externalId)
    : null;
  const claimToken = claimedRow?.claimed_token;

  return {
    claimed: typeof claimToken === 'string' && claimToken.length > 0,
    externalId: request.externalId,
    claimToken,
  };
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
