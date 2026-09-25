import { supabaseServiceRole as supabaseAdmin } from '../../lib/supabase/client';
import { extractOutstandPostText, getOwnedPublishedCommentAccounts } from '../workflows/helpers/outstandPoll';
import {
  buildOutstandContentExternalId,
  buildOutstandContentHash,
  buildOwnedOutstandTags,
  mergeOutstandMetadata,
  mergeOutstandTags,
  normalizeOutstandContent,
} from './outstandContentIdentity';
import {
  claimSyncedObjectActivity,
  finishSyncedObjectClaimActivity,
} from './syncedObjectActivities';

interface ContentCandidate {
  id: string;
  tags?: string[] | null;
  text?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

function tenantSchema(): string {
  return process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA
    || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA
    || 'public';
}

async function findContentCandidate(
  siteId: string,
  outstandId: string,
  contentHash: string,
  normalizedPostText: string
): Promise<ContentCandidate | null> {
  const content = () => supabaseAdmin.schema(tenantSchema()).from('content');
  const selectedFields = 'id, tags, text, description, metadata';

  const { data: exactMatch, error: exactError } = await content()
    .select(selectedFields)
    .eq('site_id', siteId)
    .contains('tags', [`outstand_id_${outstandId}`])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (exactError) {
    throw new Error(`Failed to find Outstand content by post ID: ${exactError.message}`);
  }
  if (exactMatch) return exactMatch as ContentCandidate;

  const { data: hashMatch, error: hashError } = await content()
    .select(selectedFields)
    .eq('site_id', siteId)
    .eq('metadata->>source_content_hash', contentHash)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (hashError) {
    throw new Error(`Failed to find Outstand content by hash: ${hashError.message}`);
  }
  if (hashMatch) return hashMatch as ContentCandidate;

  // Legacy rows may predate source_content_hash. This fallback is only reached
  // once per unmigrated or new logical post; a successful match is backfilled.
  const { data: legacyCandidates, error: legacyError } = await content()
    .select(selectedFields)
    .eq('site_id', siteId)
    .not('tags', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1000);

  if (legacyError) {
    throw new Error(`Failed to find legacy Outstand content: ${legacyError.message}`);
  }

  return (legacyCandidates || []).find((candidate: ContentCandidate) => {
    const hasOutstandEvidence = candidate.tags?.some(
      (tag) => tag === 'outstand_only' || tag.startsWith('outstand_id_')
    ) || candidate.metadata?.source === 'outstand';
    const candidateText = candidate.text?.trim()
      ? candidate.text
      : candidate.description || '';
    return hasOutstandEvidence
      && normalizeOutstandContent(candidateText) === normalizedPostText;
  }) || null;
}

function hasContentIdentityChanges(
  existing: ContentCandidate,
  tags: string[],
  metadata: Record<string, unknown>
): boolean {
  const existingTags = existing.tags || [];
  const tagsChanged = tags.length !== existingTags.length
    || tags.some((tag, index) => tag !== existingTags[index]);
  return tagsChanged
    || JSON.stringify(existing.metadata || {}) !== JSON.stringify(metadata);
}

export async function upsertContentFromOutstandPostActivity(
  siteId: string,
  post: any,
  socialMedia: unknown
): Promise<string | null> {
  const outstandId = post.id;
  if (!outstandId) return null;

  try {
    const ownedSocialAccounts = getOwnedPublishedCommentAccounts(post, socialMedia);
    if (ownedSocialAccounts.length === 0) return null;

    const postText = extractOutstandPostText(post);
    if (!postText) return null;

    const normalizedPostText = normalizeOutstandContent(postText);
    const contentHash = buildOutstandContentHash(normalizedPostText);
    const externalId = buildOutstandContentExternalId(contentHash);
    const incomingTags = buildOwnedOutstandTags(String(outstandId), ownedSocialAccounts);
    const existing = await findContentCandidate(
      siteId,
      String(outstandId),
      contentHash,
      normalizedPostText
    );

    if (existing) {
      const tags = mergeOutstandTags(existing.tags, incomingTags);
      const metadata = mergeOutstandMetadata(
        existing.metadata,
        contentHash,
        String(outstandId)
      );

      if (hasContentIdentityChanges(existing, tags, metadata)) {
        const { error } = await supabaseAdmin
          .schema(tenantSchema())
          .from('content')
          .update({ tags, metadata })
          .eq('id', existing.id)
          .eq('site_id', siteId);

        if (error) {
          throw new Error(`Failed to merge Outstand content: ${error.message}`);
        }
      }

      return existing.id;
    }

    const claim = await claimSyncedObjectActivity({
      siteId,
      objectType: 'social_post',
      externalId,
      provider: 'outstand',
      metadata: {
        outstand_post_id: outstandId,
        source_content_hash: contentHash,
      },
    });
    if (!claim.claimed || !claim.claimToken) return null;

    const status = post.isDraft
      ? 'draft'
      : post.scheduledAt
        ? 'approved'
        : 'published';
    const insertData = {
      title: postText.substring(0, 50) + (postText.length > 50 ? '...' : ''),
      description: postText,
      type: 'social_post',
      text: postText,
      status,
      site_id: siteId,
      created_at: post.createdAt || new Date().toISOString(),
      updated_at: post.createdAt || new Date().toISOString(),
      published_at: post.publishedAt || null,
      tags: incomingTags,
      metadata: mergeOutstandMetadata(null, contentHash, String(outstandId)),
      word_count: postText.split(' ').length,
      estimated_reading_time: 1,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .schema(tenantSchema())
      .from('content')
      .insert([insertData])
      .select('id')
      .single();

    if (insertError) {
      await finishSyncedObjectClaimActivity({
        siteId,
        objectType: 'social_post',
        externalId,
        claimToken: claim.claimToken,
        status: 'error',
        errorMessage: insertError.message,
      });
      throw new Error(`Failed to insert Outstand content: ${insertError.message}`);
    }

    await finishSyncedObjectClaimActivity({
      siteId,
      objectType: 'social_post',
      externalId,
      claimToken: claim.claimToken,
      status: 'completed',
    });

    return inserted?.id || null;
  } catch (error) {
    console.error(`[upsertContentFromOutstandPost] Failed for post ${outstandId}:`, error);
    return null;
  }
}
