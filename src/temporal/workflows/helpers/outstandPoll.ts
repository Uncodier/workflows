export const SUPPORTED_COMMENT_NETWORKS = [
  'instagram',
  'facebook',
  'threads',
  'linkedin',
  'x',
  'twitter',
  'youtube',
] as const;

const ACCOUNT_ID_FIELDS = [
  'id',
  'accountId',
  'account_id',
  'socialAccountId',
  'social_account_id',
  'customer_social_network_id',
  'network_unique_id',
] as const;

export interface ConnectedCommentAccount {
  network: string;
  identifiers: string[];
  pageIds: string[];
}

export interface SiteSocialMediaSettings {
  site_id: string;
  social_media: unknown;
}

export interface PostSiteOwnership {
  siteId: string;
  socialAccounts: any[];
}

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

function normalizedIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function accountIdentifiers(account: any): string[] {
  if (!account || typeof account !== 'object') return [];

  const nestedAccount = account.socialAccount || account.social_account;
  const identifiers = ACCOUNT_ID_FIELDS.flatMap((field) => [
    normalizedIdentifier(account[field]),
    normalizedIdentifier(nestedAccount?.[field]),
  ]).filter((value): value is string => Boolean(value));

  return [...new Set(identifiers)];
}

function connectedPageIds(account: any): string[] {
  const pages = account?.connectedPages || account?.connected_pages;
  if (!Array.isArray(pages)) return [];

  return [
    ...new Set(
      pages
        .map((page: any) => normalizedIdentifier(page?.id))
        .filter((value): value is string => Boolean(value))
    ),
  ];
}

function isActiveConnectedAccount(account: any): boolean {
  if (!account || typeof account !== 'object') return false;
  const active = account.isActive === true || account.isActive === 'true';
  return active && (accountIdentifiers(account).length > 0 || connectedPageIds(account).length > 0);
}

export function getConnectedCommentAccounts(
  socialMedia: unknown
): ConnectedCommentAccount[] {
  if (!Array.isArray(socialMedia)) return [];

  return socialMedia.flatMap((account: any) => {
    const network = normalizeOutstandNetwork(account?.network || account?.platform);
    if (
      !network ||
      !SUPPORTED_COMMENT_NETWORKS.includes(
        network as (typeof SUPPORTED_COMMENT_NETWORKS)[number]
      ) ||
      !isActiveConnectedAccount(account)
    ) {
      return [];
    }

    return [{
      network,
      identifiers: accountIdentifiers(account),
      pageIds: connectedPageIds(account),
    }];
  });
}

/** Only import history for accounts actually connected to this site. The
 * Outstand accounts endpoint can return accounts from the shared organization.
 */
export function isImportAccountOwnedBySite(
  account: any,
  socialMedia: unknown
): boolean {
  if (!account || account.isActive === false || account.isActive === 'false') return false;
  const network = normalizeOutstandNetwork(account.network || account.platform);
  const ids = accountIdentifiers(account);
  const pages = connectedPageIds(account);
  if (!network || !normalizedIdentifier(account.id)) return false;

  return getConnectedCommentAccounts(socialMedia).some((connected) =>
    connected.network === network && (
      connected.identifiers.some((identifier) => ids.includes(identifier)) ||
      connected.pageIds.some((pageId) => pages.includes(pageId))
    )
  );
}

function platformPostBelongsToPage(platformPostId: unknown, pageId: string): boolean {
  const normalizedPostId = normalizedIdentifier(platformPostId);
  if (!normalizedPostId) return false;

  return normalizedPostId === pageId || normalizedPostId.startsWith(`${pageId}_`);
}

