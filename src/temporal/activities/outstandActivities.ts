import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import { supabaseServiceRole as supabaseAdmin } from '../../lib/supabase/client';
import { handleOutstandApiError } from './outstandHelpers';
import { extractSocialCommentResponse } from './socialCommentResponse';
import { durableLinkedInComment } from '../workflows/helpers/socialCommentIdentity';
import {
  buildOutstandCommentsPath,
  getConnectedSocialPostAccounts,
  isImportAccountOwnedBySite,
  isOutstandClientError,
  normalizeOutstandNetwork,
  supportsHistoricalImport,
  shouldPollPostForAnalytics,
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
    return getConnectedSocialPostAccounts(setting.social_media).length > 0;
  }).map(s => ({ site_id: s.site_id, social_media: s.social_media }));
}

export async function fetchOutstandPostsActivity(siteId: string, limit: number = 100, offset: number = 0): Promise<any> {
  // X-Tenant-ID alone does not scope the Outstand posts list. The tenantId
  // query filter prevents posts from other sites in a shared organization from
  // appearing in this site's poll. The API wraps the provider response, so
  // the actual posts may live under response.data.posts.
  const tenant = encodeURIComponent(siteId);
  const response = await apiService.get(`/api/integrations/outstand/posts?tenant_id=${tenant}&tenantId=${tenant}&limit=${limit}&offset=${offset}`);
  if (!response.success) {
    throw handleOutstandApiError('fetchOutstandPosts', response.error?.message);
  }
  const payload = response.data;
  if (payload?.success === false) {
    throw new Error(`Outstand posts request failed: ${payload.error || 'Unknown error'}`);
  }
  if (Array.isArray(payload)) return payload;
  const posts = payload?.posts || payload?.data;
  if (!Array.isArray(posts)) {
    throw new Error(`Invalid Outstand posts response for site ${siteId}`);
  }
  return { posts, pagination: payload.pagination || { total: posts.length } };
}

export async function fetchOutstandAccountsActivity(siteId: string): Promise<any[]> {
  const response = await apiService.get(`/api/integrations/outstand/social-accounts?tenant_id=${encodeURIComponent(siteId)}`);
  if (!response.success) {
    throw handleOutstandApiError('fetchOutstandAccounts', response.error?.message);
  }
  const payload = response.data;
  // The API wrapper returns { success, data, accounts }. Do not silently
  // treat a malformed response as "no accounts" and skip all imports.
  if (payload?.success === false || payload?.data?.success === false) {
    throw new Error('Failed to fetch Outstand accounts');
  }
  const accounts = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.accounts)
        ? payload.accounts
        : payload?.data?.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error('Failed to fetch Outstand accounts: invalid accounts response');
  }
  return accounts;
}

export async function importOutstandPostsActivity(siteId: string, accountId: string): Promise<any> {
  // Outstand bills each imported post. Never run this automatic historical
  // activity (including retries of older Temporal histories). Only the
  // explicitly confirmed API endpoint may start a bounded import job.
  void siteId;
  void accountId;
  throw ApplicationFailure.nonRetryable(
    'Historical Outstand imports require explicit confirmation and a bounded limit',
    'OUTSTAND_IMPORT_REQUIRES_CONFIRMATION'
  );
}

export const INITIAL_OUTSTAND_IMPORT_LIMIT = 100;

/** Only the newly versioned workflow may call this. The legacy activity above
 * remains non-billable, including retries of existing Temporal histories. */
