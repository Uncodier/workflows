import { apiService } from '../services/apiService';
import { supabaseServiceRole as supabaseAdmin } from '../../lib/supabase/client';
import { handleOutstandApiError } from './outstandHelpers';
import {
  buildOutstandCommentsPath,
  extractOutstandPostText,
  getConnectedCommentAccounts,
  getOwnedPublishedCommentAccounts,
  isOutstandClientError,
  isPublishedContentForAnalytics,
  shouldPollPostForAnalytics,
} from '../workflows/helpers/outstandPoll';
import {
  claimSyncedObjectActivity,
  finishSyncedObjectClaimActivity,
} from './syncedObjectActivities';
import {
  buildOutstandContentExternalId,
  buildOutstandContentHash,
  buildOwnedOutstandTags,
  mergeOutstandMetadata,
  mergeOutstandTags,
  normalizeOutstandContent,
} from './outstandContentIdentity';

function tenantSchema() {
  return process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public';
}

function extractOutstandPostId(tags?: string[] | null): string | null {
  const tag = (tags || []).find((t) => typeof t === 'string' && t.startsWith('outstand_id_'));
  return tag ? tag.replace('outstand_id_', '') : null;
}

function unwrapAnalytics(payload: any): any {
  if (payload?.aggregated_metrics) return payload;
  if (payload?.data?.aggregated_metrics) return payload.data;
  return payload;
}

function resolveViews(network: string | null, metrics: any): number {
  const views = metrics.views || 0;
  const impressions = metrics.impressions || 0;
  const reach = metrics.reach || 0;

  if (!network) return views || impressions;

  switch (network.toLowerCase()) {
    case 'linkedin':
    case 'twitter':
    case 'x':
    case 'pinterest':
      // Text/image heavy networks where 'impressions' is equivalent to 'views'
      return views || impressions;
      
    case 'facebook':
    case 'instagram':
      // Typically report reach and impressions; fallback to reach then impressions
      return views || reach || impressions;

    case 'tiktok':
    case 'youtube':
    case 'shorts':
      // Video-first networks; views are absolute
      return views;

    default:
      return views || impressions;
  }
}

function normalizeMetricsByAccount(byAccount: any[]): Array<Record<string, unknown>> {
  if (!Array.isArray(byAccount)) return [];
  return byAccount.map((acc) => {
    const metrics = acc?.metrics || acc || {};
    const network = acc?.social_account?.network || acc?.network || null;
    return {
      network,
      username: acc?.social_account?.username || acc?.username || null,
      nickname: acc?.social_account?.nickname || acc?.nickname || null,
      likes: metrics.likes || 0,
      comments: metrics.comments || 0,
      shares: metrics.shares || 0,
      views: resolveViews(network, metrics),
      impressions: metrics.impressions || 0,
      reach: metrics.reach || 0,
      engagement_rate: metrics.engagement_rate || 0,
    };
  });
}

export async function fetchSitesWithSocialCommentsActivity(): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
    .from('settings')
    .select('site_id, social_media, channels');
    
  if (error) {
    throw new Error(`Failed to fetch sites: ${error.message}`);
  }
  
  return (data || []).filter(setting => {
    return getConnectedCommentAccounts(setting.social_media).length > 0;
  }).map(s => ({ site_id: s.site_id, social_media: s.social_media }));
}

export async function fetchOutstandPostsActivity(siteId: string, limit: number = 100, offset: number = 0): Promise<any> {
  const response = await apiService.get(`/api/integrations/outstand/posts?tenant_id=${siteId}&limit=${limit}&offset=${offset}`);
  if (!response.success) {
    throw handleOutstandApiError('fetchOutstandPosts', response.error?.message);
  }
  return response.data;
}

export async function fetchOutstandAccountsActivity(siteId: string): Promise<any[]> {
  const response = await apiService.get(`/api/integrations/outstand/accounts?tenant_id=${siteId}`);
  if (!response.success) {
    throw handleOutstandApiError('fetchOutstandAccounts', response.error?.message);
  }
  return Array.isArray(response.data) ? response.data : (response.data?.accounts || response.data?.data || []);
}

export async function importOutstandPostsActivity(siteId: string, accountId: string): Promise<any> {
  const response = await apiService.post(`/api/integrations/outstand/accounts/${accountId}/imports?tenant_id=${siteId}`, {});
  if (!response.success) {
    throw handleOutstandApiError(`importOutstandPosts for account ${accountId}`, response.error?.message);
  }
  return response.data;
}

