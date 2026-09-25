import { apiService } from '../services/apiService';
import { supabaseServiceRole as supabaseAdmin } from '../../lib/supabase/client';
import { handleOutstandApiError } from './outstandHelpers';
import {
  buildOutstandCommentsPath,
  getConnectedCommentAccounts,
  isOutstandClientError,
} from '../workflows/helpers/outstandPoll';

function tenantSchema() {
  return process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public';
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
    .select('site_id, social_media')
    .not('social_media', 'is', null);
    
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
  const due = await fetchAllSocialPostsDueForAnalyticsActivity([siteId]);
  return due.map(({ postId, contentId }) => ({ postId, contentId }));
}

export async function fetchAllSocialPostsDueForAnalyticsActivity(
  siteIds: string[],
  limit = 5000
): Promise<Array<{ siteId: string; postId: string; contentId: string | null }>> {
  if (siteIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .schema(tenantSchema())
    .rpc('fetch_social_posts_due_for_analytics', {
      p_site_ids: siteIds,
      p_limit: limit,
    });

  if (error) {
    throw new Error(`Failed to load due social analytics: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    siteId: row.site_id,
    postId: row.post_id,
    contentId: row.content_id || null,
  }));
}

export interface ContentPerformanceUpdate {
  siteId: string,
  postId: string,
  analytics: any,
  contentId?: string | null,
}

function buildContentPerformanceRow(update: ContentPerformanceUpdate) {
    const metrics = unwrapAnalytics(update.analytics);
    const aggregated = metrics?.aggregated_metrics || {};
    const normalizedAccounts = normalizeMetricsByAccount(metrics?.metrics_by_account || []);
    const calculatedViews = normalizedAccounts.reduce((sum, acc) => sum + (Number(acc.views) || 0), 0);

    return {
      site_id: update.siteId,
      outstand_post_id: update.postId,
      content_id: update.contentId || null,
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
}

export async function upsertContentPerformanceBatchActivity(
  updates: ContentPerformanceUpdate[]
): Promise<void> {
  const batchSize = 100;
  for (let index = 0; index < updates.length; index += batchSize) {
    const rows = updates.slice(index, index + batchSize).map(buildContentPerformanceRow);
    const { error } = await supabaseAdmin
      .schema(tenantSchema())
      .from('content_performance')
      .upsert(rows, {
        onConflict: 'site_id,outstand_post_id',
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`Failed to upsert social analytics batch: ${error.message}`);
    }
  }
}

export async function upsertContentPerformanceActivity(
  siteId: string,
  postId: string,
  analytics: any,
  contentId?: string | null
): Promise<void> {
  let resolvedContentId = contentId || null;
  if (!resolvedContentId) {
    const { data, error } = await supabaseAdmin
      .schema(tenantSchema())
      .from('content')
      .select('id')
      .eq('site_id', siteId)
      .contains('tags', [`outstand_id_${postId}`])
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve analytics content: ${error.message}`);
    }
    resolvedContentId = data?.id || null;
  }

  await upsertContentPerformanceBatchActivity([
    { siteId, postId, analytics, contentId: resolvedContentId },
  ]);
}