export async function startInitialOutstandImportActivity(siteId: string, accountId: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) {
    throw ApplicationFailure.nonRetryable('Invalid Outstand account ID', 'OUTSTAND_IMPORT_INVALID_INPUT');
  }
  const { data: settings, error: settingsError } = await supabaseAdmin.schema(tenantSchema())
    .from('settings').select('social_media').eq('site_id', siteId).maybeSingle();
  if (settingsError) throw new Error(`Unable to verify initial import ownership: ${settingsError.message}`);
  const account = Array.isArray(settings?.social_media)
    ? settings.social_media.find((entry: any) => entry?.id === accountId &&
      (entry.isActive === true || entry.isActive === 1)) : null;
  const network = normalizeOutstandNetwork(account?.network || account?.platform);
  if (!account || !isImportAccountOwnedBySite(account, settings?.social_media) || !supportsHistoricalImport(network)) {
    return false;
  }


  // The API atomically claims the account before its billable POST, so this
  // activity can safely be retried even if the HTTP response was lost.
  const response = await apiService.post(
    `/api/integrations/outstand/social-accounts/${encodeURIComponent(accountId)}/imports?tenant_id=${encodeURIComponent(siteId)}`,
    { confirm: true, limit: INITIAL_OUTSTAND_IMPORT_LIMIT }
  );
  if (!response.success) {
    throw ApplicationFailure.nonRetryable(
      `Unable to confirm initial import for account ${accountId}: check provider jobs; request may have been accepted`,
      'OUTSTAND_IMPORT_UNCERTAIN'
    );
  }
  // ApiService unwraps { success, data } into response.data.
  if (!response.data?.id || response.data?.status !== 'queued') {
    throw ApplicationFailure.nonRetryable(
      `Unexpected Outstand import response for account ${accountId}`,
      'OUTSTAND_IMPORT_UNCERTAIN'
    );
  }
  return true;
}

export async function recordInitialOutstandImportActivity(
  siteId: string, accountId: string, job: OutstandImportJob
): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId) || !job?.id ||
      !['queued', 'running', 'completed', 'partial', 'failed'].includes(job.status) ||
      (job.socialAccountId && job.socialAccountId !== accountId)) {
    throw ApplicationFailure.nonRetryable('Invalid Outstand import job', 'OUTSTAND_IMPORT_INVALID_INPUT');
  }
  const { data, error } = await supabaseAdmin.schema(tenantSchema()).rpc('record_outstand_initial_import', {
    p_site_id: siteId, p_account_id: accountId, p_status: job.status, p_job_id: job.id,
    p_imported: Number.isInteger(job.imported) ? job.imported : null,
    p_failed: Number.isInteger(job.failed) ? job.failed : null,
  });
  if (error) throw new Error(`Failed to record import job ${job.id}: ${error.message}`);
  if (data !== true) {
    console.warn(`Outstand import job ${job.id} was not recorded for account ${accountId}; check account ownership or job identity`);
  }
  return data === true;
}

export interface OutstandImportJob {
  id: string;
  socialAccountId?: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  imported: number;
  skipped: number;
  failed: number;
  error?: string | null;
}

export async function fetchOutstandImportJobsActivity(siteId: string, accountId: string): Promise<OutstandImportJob[]> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) {
    throw ApplicationFailure.nonRetryable('Invalid Outstand account ID', 'OUTSTAND_IMPORT_INVALID_INPUT');
  }
  const response = await apiService.get(
    `/api/integrations/outstand/social-accounts/${encodeURIComponent(accountId)}/imports?tenant_id=${encodeURIComponent(siteId)}`
  );
  if (!response.success) {
    throw handleOutstandApiError(`fetchOutstandImportJobs for account ${accountId}`, response.error?.message);
  }
  // ApiService unwraps { success, data } API responses automatically.
  const jobs = Array.isArray(response.data) ? response.data : response.data?.data;
  if (!Array.isArray(jobs)) {
    throw new Error(`Invalid Outstand import jobs response for account ${accountId}`);
  }
  return jobs;
}

function historicalImportActivityName(accountId?: string): string {
  // Account IDs are validated against the current, site-owned provider list
  // before a POST. Bound the marker length to the cron_status activity key.
  if (!accountId) return 'outstand_historical_import';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) {
    throw ApplicationFailure.nonRetryable('Invalid Outstand account ID', 'OUTSTAND_IMPORT_INVALID_INPUT');
  }
  return `outstand_historical_import_${accountId}`;
}

