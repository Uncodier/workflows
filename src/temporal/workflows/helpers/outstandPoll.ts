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
