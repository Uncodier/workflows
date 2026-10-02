import { normalizeOutstandNetwork } from './outstandPoll';

export interface SocialCommentScope {
  siteId: string;
  postId: string;
  network: string;
  accountId: string;
}

export function commentScopeKey(scope: SocialCommentScope, purpose = 'sync'): string {
  const parts = [scope.siteId, normalizeOutstandNetwork(scope.network), scope.accountId, scope.postId];
  if (parts.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Social comment scope requires site, network, owned account and post');
  }
  return `outstand-comment-${purpose}:v2:${JSON.stringify(parts)}`;
}

export function scopedCommentExternalId(scope: SocialCommentScope, commentId: string): string {
  if (!commentId.trim()) throw new Error('Social comment ID is required');
  return `${commentScopeKey(scope, 'claim')}:${JSON.stringify(commentId)}`;
}

export function commentAccountBoundaryKey(scope: SocialCommentScope): string {
  commentScopeKey(scope);
  return `outstand-comment-account-boundary:v2:${JSON.stringify([scope.siteId, scope.network, scope.accountId])}`;
}

/** A fixed rollout boundary, not a moving high-water mark: delayed comments remain eligible. */
export function commentsAfterBoundary(comments: any[], boundary: string): any[] {
  const since = Date.parse(boundary);
  if (!Number.isFinite(since)) throw new Error('Invalid social comment ingestion boundary');
  return comments.filter(comment => {
    const created = typeof comment?.created_at === 'string' ? Date.parse(comment.created_at) : NaN;
    if (!Number.isFinite(created)) {
      throw new Error('Cannot safely ingest comment without a valid created_at; historical replay is disabled');
    }
    return created >= since;
  });
}