export async function checkIfImportTriggeredActivity(siteId: string, accountId?: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .schema(tenantSchema())
    .from('cron_status')
    .select('id')
    .eq('site_id', siteId)
    .eq('activity_name', historicalImportActivityName(accountId))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check historical import status for site ${siteId}: ${error.message}`);
  }

  return !!data;
}

export async function markImportTriggeredActivity(siteId: string, accountId?: string): Promise<void> {
  const { error } = await supabaseAdmin
    .schema(tenantSchema())
    .from('cron_status')
    .upsert(
      {
        site_id: siteId,
        activity_name: historicalImportActivityName(accountId),
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

export async function fetchOutstandPostRepliesActivity(
  siteId: string, postId: string, network: string,
  options?: { username?: string; durableIdentity?: boolean }
): Promise<any> {
  const isLinkedIn = normalizeOutstandNetwork(network) === 'linkedin';
  const requestOptions = isLinkedIn ? { ...options, durableIdentity: true } : options;
  let response;
  try {
    response = await apiService.get(buildOutstandCommentsPath(siteId, postId, network, requestOptions));
  } catch (error) {
    if (isLinkedIn) {
      // Do not attach an upstream body/cause to the durable activity failure.
      throw ApplicationFailure.create({ message: 'LinkedIn comments request failed', type: 'OUTSTAND_COMMENTS_ERROR' });
    }
    throw error;
  }
  if (!response.success) {
    if (isLinkedIn) {
      const status = response.error?.status;
      throw ApplicationFailure.create({
        message: `LinkedIn comments request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`,
        type: 'OUTSTAND_COMMENTS_ERROR',
        nonRetryable: typeof status === 'number' && status >= 400 && status < 500 && status !== 429 && status !== 408,
      });
    }
    throw handleOutstandApiError(`fetchOutstandPostReplies for post ${postId}`, response.error?.message);
  }
  const comments = extractSocialCommentResponse(response);
  // Activity results become durable Temporal history. Do not return LinkedIn
  // profiles even if a provider unexpectedly resolves them without opting in.
  return isLinkedIn
    ? comments.map(durableLinkedInComment) : comments;
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
  // The Outstand analytics endpoint returns { success, post,
  // metrics_by_account, aggregated_metrics } (no `data` property). ApiService
  // wraps that envelope. Never persist zero metrics by treating it as a row.
  const payload = response.data;
  if (payload?.success === false) {
    throw new Error(`Failed to fetch analytics for post ${postId}: ${payload.error || 'Unknown error'}`);
  }
  if (!unwrapAnalytics(payload)?.aggregated_metrics) {
    throw new Error(`Outstand analytics for post ${postId} is missing aggregated_metrics`);
  }
  return payload;
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
    // Deployments may run the worker before the RPC migration has been applied.
    // Restrict the fallback to an absent RPC; other database errors must surface.
    if (error.code !== 'PGRST202' && error.code !== '42883') {
      throw new Error(`Failed to load due social analytics: ${error.message}`);
    }
    console.warn('Social analytics RPC is not installed; using bounded content lookup');
    const { data: contents, error: contentError } = await supabaseAdmin
      .schema(tenantSchema())
      .from('content')
      .select('id, site_id, tags, published_at, status')
      .in('site_id', siteIds)
      .or('status.eq.published,published_at.not.is.null')
      .not('tags', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (contentError) throw new Error(`Failed to load social content: ${contentError.message}`);

    const posts: Array<{ siteId: string; postId: string; contentId: string }> = (contents || []).flatMap((content: any) => {
      return (content.tags || [])
        .filter((value: string) => value.startsWith('outstand_id_') && value.length > 'outstand_id_'.length)
        .map((tag: string) => ({
          siteId: content.site_id,
          postId: tag.slice('outstand_id_'.length),
          contentId: content.id,
        }));
    });
    if (posts.length === 0) return [];

    const { data: snapshots, error: performanceError } = await supabaseAdmin
      .schema(tenantSchema())
      .from('content_performance')
      .select('site_id, outstand_post_id, fetched_at')
      .in('site_id', siteIds)
      .in('outstand_post_id', posts.map((post) => post.postId));
    if (performanceError) throw new Error(`Failed to load social analytics snapshots: ${performanceError.message}`);

    const lastFetched = new Map((snapshots || []).map((snapshot: any) => [
      `${snapshot.site_id}:${snapshot.outstand_post_id}`, snapshot.fetched_at,
    ]));
    const publishedAtByContentId = new Map((contents || []).map((content: any) => [content.id, content.published_at]));
    const nowMs = Date.now();
    return posts.filter((post) => shouldPollPostForAnalytics(
      publishedAtByContentId.get(post.contentId) as string | null,
      nowMs,
      lastFetched.get(`${post.siteId}:${post.postId}`) as string | null
    )).filter((post, index, due) => due.findIndex((candidate) =>
      candidate.siteId === post.siteId && candidate.postId === post.postId
    ) === index).slice(0, limit);
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