"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSitesWithSocialCommentsActivity = fetchSitesWithSocialCommentsActivity;
exports.fetchOutstandPostsActivity = fetchOutstandPostsActivity;
exports.fetchOutstandPostRepliesActivity = fetchOutstandPostRepliesActivity;
exports.submitCustomerSupportMessageActivity = submitCustomerSupportMessageActivity;
exports.fetchOutstandPostAnalyticsActivity = fetchOutstandPostAnalyticsActivity;
exports.fetchSocialPostsDueForAnalyticsActivity = fetchSocialPostsDueForAnalyticsActivity;
exports.upsertContentPerformanceActivity = upsertContentPerformanceActivity;
exports.upsertContentFromOutstandPostActivity = upsertContentFromOutstandPostActivity;
const apiService_1 = require("../services/apiService");
const client_1 = require("../../lib/supabase/client");
function tenantSchema() {
    return process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public';
}
function extractOutstandPostId(tags) {
    const tag = (tags || []).find((t) => typeof t === 'string' && t.startsWith('outstand_id_'));
    return tag ? tag.replace('outstand_id_', '') : null;
}
function unwrapAnalytics(payload) {
    if (payload?.aggregated_metrics)
        return payload;
    if (payload?.data?.aggregated_metrics)
        return payload.data;
    return payload;
}
function normalizeMetricsByAccount(byAccount) {
    if (!Array.isArray(byAccount))
        return [];
    return byAccount.map((acc) => {
        const metrics = acc?.metrics || acc || {};
        return {
            network: acc?.social_account?.network || acc?.network || null,
            username: acc?.social_account?.username || acc?.username || null,
            nickname: acc?.social_account?.nickname || acc?.nickname || null,
            likes: metrics.likes || 0,
            comments: metrics.comments || 0,
            shares: metrics.shares || 0,
            views: metrics.views || 0,
            impressions: metrics.impressions || 0,
            reach: metrics.reach || 0,
            engagement_rate: metrics.engagement_rate || 0,
        };
    });
}
async function fetchSitesWithSocialCommentsActivity() {
    const { data, error } = await client_1.supabaseServiceRole
        .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
        .from('settings')
        .select('site_id, social_media, channels');
    if (error) {
        throw new Error(`Failed to fetch sites: ${error.message}`);
    }
    return (data || []).filter(setting => {
        // Only sites that have outstand accounts connected
        if (!setting.social_media || !Array.isArray(setting.social_media) || setting.social_media.length === 0) {
            return false;
        }
        // and maybe some specific comments_inbox flag if exists, for now all with social media
        return true;
    }).map(s => ({ site_id: s.site_id, social_media: s.social_media }));
}
async function fetchOutstandPostsActivity(siteId, limit = 100, offset = 0) {
    const response = await apiService_1.apiService.get(`/api/integrations/outstand/posts?tenant_id=${siteId}&limit=${limit}&offset=${offset}`);
    if (!response.success) {
        throw new Error(`Failed to fetch outstand posts: ${response.error?.message}`);
    }
    return response.data;
}
async function fetchOutstandPostRepliesActivity(siteId, postId) {
    const response = await apiService_1.apiService.get(`/api/integrations/outstand/posts/${postId}/comments?tenant_id=${siteId}`);
    if (!response.success) {
        throw new Error(`Failed to fetch outstand post replies for post ${postId}: ${response.error?.message}`);
    }
    return response.data;
}
async function submitCustomerSupportMessageActivity(payload) {
    const response = await apiService_1.apiService.post(`/api/agents/customerSupport/message`, payload);
    if (!response.success) {
        throw new Error(`Failed to submit customer support message: ${response.error?.message}`);
    }
    return response.data;
}
async function fetchOutstandPostAnalyticsActivity(siteId, postId) {
    const response = await apiService_1.apiService.get(`/api/integrations/outstand/posts/${postId}/analytics?tenant_id=${siteId}`);
    if (!response.success) {
        throw new Error(`Failed to fetch outstand post analytics for post ${postId}: ${response.error?.message}`);
    }
    return response.data;
}
async function fetchSocialPostsDueForAnalyticsActivity(siteId) {
    const schema = tenantSchema();
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: snapshots, error: snapshotError } = await client_1.supabaseServiceRole
        .schema(schema)
        .from('content_performance')
        .select('outstand_post_id, content_id, fetched_at')
        .eq('site_id', siteId);
    if (snapshotError) {
        throw new Error(`Failed to load performance snapshots: ${snapshotError.message}`);
    }
    const recent = new Set((snapshots || [])
        .filter((row) => row.fetched_at && row.fetched_at > sixHoursAgo)
        .map((row) => row.outstand_post_id));
    const { data: contents, error: contentError } = await client_1.supabaseServiceRole
        .schema(schema)
        .from('content')
        .select('id, tags')
        .eq('site_id', siteId)
        .not('tags', 'is', null);
    if (contentError) {
        throw new Error(`Failed to load social content: ${contentError.message}`);
    }
    const due = new Map();
    for (const row of snapshots || []) {
        if (!row.outstand_post_id || recent.has(row.outstand_post_id))
            continue;
        due.set(row.outstand_post_id, row.content_id || null);
    }
    for (const content of contents || []) {
        const postId = extractOutstandPostId(content.tags);
        if (!postId || recent.has(postId))
            continue;
        if (!due.has(postId) || !due.get(postId)) {
            due.set(postId, content.id);
        }
    }
    return Array.from(due.entries()).map(([postId, contentId]) => ({ postId, contentId }));
}
async function upsertContentPerformanceActivity(siteId, postId, analytics, contentId) {
    try {
        let resolvedContentId = contentId ?? null;
        if (!resolvedContentId) {
            const { data: existing } = await client_1.supabaseServiceRole
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
        const upsertData = {
            site_id: siteId,
            outstand_post_id: postId,
            content_id: resolvedContentId,
            likes: aggregated.total_likes || 0,
            comments: aggregated.total_comments || 0,
            shares: aggregated.total_shares || 0,
            views: aggregated.total_views || 0,
            impressions: aggregated.total_impressions || 0,
            reach: aggregated.total_reach || 0,
            engagement_rate: aggregated.average_engagement_rate || 0,
            metrics_by_account: normalizeMetricsByAccount(metrics?.metrics_by_account || []),
            fetched_at: new Date().toISOString(),
        };
        const { error } = await client_1.supabaseServiceRole
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
    }
    catch (error) {
        console.error(`[upsertContentPerformanceActivity] Exception processing performance for post ${postId}:`, error);
        throw error;
    }
}
async function upsertContentFromOutstandPostActivity(siteId, post) {
    const outstandId = post.id;
    if (!outstandId)
        return null;
    try {
        // 1. Check if it already exists (same as resolveContentIdForOutstandPostActivity)
        const { data: existing, error: searchError } = await client_1.supabaseServiceRole
            .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
            .from('content')
            .select('id')
            .eq('site_id', siteId)
            .contains('tags', [`outstand_id_${outstandId}`])
            .limit(1)
            .maybeSingle();
        if (searchError) {
            console.error(`[upsertContentFromOutstandPost] Error finding content for post ${outstandId}:`, searchError);
            return null;
        }
        if (existing?.id) {
            return existing.id;
        }
        // 2. If it doesn't exist, build and insert the content
        const postText = post.containers?.[0]?.content || post.text || "";
        if (!postText)
            return null;
        const platforms = post.socialAccounts?.map((a) => a.network || (typeof a === "string" ? a : null)).filter(Boolean) || [];
        const publishedTags = platforms.map((p) => `published_${p}`);
        // Some basic platform post IDs if outstand provides them at the root level
        const platformPostTags = [];
        post.socialAccounts?.forEach((acc) => {
            if (acc.platformPostId) {
                platformPostTags.push(`platform_post_id_${acc.platformPostId}`);
                platformPostTags.push(`platform_post_id_${acc.network}_${acc.platformPostId}`);
            }
        });
        const tags = ["outstand_only", `outstand_id_${outstandId}`, ...publishedTags, ...platformPostTags];
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
            word_count: postText.split(" ").length,
            estimated_reading_time: 1,
        };
        const { data: inserted, error: insertError } = await client_1.supabaseServiceRole
            .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
            .from('content')
            .insert([insertData])
            .select('id')
            .single();
        if (insertError) {
            console.error(`[upsertContentFromOutstandPost] Error inserting content for post ${outstandId}:`, insertError);
            return null;
        }
        return inserted?.id || null;
    }
    catch (error) {
        console.error(`[upsertContentFromOutstandPost] Exception processing post ${outstandId}:`, error);
        return null;
    }
}
