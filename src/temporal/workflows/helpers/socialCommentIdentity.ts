/** Provider identity only. Never use the account that published the post as its commenter. */
function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readable(value: unknown): string {
  const result = text(value);
  return /^(?:social user|unknown|anonymous)$/i.test(result)
    || /^(?:urn:|https?:\/\/)/i.test(result) || /^\d+$/.test(result)
    ? '' : result;
}

function first(values: unknown[], normalize = text): string {
  return values.map(normalize).find(Boolean) || '';
}

function stableId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return text(value);
}

export function resolveSocialCommentIdentity(comment: Record<string, any>, network: string) {
  const platform = record(comment.platform_specific);
  const authors = [comment.author, comment.from, comment.user, platform.from, platform.user].map(record);
  const authorId = first([
    comment.author_id, comment.authorId, ...authors.map(author => author.id),
    platform.actor,
    ...[comment.author, comment.from].filter(value => /^(urn:|\d+$)/.test(text(value))),
  ], stableId);

  // Resolved LinkedIn profiles cannot be retained in Temporal history or leads.
  // The comments read API can resolve this reference on demand for presentation.
  if (network === 'linkedin') {
    return { authorId, authorName: '', handle: '', profileUrl: '' };
  }

  const stringAuthor = readable(comment.author);
  // Facebook's textual author is a display name, not a username. Only networks
  // whose textual author is a handle may use that field as a social identity.
  const handleNetwork = ['instagram', 'threads', 'x', 'twitter', 'bluesky'].includes(network);
  const handle = first([
    comment.author_username, comment.username, ...authors.map(author => author.username),
    ...(handleNetwork ? [stringAuthor] : []),
  ], value => {
    // An explicit username may be all digits. Only the ambiguous textual
    // author fallback above excludes numeric IDs before reaching this point.
    const candidate = text(value).replace(/^@/, '');
    return /^[\p{L}\p{N}_.-]+$/u.test(candidate) && !/^(unknown|anonymous)$/i.test(candidate)
      ? candidate : '';
  });
  const authorName = first([
    comment.author_name, comment.authorName, ...authors.map(author => author.name),
    stringAuthor, handle,
  ], readable);
  const profileUrl = first([
    comment.author_profile_url, comment.author_url, comment.authorUrl,
    ...authors.flatMap(author => [author.url, author.profileUrl, author.profile_url]),
  ], value => {
    const candidate = text(value);
    return /^https?:\/\//i.test(candidate) ? candidate : '';
  });
  return { authorId, authorName, handle, profileUrl };
}

/** Whitelist before the activity returns: removing fields inside a workflow is too late. */
export function durableLinkedInComment(value: unknown): Record<string, unknown> {
  const comment = record(value);
  const platform = record(comment.platform_specific);
  const { authorId } = resolveSocialCommentIdentity(comment, 'linkedin');
  const durable: Record<string, unknown> = {};
  for (const key of [
    'id', 'reply_id', 'platform_comment_id', 'text', 'message', 'network', 'created_at', 'like_count',
    'platformPostId', 'platform_post_id', 'platformPostUrl', 'platform_post_url',
    'parentCommentId', 'parent_comment_id', 'rootCommentId', 'root_comment_id',
  ]) {
    if (typeof comment[key] === 'string' || typeof comment[key] === 'number') {
      durable[key] = comment[key];
    }
  }
  // Keep network evidence used by the workflow's ownership/network guard,
  // without returning the rest of the provider account object.
  const network = comment.network || record(comment.account).network;
  if (typeof network === 'string') durable.network = network;
  if (authorId) durable.author_id = authorId;
  const platformIdentity: Record<string, unknown> = {};
  for (const key of ['id', 'commentUrn']) {
    if (typeof platform[key] === 'string' || typeof platform[key] === 'number') {
      platformIdentity[key] = platform[key];
    }
  }
  durable.platform_specific = platformIdentity;
  if (Array.isArray(comment.replies)) durable.replies = comment.replies.map(durableLinkedInComment);
  return durable;
}