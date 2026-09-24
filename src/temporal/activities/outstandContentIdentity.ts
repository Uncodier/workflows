import { createHash } from 'node:crypto';

export function normalizeOutstandContent(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
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

export function mergeOutstandMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  contentHash: string,
  outstandId: string
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
  };
}
