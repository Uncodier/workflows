export const SUPPORTED_COMMENT_NETWORKS = [
  'instagram',
  'facebook',
  'threads',
  'linkedin',
  'x',
  'twitter',
  'youtube',
] as const;

/**
 * Normalizes a network string for the Outstand API.
 * e.g., 'twitter' -> 'x'
 */
export function normalizeOutstandNetwork(network?: string | null): string {
  if (!network) return '';
  const normalized = network.toLowerCase().trim();
  if (normalized === 'twitter') return 'x';
  return normalized;
}

export function buildSocialCommentExternalId(
  network: string,
  commentId: string
): string {
  return `outstand:${normalizeOutstandNetwork(network)}:${commentId.trim()}`;
}

export function buildSocialPostExternalId(postId: string): string {
  return `outstand:${postId.trim()}`;
}

export function buildSocialCommentWorkflowId(
  siteId: string,
  network: string,
  commentId: string
): string {
  const externalId = buildSocialCommentExternalId(network, commentId);
  const rawId = `social-comment-${siteId}-${externalId}`;
  const sanitizedId = rawId.replace(/[^a-zA-Z0-9._-]/g, '_');

  if (sanitizedId.length <= 240) {
    return sanitizedId;
  }

  let hash = 2166136261;
  for (let index = 0; index < rawId.length; index += 1) {
    hash ^= rawId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${sanitizedId.slice(0, 230)}-${(hash >>> 0).toString(36)}`;
}

/**
 * Checks if a social account within an Outstand post is published.
 */
export function isAccountPublished(account: any): boolean {
  if (!account) return false;
  if (account.status === 'published') return true;
  if (account.publishedAt) return true;
  if (account.platformPostId) return true;
  return false;
}

export function isOutstandDraftPost(post: any): boolean {
  return Boolean(post?.isDraft || post?.status === 'draft');
}

export function getPublishedCommentNetworks(post: any): string[] {
  const socialAccounts = post?.socialAccounts || [];
  const networks = socialAccounts
    .filter(
      (acc: any) =>
        acc?.network &&
        SUPPORTED_COMMENT_NETWORKS.includes(acc.network.toLowerCase()) &&
        isAccountPublished(acc)
    )
    .map((acc: any) => normalizeOutstandNetwork(acc.network));

  return [...new Set(networks.filter(Boolean))] as string[];
}

export function buildOutstandCommentsPath(
  siteId: string,
  postId: string,
  network: string
): string {
  const normalizedNetwork = normalizeOutstandNetwork(network);
  const params = new URLSearchParams({
    tenant_id: siteId,
    network: normalizedNetwork,
  });
  return `/api/integrations/outstand/posts/${encodeURIComponent(postId)}/comments?${params.toString()}`;
}

export function isPublishedContentForAnalytics(content: {
  status?: string | null;
  published_at?: string | null;
}): boolean {
  return content.status === 'published' || Boolean(content.published_at);
}

export function shouldPollPostForAnalytics(
  publishedAtStr: string | null | undefined,
  nowMs: number,
  lastFetchedAtStr?: string | null
): boolean {
  if (!publishedAtStr) return true;

  const publishedAt = new Date(publishedAtStr).getTime();
  const ageMs = nowMs - publishedAt;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ageInDays = ageMs / ONE_DAY;

  // Stop polling posts older than 30 days
  if (ageInDays > 30) {
    return false;
  }

  // If we never fetched, fetch it
  if (!lastFetchedAtStr) return true;
  
  const lastFetchedAt = new Date(lastFetchedAtStr).getTime();
  const hoursSinceLastFetch = (nowMs - lastFetchedAt) / (60 * 60 * 1000);

  if (ageInDays <= 1) {
    // Poll every 6 hours
    return hoursSinceLastFetch >= 6;
  } else if (ageInDays <= 7) {
    // Poll every 12 hours
    return hoursSinceLastFetch >= 12;
  } else {
    // 7-30 days: poll every 24 hours
    return hoursSinceLastFetch >= 24;
  }
}

export function isOutstandClientError(message?: string | null): boolean {
  if (!message) return false;
  return (
    message.includes('400 Bad Request') ||
    message.includes('404 Not Found') ||
    message.includes('Post is not published') ||
    message.includes('"path":["network"]')
  );
}

export function extractOutstandPostText(post: any): string {
  return post?.containers?.[0]?.content || post?.text || '';
}

/**
 * Determines if we should poll a post based on its publication date.
 * Returns shouldPoll (whether to poll this run) and isTooOld (whether the post is older than 30 days).
 */
export function shouldPollPostForComments(
  post: any,
  nowMs: number
): { shouldPoll: boolean; isTooOld: boolean } {
  const publishedAtStr = post?.publishedAt || post?.createdAt;
  if (!publishedAtStr) return { shouldPoll: true, isTooOld: false };

  const publishedAt = new Date(publishedAtStr).getTime();
  const ageMs = nowMs - publishedAt;

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ageInDays = ageMs / ONE_DAY;

  // Stop polling posts older than 30 days
  if (ageInDays > 30) {
    return { shouldPoll: false, isTooOld: true };
  }

  // < 1 day old: always poll
  if (ageInDays <= 1) {
    return { shouldPoll: true, isTooOld: false };
  }

  const currentHour = new Date(nowMs).getUTCHours();

  // 1 to 7 days old: poll every 6 hours (0, 6, 12, 18)
  if (ageInDays <= 7) {
    return { shouldPoll: currentHour % 6 === 0, isTooOld: false };
  }

  // 7 to 30 days old: poll every 24 hours (at 0 UTC)
  return { shouldPoll: currentHour === 0, isTooOld: false };
}
