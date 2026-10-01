import { createHash } from 'node:crypto';
import { normalizeOutstandNetwork } from '../workflows/helpers/outstandPoll';

export function normalizeOutstandContent(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

export function outstandPostText(post: { id?: unknown; containers?: Array<{ content?: string | null }>; text?: string | null }): string {
  const caption = post.containers?.[0]?.content?.trim() || post.text?.trim();
  return caption || `Social media post ${String(post.id)}`;
}

export function buildOutstandContentHash(text: string): string {
  return createHash('sha256')
    .update(normalizeOutstandContent(text), 'utf8')
    .digest('hex');
}

export function buildOutstandContentExternalId(contentHash: string): string {
  return `outstand:content:${contentHash}`;
}

export function buildOwnedOutstandTags(
  outstandId: string,
  ownedSocialAccounts: any[]
): string[] {
  const tags = ['outstand_only', `outstand_id_${outstandId}`];

  for (const account of ownedSocialAccounts) {
    if (account?.network) {
      tags.push(`published_${account.network}`);
    }
    if (account?.platformPostId) {
      tags.push(`platform_post_id_${account.platformPostId}`);
      tags.push(`platform_post_id_${account.network}_${account.platformPostId}`);
    }
  }

  return [...new Set(tags)];
}

export function mergeOutstandTags(
  existingTags: string[] | null | undefined,
  incomingTags: string[]
): string[] {
  return [...new Set([...(existingTags || []), ...incomingTags])];
}

interface OutstandSocialAccountMetadata {
  outstand_post_id: string;
  account_id: string;
  network: string;
  username?: string;
  nickname?: string;
  platform_post_id?: string;
  platform_post_url?: string;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function metadataIdentifier(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : metadataText(value);
}

function projectOutstandSocialAccount(
  value: unknown,
  outstandId?: string
): OutstandSocialAccountMetadata | null {
  const account = metadataRecord(value);
  const sources = outstandId === undefined
    ? [account]
    : [account, metadataRecord(account.socialAccount || account.social_account)];
  const field = (names: string[], identifier = false): string | undefined => sources
    .flatMap(source => names.map(name => source[name]))
    .map(identifier ? metadataIdentifier : metadataText)
    .find(value => value !== undefined);
  // Match the ID aliases accepted by the ownership helper, without retaining
  // nested provider objects or inventing an account ID from a post ID.
  const accountId = field(outstandId === undefined ? ['account_id'] : [
    'id', 'accountId', 'account_id', 'socialAccountId', 'social_account_id',
    'customer_social_network_id', 'network_unique_id',
  ], true);
  const postId = metadataIdentifier(outstandId ?? account.outstand_post_id);
  const network = normalizeOutstandNetwork(metadataText(account.network));
  if (!postId || !accountId || !network) return null;

  const username = field(['username']);
  const nickname = field(['nickname']);
  const platformPostId = field(['platformPostId', 'platform_post_id'], true);
  const platformPostUrl = field(['platformPostUrl', 'platform_post_url']);
  return {
    outstand_post_id: postId,
    account_id: accountId,
    network,
    ...(username ? { username } : {}),
    ...(nickname ? { nickname } : {}),
    ...(platformPostId ? { platform_post_id: platformPostId } : {}),
    ...(platformPostUrl ? { platform_post_url: platformPostUrl } : {}),
  };
}

function mergeOutstandSocialAccounts(
  existing: unknown,
  outstandId: string,
  ownedSocialAccounts: readonly unknown[]
): OutstandSocialAccountMetadata[] {
  const accounts = new Map<string, OutstandSocialAccountMetadata>();
  const entries = [
    ...(Array.isArray(existing) ? existing : []).map(value => projectOutstandSocialAccount(value)),
    ...ownedSocialAccounts.map(value => projectOutstandSocialAccount(value, outstandId)),
  ];
  for (const entry of entries) {
    if (!entry) continue;
    const key = JSON.stringify([entry.outstand_post_id, entry.account_id, entry.network]);
    // Projection omits empty values, so sparse refreshes cannot erase details.
    accounts.set(key, { ...accounts.get(key), ...entry });
  }
  // Keep serialization stable when a later import fills a previously omitted field.
  return [...accounts.values()].map(account => projectOutstandSocialAccount(account)!);
}

/** Incoming accounts must already be filtered by getOwnedPublishedSocialPostAccounts. */
export function mergeOutstandMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  contentHash: string,
  outstandId: string,
  ownedSocialAccounts: readonly unknown[] = []
): Record<string, unknown> {
  const currentIds = Array.isArray(existingMetadata?.outstand_post_ids)
    ? existingMetadata.outstand_post_ids.filter(
        (value): value is string => typeof value === 'string'
      )
    : [];

  return {
    ...(existingMetadata || {}),
    source: existingMetadata?.source || 'outstand',
    source_content_hash: contentHash,
    outstand_post_ids: [...new Set([...currentIds, outstandId])],
    outstand_social_accounts: mergeOutstandSocialAccounts(
      existingMetadata?.outstand_social_accounts,
      outstandId,
      ownedSocialAccounts
    ),
  };
}