export function isPostAccountOwnedBySite(
  postAccount: any,
  connectedAccounts: ConnectedCommentAccount[]
): boolean {
  const network = normalizeOutstandNetwork(postAccount?.network);
  if (!network) return false;

  const postIdentifiers = new Set(accountIdentifiers(postAccount));
  const platformPostId =
    postAccount?.platformPostId
    || postAccount?.platform_post_id
    || postAccount?.socialAccount?.platformPostId
    || postAccount?.social_account?.platform_post_id;

  return connectedAccounts.some((connectedAccount) => {
    if (connectedAccount.network !== network) return false;

    const identifierMatch = connectedAccount.identifiers.some((identifier) =>
      postIdentifiers.has(identifier)
    );
    const pageMatch = connectedAccount.pageIds.some((pageId) =>
      platformPostBelongsToPage(platformPostId, pageId)
    );

    return identifierMatch || pageMatch;
  });
}

export function getOwnedPublishedCommentAccounts(
  post: any,
  socialMedia: unknown
): any[] {
  const connectedAccounts = getConnectedCommentAccounts(socialMedia);
  if (connectedAccounts.length === 0) return [];

  return (post?.socialAccounts || []).filter(
    (account: any) =>
      account?.network &&
      SUPPORTED_COMMENT_NETWORKS.includes(account.network.toLowerCase()) &&
      isAccountPublished(account) &&
      isPostAccountOwnedBySite(account, connectedAccounts)
  );
}

// Preserve the pre-patch mapping for Temporal histories without the strict
// ownership marker. Changing this branch changes their activity sequence.
export function getPostSiteOwnerships(
  post: any,
  sites: SiteSocialMediaSettings[]
): PostSiteOwnership[] {
  return sites.flatMap((site) => {
    const socialAccounts = getOwnedPublishedCommentAccounts(
      post,
      site.social_media
    );

    return socialAccounts.length > 0
      ? [{ siteId: site.site_id, socialAccounts }]
      : [];
  });
}

export function getUnambiguousPostSiteOwnerships(
  post: any,
  sites: SiteSocialMediaSettings[]
): PostSiteOwnership[] {
  // A shared organization must not turn a multiply-configured account into a
  // post for every site. Ambiguous ownership is unsafe; skip those accounts.
  const ownedAccounts = new Map<string, any[]>();
  for (const account of post?.socialAccounts || []) {
    if (!account?.network || !isAccountPublished(account)) continue;
    const owners = sites.filter((site) =>
      getOwnedPublishedCommentAccounts({ socialAccounts: [account] }, site.social_media).length > 0
    );
    if (owners.length !== 1) continue;
    const siteId = owners[0].site_id;
    ownedAccounts.set(siteId, [...(ownedAccounts.get(siteId) || []), account]);
  }
  return [...ownedAccounts].map(([siteId, socialAccounts]) => ({ siteId, socialAccounts }));
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
  if (!publishedAtStr) {
    if (!lastFetchedAtStr) return true;
    const lastFetchedAt = new Date(lastFetchedAtStr).getTime();
    if (!Number.isFinite(lastFetchedAt)) return true;
    return nowMs - lastFetchedAt >= 6 * 60 * 60 * 1000;
  }

  const publishedAt = new Date(publishedAtStr).getTime();
  if (!Number.isFinite(publishedAt)) return true;
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
  nowMs: number,
  useFiveMinuteBuckets = true
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

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const currentPollBucket = Math.floor(nowMs / FIVE_MINUTES_MS);
  const currentHour = new Date(nowMs).getUTCHours();

  // The workflow runs every five minutes. Match one five-minute bucket per
  // interval instead of polling on every run throughout the matching hour.
  if (ageInDays <= 7) {
    if (!useFiveMinuteBuckets) {
      return { shouldPoll: currentHour % 6 === 0, isTooOld: false };
    }
    const sixHourBuckets = (6 * 60) / 5;
    return {
      shouldPoll: currentPollBucket % sixHourBuckets === 0,
      isTooOld: false,
    };
  }

  const dailyBuckets = (24 * 60) / 5;
  if (!useFiveMinuteBuckets) {
    return { shouldPoll: currentHour === 0, isTooOld: false };
  }
  return {
    shouldPoll: currentPollBucket % dailyBuckets === 0,
    isTooOld: false,
  };
}
