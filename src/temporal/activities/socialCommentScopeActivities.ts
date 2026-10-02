import { supabaseServiceRole } from '../../lib/supabase/client';
import { commentAccountBoundaryKey, commentScopeKey, type SocialCommentScope } from '../workflows/helpers/socialCommentScope';
import { getSocialCommentSyncStatesActivity, verifySocialCommentIngestionActivity } from './socialCommentSyncActivities';

function db() {
  return supabaseServiceRole.schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA
    || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public');
}

/** The caller establishes unambiguous site/post/account ownership before scheduling this activity. */
export async function initializeSocialCommentScopeActivity(
  scope: SocialCommentScope, inheritLegacy: boolean
): Promise<{ boundary: string; lastSuccessAt?: string }> {
  const syncKey = commentScopeKey(scope);
  const boundaryKey = commentScopeKey(scope, 'boundary');
  const accountBoundaryKey = commentAccountBoundaryKey(scope);
  const states = await getSocialCommentSyncStatesActivity(scope.siteId, [scope.postId, syncKey, boundaryKey, accountBoundaryKey]);
  const state = states.find(row => row.postId === syncKey && row.network === scope.network);
  const existing = states.find(row => row.postId === boundaryKey && row.network === scope.network);
  const legacy = inheritLegacy && states.find(row => row.postId === scope.postId && row.network === scope.network);
  const lastSuccessAt = state?.lastSuccessAt || (legacy ? legacy.lastSuccessAt : undefined);
  if (existing) return { boundary: existing.lastSuccessAt, lastSuccessAt };
  let accountBoundary = states.find(row => row.postId === accountBoundaryKey && row.network === scope.network)?.lastSuccessAt;
  if (!accountBoundary) {
    await insertBoundary(scope, accountBoundaryKey, new Date().toISOString());
    const savedAccount = await getSocialCommentSyncStatesActivity(scope.siteId, [accountBoundaryKey]);
    accountBoundary = savedAccount.find(row => row.postId === accountBoundaryKey && row.network === scope.network)?.lastSuccessAt;
    if (!accountBoundary) throw new Error('Social comment account boundary was not persisted');
  }
  // Immutable initialization; concurrent workers must reuse the winning cutoff.
  // This reserved boundary row is NOT a successful provider sync or a provider post ID.
  await insertBoundary(scope, boundaryKey, legacy ? legacy.lastSuccessAt : accountBoundary);
  const saved = await getSocialCommentSyncStatesActivity(scope.siteId, [boundaryKey]);
  const boundary = saved.find(row => row.postId === boundaryKey && row.network === scope.network)?.lastSuccessAt;
  if (!boundary || !Number.isFinite(Date.parse(boundary))) throw new Error('Social comment boundary was not persisted');
  return { boundary, lastSuccessAt };
}

async function insertBoundary(scope: SocialCommentScope, key: string, timestamp: string) {
  const { error } = await db().from('social_comment_sync_state').upsert({
    site_id: scope.siteId, outstand_post_id: key, network: scope.network, last_success_at: timestamp,
  }, { onConflict: 'site_id,outstand_post_id,network', ignoreDuplicates: true });
  if (error) throw new Error(`Failed to initialize social comment boundary: ${error.message}`);
}

/** Never re-submit legacy claims/drafts to repair grouping. Missing account evidence is not a match. */
export async function findLegacySocialCommentClaimsActivity(
  scope: SocialCommentScope, externalIds: string[], inheritLegacy: boolean
): Promise<string[]> {
  commentScopeKey(scope);
  const matched = new Set<string>();
  for (let index = 0; index < externalIds.length; index += 100) {
    const chunk = externalIds.slice(index, index + 100);
    if (inheritLegacy) {
      const { data, error } = await db().from('synced_objects').select('external_id, metadata')
        .eq('site_id', scope.siteId).eq('object_type', 'social_comment').in('external_id', chunk);
      if (error || !Array.isArray(data)) throw new Error('Unable to verify legacy social comment claims');
      for (const row of data) {
        if (row.metadata?.outstand_post_id === scope.postId &&
            (!row.metadata.publisher_account_id || row.metadata.publisher_account_id === scope.accountId)) {
          matched.add(row.external_id);
        }
      }
    }
    // Multi-account legacy claims omit publisher metadata. Only explicit persisted
    // message evidence may suppress a comment in that case, never current array order.
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db().from('messages').select('custom_data, conversations!inner(site_id)')
        .eq('conversations.site_id', scope.siteId).eq('role', 'user').eq('custom_data->>source', 'comment')
        .eq('custom_data->>publisher_account_id', scope.accountId)
        .eq('custom_data->>outstand_post_id', scope.postId)
        .in('custom_data->>origin_message_id', chunk).order('id', { ascending: true }).range(offset, offset + 99);
      if (error || !Array.isArray(data)) throw new Error('Unable to verify legacy social comment messages');
      for (const row of data) matched.add(row.custom_data.origin_message_id);
      if (data.length < 100) break;
    }
  }
  // In-progress/failed legacy claims must remain visible failures, not silently
  // certified as successful merely because the old identifier exists.
  await verifySocialCommentIngestionActivity(scope.siteId, [...matched]);
  return [...matched];
}