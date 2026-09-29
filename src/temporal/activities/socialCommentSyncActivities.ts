import { supabaseServiceRole } from '../../lib/supabase/client';
import { normalizeOutstandNetwork } from '../workflows/helpers/outstandPoll';

const QUERY_BATCH_SIZE = 100;

export interface SocialCommentSyncState {
  postId: string;
  network: string;
  lastSuccessAt: string;
}

function tenantSchema(): string {
  return process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA
    || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA
    || 'public';
}

function requireNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function uniqueIds(values: string[], name: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${name} must be an array`);
  for (const value of values) requireNonEmptyString(value, name);
  return [...new Set(values)];
}

// These service-only activities require site/post ownership to be established
// by the caller. Non-public tenants must adapt the public migration before use.
export async function getSocialCommentSyncStatesActivity(
  siteId: string,
  postIds: string[]
): Promise<SocialCommentSyncState[]> {
  requireNonEmptyString(siteId, 'siteId');
  const ids = uniqueIds(postIds, 'postIds');
  const states: SocialCommentSyncState[] = [];

  for (let index = 0; index < ids.length; index += QUERY_BATCH_SIZE) {
    const chunk = ids.slice(index, index + QUERY_BATCH_SIZE);
    // One post may have several networks, so also page the returned rows.
    for (let offset = 0; ; offset += QUERY_BATCH_SIZE) {
      const { data, error } = await supabaseServiceRole
        .schema(tenantSchema())
        .from('social_comment_sync_state')
        .select('outstand_post_id, network, last_success_at')
        .eq('site_id', siteId)
        .in('outstand_post_id', chunk)
        .order('outstand_post_id', { ascending: true })
        .order('network', { ascending: true })
        .range(offset, offset + QUERY_BATCH_SIZE - 1);

      if (error) throw new Error(`Failed to read social comment sync state: ${error.message}`);
      if (!Array.isArray(data)) throw new Error('Invalid social comment sync state response');
      for (const row of data) {
        requireNonEmptyString(row.outstand_post_id, 'outstand_post_id');
        requireNonEmptyString(row.network, 'network');
        requireNonEmptyString(row.last_success_at, 'last_success_at');
        states.push({
          postId: row.outstand_post_id,
          network: normalizeOutstandNetwork(row.network),
          lastSuccessAt: row.last_success_at,
        });
      }
      if (data.length < QUERY_BATCH_SIZE) break;
    }
  }
  return states;
}

/** Record success only after the caller has fully handled and verified the batch. */
export async function recordSocialCommentSyncSuccessActivity(
  siteId: string,
  postId: string,
  network: string
): Promise<void> {
  requireNonEmptyString(siteId, 'siteId');
  requireNonEmptyString(postId, 'postId');
  requireNonEmptyString(network, 'network');
  const { error } = await supabaseServiceRole
    .schema(tenantSchema())
    .from('social_comment_sync_state')
    .upsert({
      site_id: siteId,
      outstand_post_id: postId,
      network: normalizeOutstandNetwork(network),
      // Never accept a timestamp from the workflow/provider as proof of success.
      last_success_at: new Date().toISOString(),
    }, { onConflict: 'site_id,outstand_post_id,network' });

  if (error) throw new Error(`Failed to record social comment sync success: ${error.message}`);
}

export async function hasSocialCommentPersistedActivity(
  siteId: string,
  externalId: string
): Promise<boolean> {
  requireNonEmptyString(siteId, 'siteId');
  requireNonEmptyString(externalId, 'externalId');
  const { data, error } = await supabaseServiceRole
    .schema(tenantSchema())
    .from('messages')
    .select('id, conversations!inner(site_id)')
    .eq('conversations.site_id', siteId)
    .eq('role', 'user')
    .eq('custom_data->>origin_message_id', externalId)
    .eq('custom_data->>source', 'comment')
    .limit(1);

  if (error) throw new Error(`Failed to verify persisted social comment: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('Invalid persisted social comment response');
  return data.some((row) => row?.id);
}

export async function assertSocialCommentPersistedActivity(
  siteId: string,
  externalId: string
): Promise<void> {
  if (!await hasSocialCommentPersistedActivity(siteId, externalId)) {
    throw new Error('Social comment was not persisted for this site');
  }
}

async function assertPersistedBatch(siteId: string, externalIds: string[]): Promise<void> {
  const missing = new Set(externalIds);
  // Duplicate messages must neither count for another ID nor hide later rows.
  for (let offset = 0; missing.size > 0; offset += QUERY_BATCH_SIZE) {
    const { data, error } = await supabaseServiceRole
      .schema(tenantSchema())
      .from('messages')
      .select('custom_data, conversations!inner(site_id)')
      .eq('conversations.site_id', siteId)
      .eq('role', 'user')
      .eq('custom_data->>source', 'comment')
      .in('custom_data->>origin_message_id', externalIds)
      .order('id', { ascending: true })
      .range(offset, offset + QUERY_BATCH_SIZE - 1);

    if (error) throw new Error(`Failed to verify persisted social comments: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('Invalid persisted social comments response');
    for (const row of data) missing.delete(row?.custom_data?.origin_message_id);
    if (data.length < QUERY_BATCH_SIZE) break;
  }
  if (missing.size > 0) throw new Error(`${missing.size} social comment(s) were not persisted for this site`);
}

/** A completed claim is insufficient: older success responses could skip saving. */
export async function verifySocialCommentIngestionActivity(
  siteId: string,
  externalIds: string[]
): Promise<void> {
  requireNonEmptyString(siteId, 'siteId');
  const ids = uniqueIds(externalIds, 'externalIds');
  for (let index = 0; index < ids.length; index += QUERY_BATCH_SIZE) {
    const chunk = ids.slice(index, index + QUERY_BATCH_SIZE);
    const { data, error } = await supabaseServiceRole
      .schema(tenantSchema())
      .from('synced_objects')
      .select('external_id, status')
      .eq('site_id', siteId)
      .eq('object_type', 'social_comment')
      .in('external_id', chunk);

    if (error) throw new Error(`Failed to verify social comment ingestion: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('Invalid social comment ingestion response');
    const completed = new Set<string>();
    for (const row of data) {
      if (row?.status !== 'completed') throw new Error('Social comment ingestion is not completed');
      completed.add(row.external_id);
    }
    if (chunk.some((externalId) => !completed.has(externalId))) {
      throw new Error('Social comment ingestion is not completed for every requested comment');
    }
    await assertPersistedBatch(siteId, chunk);
  }
}