export async function checkIfImportTriggeredActivity(siteId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .schema(tenantSchema())
    .from('cron_status')
    .select('id')
    .eq('site_id', siteId)
    .eq('activity_name', 'outstand_historical_import')
    .maybeSingle();

  if (error) {
    console.error(`[checkIfImportTriggeredActivity] Error checking cron_status for site ${siteId}:`, error);
    // On error we return true to prevent infinite loop / spam
    return true; 
  }

  return !!data;
}

export async function markImportTriggeredActivity(siteId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .schema(tenantSchema())
    .from('cron_status')
    .upsert(
      {
        site_id: siteId,
        activity_name: 'outstand_historical_import',
        workflow_id: `outstand_import_${siteId}_${Date.now()}`,
        schedule_id: 'manual-execution',
        status: 'COMPLETED',
        last_run: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      {
        onConflict: 'site_id,activity_name',
        ignoreDuplicates: false,
      }
    );

  if (error) {
    console.error(`[markImportTriggeredActivity] Error marking import triggered for site ${siteId}:`, error);
    throw new Error(`Failed to mark import triggered: ${error.message}`);
  }
}

export async function fetchOutstandPostRepliesActivity(siteId: string, postId: string, network: string): Promise<any> {
  const response = await apiService.get(buildOutstandCommentsPath(siteId, postId, network));
  if (!response.success) {
    throw handleOutstandApiError(`fetchOutstandPostReplies for post ${postId}`, response.error?.message);
  }
  return response.data;
}

export async function submitCustomerSupportMessageActivity(payload: any): Promise<any> {
  const response = await apiService.post(`/api/agents/customerSupport/message`, payload);
  if (!response.success) {
    throw new Error(`Failed to submit customer support message: ${response.error?.message}`);
  }
  return response.data;
}

export async function fetchOutstandPostAnalyticsActivity(siteId: string, postId: string): Promise<any> {
  const response = await apiService.get(`/api/integrations/outstand/posts/${postId}/analytics?tenant_id=${siteId}`);
  if (!response.success) {
    const errorMsg = response.error?.message || '';
    if (isOutstandClientError(errorMsg)) {
      console.log(`[fetchOutstandPostAnalyticsActivity] Skipping post ${postId}: ${errorMsg}`);
      return null;
    }
    throw handleOutstandApiError(`fetchOutstandPostAnalytics for post ${postId}`, errorMsg);
  }
  return response.data;
}

export async function fetchSocialPostsDueForAnalyticsActivity(
  siteId: string
): Promise<Array<{ postId: string; contentId: string | null }>> {
  const schema = tenantSchema();
  const nowMs = Date.now();

  const { data: snapshots, error: snapshotError } = await supabaseAdmin
    .schema(schema)
    .from('content_performance')
    .select('outstand_post_id, content_id, fetched_at')
    .eq('site_id', siteId);

  if (snapshotError) {
    throw new Error(`Failed to load performance snapshots: ${snapshotError.message}`);
  }

  const snapshotMap = new Map<string, { contentId: string | null; fetchedAt: string | null }>();
  for (const row of snapshots || []) {
    if (row.outstand_post_id) {
      snapshotMap.set(row.outstand_post_id, {
        contentId: row.content_id,
        fetchedAt: row.fetched_at,
      });
    }
  }

  const { data: contents, error: contentError } = await supabaseAdmin
    .schema(schema)
    .from('content')
    .select('id, tags, status, published_at')
    .eq('site_id', siteId)
    .not('tags', 'is', null);

  if (contentError) {
    throw new Error(`Failed to load social content: ${contentError.message}`);
  }

  const due = new Map<string, string | null>();

  for (const content of contents || []) {
    if (!isPublishedContentForAnalytics(content)) continue;
    const postId = extractOutstandPostId(content.tags);
    if (!postId) continue;
    
    const snapshot = snapshotMap.get(postId);
    const lastFetchedAt = snapshot?.fetchedAt || null;
    
    if (shouldPollPostForAnalytics(content.published_at, nowMs, lastFetchedAt)) {
      due.set(postId, snapshot?.contentId || content.id);
    }
  }

  return Array.from(due.entries()).map(([postId, contentId]) => ({ postId, contentId }));
}

export async function upsertContentPerformanceActivity(
  siteId: string,
  postId: string,
  analytics: any,
  contentId?: string | null
): Promise<void> {
  try {
    let resolvedContentId = contentId ?? null;
    if (!resolvedContentId) {
      const { data: existing } = await supabaseAdmin
        .schema(tenantSchema())
        .from('content')
        .select('id')
        .eq('site_id', siteId)
        .contains('tags', [`outstand_id_${postId}`])
        .limit(1)
        .maybeSingle();
      resolvedContentId = existing?.id || null;
    }

    const metrics = unwrapAnalytics(analytics);
    const aggregated = metrics?.aggregated_metrics || {};
    const normalizedAccounts = normalizeMetricsByAccount(metrics?.metrics_by_account || []);
    
    // Calculate total views from accounts that might have specific channel logic
    const calculatedViews = normalizedAccounts.reduce((sum, acc) => sum + (Number(acc.views) || 0), 0);

    const upsertData = {
      site_id: siteId,
      outstand_post_id: postId,
      content_id: resolvedContentId,
      likes: aggregated.total_likes || 0,
      comments: aggregated.total_comments || 0,
      shares: aggregated.total_shares || 0,
      views: aggregated.total_views || calculatedViews || 0,
      impressions: aggregated.total_impressions || 0,
      reach: aggregated.total_reach || 0,
      engagement_rate: aggregated.average_engagement_rate || 0,
      metrics_by_account: normalizedAccounts,
      fetched_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .schema(tenantSchema())
      .from('content_performance')
      .upsert(upsertData, {
        onConflict: 'site_id,outstand_post_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`[upsertContentPerformanceActivity] Error upserting performance for post ${postId}:`, error);
      throw error;
    }
  } catch (error) {
    console.error(`[upsertContentPerformanceActivity] Exception processing performance for post ${postId}:`, error);
    throw error;
  }
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
    if (ownedSocialAccounts.length === 0) {
      console.warn(
        `[upsertContentFromOutstandPost] Skipping post ${outstandId}: no published account belongs to site ${siteId}`
      );
      return null;
    }

    const postText = extractOutstandPostText(post);
    if (!postText) {
      console.log(`[upsertContentFromOutstandPost] Skipping post ${outstandId}: empty text/content`);
      return null;
    }

    const normalizedPostText = normalizeOutstandContent(postText);
    const contentHash = buildOutstandContentHash(normalizedPostText);
    const externalId = buildOutstandContentExternalId(contentHash);
    const tags = buildOwnedOutstandTags(String(outstandId), ownedSocialAccounts);

    // Match both stable external IDs and identical logical content. Outstand can
    // return one record per network for the same post.
    const { data: candidates, error: searchError } = await supabaseAdmin
      .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
      .from('content')
      .select('id, tags, text, description, metadata')
      .eq('site_id', siteId)
      .order('created_at', { ascending: true })
      .limit(1000);

    if (searchError) {
      console.error(`[upsertContentFromOutstandPost] Error finding content for post ${outstandId}:`, searchError);
      return null;
    }

    const existing = (candidates || []).find((candidate: any) => {
      const hasExternalId = candidate.tags?.includes(`outstand_id_${outstandId}`);
      const hasOutstandEvidence = candidate.tags?.some(
        (tag: string) => tag === 'outstand_only' || tag.startsWith('outstand_id_')
      ) || candidate.metadata?.source === 'outstand';
      const candidateText = candidate.text?.trim()
        ? candidate.text
        : candidate.description || '';
      return hasExternalId
        || (
          hasOutstandEvidence
          && normalizeOutstandContent(candidateText) === normalizedPostText
        );
    });

    if (existing?.id) {
      const { error: mergeError } = await supabaseAdmin
        .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
        .from('content')
        .update({
          tags: mergeOutstandTags(existing.tags, tags),
          metadata: mergeOutstandMetadata(
            existing.metadata,
            contentHash,
            String(outstandId)
          ),
        })
        .eq('id', existing.id)
        .eq('site_id', siteId);

      if (mergeError) {
        console.error(
          `[upsertContentFromOutstandPost] Error consolidating post ${outstandId}:`,
          mergeError
        );
        return null;
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

    if (!claim.claimed || !claim.claimToken) {
      return null;
    }
    const status = post.isDraft ? "draft" : (post.scheduledAt ? "approved" : "published");

    const insertData = {
      title: postText.substring(0, 50) + (postText.length > 50 ? "..." : ""),
      description: postText,
      type: "social_post",
      text: postText,
      status,
      site_id: siteId,
      created_at: post.createdAt || new Date().toISOString(),
      updated_at: post.createdAt || new Date().toISOString(),
      published_at: post.publishedAt || null,
      tags,
      metadata: mergeOutstandMetadata(null, contentHash, String(outstandId)),
      word_count: postText.split(" ").length,
      estimated_reading_time: 1,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
      .from('content')
      .insert([insertData])
      .select('id')
      .single();

    if (insertError) {
      console.error(`[upsertContentFromOutstandPost] Error inserting content for post ${outstandId}:`, insertError);
      await finishSyncedObjectClaimActivity({
        siteId,
        objectType: 'social_post',
        externalId,
        claimToken: claim.claimToken,
        status: 'error',
        errorMessage: insertError.message,
      });
      return null;
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
    console.error(`[upsertContentFromOutstandPost] Exception processing post ${outstandId}:`, error);
    return null;
  }
}