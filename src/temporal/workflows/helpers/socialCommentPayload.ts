import { buildSocialCommentExternalId, normalizeOutstandNetwork } from './outstandPoll';

export interface SocialCommentCandidate {
  comment: any;
  commentId: string;
  commentText: string;
  origin: string;
  stableCommentId: string;
  externalId: string;
  handle: string;
  authorId: string;
  authorName?: string;
  profileUrl: string;
  platformCommentId: unknown;
}

/** The legacy mapping remains unchanged for replay of existing histories. */
export function socialCommentCandidates(comments: any[], network: string, normalized = false) {
  const candidates = new Map<string, SocialCommentCandidate>();
  for (const comment of comments) {
    if (normalized && (!comment || typeof comment !== 'object')) throw new Error('Invalid social comment');
    const commentText = comment.text || comment.message || '';
    const commentId = comment.id || comment.reply_id;
    if (!commentText || !commentId) {
      if (normalized) throw new Error('Social comment is missing text or identity');
      continue;
    }
    const commentNetwork = (comment.network || comment.account?.network || network || 'social').toLowerCase();
    if (normalizeOutstandNetwork(commentNetwork) !== network) {
      if (normalized) throw new Error('Social comment network does not match the owned account');
      continue;
    }
    const author = (typeof comment.author === 'object' && comment.author) ||
      (typeof comment.from === 'object' && comment.from) ||
      (typeof comment.user === 'object' && comment.user) || {};
    const rawAuthorId = typeof comment.author === 'string' ? comment.author :
      typeof comment.from === 'string' ? comment.from : '';
    const legacyHandle = comment.username || comment.authorName || author.username ||
      author.name || comment.accountUsername || rawAuthorId || '';
    const handle = normalized
      ? comment.author_username || comment.username || author.username || ''
      : legacyHandle;
    const authorName = normalized
      ? comment.author_name || comment.authorName || author.name || handle || 'Social User'
      : undefined;
    const authorId = String(comment.author_id || comment.authorId || author.id || rawAuthorId || '');
    const profileUrl = (normalized && comment.author_profile_url) || comment.author_url ||
      comment.authorUrl || author.url || author.profileUrl || author.profile_url || '';
    const platformCommentId = comment.platform_specific?.commentUrn || comment.platform_specific?.id;
    const origin = commentNetwork === 'twitter' ? 'x' : commentNetwork;
    const stableCommentId = String(platformCommentId || commentId);
    const externalId = buildSocialCommentExternalId(origin, stableCommentId);
    candidates.set(externalId, {
      comment, commentId: String(commentId), commentText, origin, stableCommentId,
      externalId, handle, authorId, profileUrl, platformCommentId,
      ...(normalized ? { authorName } : {}),
    });
  }
  return candidates;
}