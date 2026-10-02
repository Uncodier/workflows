const mockDatabase = { schema: jest.fn(), from: jest.fn() };
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: mockDatabase }));

import {
  assertSocialCommentPersistedActivity,
  getSocialCommentSyncStatesActivity,
  hasSocialCommentPersistedActivity,
  recordSocialCommentSyncSuccessActivity,
  verifySocialCommentIngestionActivity,
} from '../src/temporal/activities/socialCommentSyncActivities';

function queueQuery(data: unknown = [], error: unknown = null) {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  mockDatabase.from.mockReturnValueOnce(query);
  return query;
}

const siteId = 'site-1';
const externalId = 'outstand:instagram:comment-1';
const now = '2026-09-29T01:20:00.000Z';
const completed = (id: string) => ({ external_id: id, status: 'completed' });
const persisted = (id: string) => ({
  custom_data: { origin_message_id: id, source: 'comment' },
  conversations: { site_id: siteId },
});
const state = (postId: string, network = 'instagram') => ({
  outstand_post_id: postId, network, last_success_at: now,
});
const originalSchema = process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA;
const originalFallbackSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;

beforeEach(() => {
  jest.resetAllMocks();
  mockDatabase.schema.mockReturnValue(mockDatabase);
  mockDatabase.from.mockImplementation(() => { throw new Error('Unexpected database call'); });
  delete process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA;
  delete process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
});

afterEach(() => {
  jest.useRealTimers();
  if (originalSchema === undefined) delete process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA;
  else process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA = originalSchema;
  if (originalFallbackSchema === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  else process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = originalFallbackSchema;
});

describe('durable comment polling state', () => {
  it('returns no state for an empty post list without querying', async () => {
    await expect(getSocialCommentSyncStatesActivity(siteId, [])).resolves.toEqual([]);
    expect(mockDatabase.from).not.toHaveBeenCalled();
  });

  it('scopes state reads to the site and returns canonical networks', async () => {
    const query = queueQuery([state('post-1', ' Twitter ')]);
    await expect(getSocialCommentSyncStatesActivity(siteId, ['post-1', 'post-1'])).resolves.toEqual([
      { postId: 'post-1', network: 'x', lastSuccessAt: now },
    ]);
    expect(mockDatabase.schema).toHaveBeenCalledWith('public');
    expect(mockDatabase.from).toHaveBeenCalledWith('social_comment_sync_state');
    expect(query.select).toHaveBeenCalledWith('outstand_post_id, network, last_success_at');
    expect(query.eq).toHaveBeenCalledWith('site_id', siteId);
    expect(query.in).toHaveBeenCalledWith('outstand_post_id', ['post-1']);
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it('chunks post IDs at 100 and does not invent states for absent rows', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `post-${i}`);
    const queries = [queueQuery([state(ids[0])]), queueQuery([]), queueQuery([state(ids[200])])];
    await expect(getSocialCommentSyncStatesActivity(siteId, ids)).resolves.toHaveLength(2);
    queries.forEach((query, index) => {
      expect(query.in).toHaveBeenCalledWith('outstand_post_id', ids.slice(index * 100, index * 100 + 100));
      expect(query.eq).toHaveBeenCalledWith('site_id', siteId);
    });
    expect(mockDatabase.from).toHaveBeenCalledTimes(3);
  });

  it('pages state rows because one post may have multiple networks', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => state(`post-${Math.floor(i / 2)}`, i % 2 ? 'x' : 'instagram'));
    const first = queueQuery(rows.slice(0, 100));
    const second = queueQuery(rows.slice(100));
    await expect(getSocialCommentSyncStatesActivity(siteId, [...new Set(rows.map(row => row.outstand_post_id))])).resolves.toHaveLength(101);
    expect(first.range).toHaveBeenCalledWith(0, 99);
    expect(second.range).toHaveBeenCalledWith(100, 199);
    for (const query of [first, second]) {
      expect(query.order.mock.calls).toEqual([
        ['outstand_post_id', { ascending: true }], ['network', { ascending: true }],
      ]);
      expect(query.eq).toHaveBeenCalledWith('site_id', siteId);
    }
  });

  it('fails closed when a later state read fails', async () => {
    queueQuery([state('post-0')]);
    queueQuery(null, { message: 'state unavailable' });
    const ids = Array.from({ length: 101 }, (_, i) => `post-${i}`);
    await expect(getSocialCommentSyncStatesActivity(siteId, ids)).rejects.toThrow('state unavailable');
  });

  it('does not interpret an invalid state response as a first sync', async () => {
    queueQuery(null);
    await expect(getSocialCommentSyncStatesActivity(siteId, ['post-1'])).rejects.toThrow('Invalid social comment sync state response');
  });

  it('writes only the trusted key and activity-server timestamp with an upsert', async () => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    const query = queueQuery(null);
    await recordSocialCommentSyncSuccessActivity(siteId, 'post-1', ' Twitter ');
    expect(mockDatabase.from).toHaveBeenCalledWith('social_comment_sync_state');
    expect(query.upsert).toHaveBeenCalledWith({
      site_id: siteId, outstand_post_id: 'post-1', network: 'x', last_success_at: now,
    }, { onConflict: 'site_id,outstand_post_id,network' });
    expect(query.select).not.toHaveBeenCalled();
  });

  it('uses the configured tenant schema consistently for state reads and writes', async () => {
    process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA = 'tenant_app';
    queueQuery([]);
    queueQuery(null);
    await getSocialCommentSyncStatesActivity(siteId, ['post-1']);
    await recordSocialCommentSyncSuccessActivity(siteId, 'post-1', 'instagram');
    expect(mockDatabase.schema.mock.calls).toEqual([['tenant_app'], ['tenant_app']]);
  });

  it('propagates failed checkpoint writes so callers cannot report success', async () => {
    queueQuery(null, { message: 'write rejected' });
    await expect(recordSocialCommentSyncSuccessActivity(siteId, 'post-1', 'instagram')).rejects.toThrow('write rejected');
  });
});

describe('persisted social comment assertion', () => {
  it('requires an actual user/comment message in the requested site', async () => {
    const query = queueQuery([{ id: 'message-1', conversations: { site_id: siteId } }]);
    await expect(assertSocialCommentPersistedActivity(siteId, externalId)).resolves.toBeUndefined();
    expect(mockDatabase.from).toHaveBeenCalledWith('messages');
    expect(query.select).toHaveBeenCalledWith('id, conversations!inner(site_id)');
    expect(query.eq.mock.calls).toEqual([
      ['conversations.site_id', siteId], ['role', 'user'],
      ['custom_data->>origin_message_id', externalId], ['custom_data->>source', 'comment'],
    ]);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it.each([{ data: [] }, { data: [{}] }])('rejects a missing persisted message (%j)', async ({ data }) => {
    queueQuery(data);
    await expect(assertSocialCommentPersistedActivity(siteId, externalId)).rejects.toThrow('not persisted');
  });

  it('fails on a query error even when data is present', async () => {
    queueQuery([{ id: 'message-1' }], { message: 'lookup failed' });
    await expect(assertSocialCommentPersistedActivity(siteId, externalId)).rejects.toThrow('lookup failed');
  });

  it('returns true for an existing comment to avoid repeated ingestion side effects', async () => {
    queueQuery([{ id: 'message-1' }]);
    await expect(hasSocialCommentPersistedActivity(siteId, externalId)).resolves.toBe(true);
  });

  it('returns false only when the scoped persisted-message lookup succeeds without a match', async () => {
    queueQuery([]);
    await expect(hasSocialCommentPersistedActivity(siteId, externalId)).resolves.toBe(false);
  });

  it('does not swallow query failures or malformed data in the boolean helper', async () => {
    queueQuery(null, { message: 'lookup unavailable' });
    await expect(hasSocialCommentPersistedActivity(siteId, externalId)).rejects.toThrow('lookup unavailable');
    queueQuery(null);
    await expect(hasSocialCommentPersistedActivity(siteId, externalId)).rejects.toThrow('Invalid persisted social comment');
    queueQuery(null);
    await expect(assertSocialCommentPersistedActivity(siteId, externalId)).rejects.toThrow('Invalid persisted social comment');
  });

  it('uses the configured tenant schema for persisted messages', async () => {
    process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA = 'tenant_app';
    queueQuery([{ id: 'message-1' }]);
    await assertSocialCommentPersistedActivity(siteId, externalId);
    expect(mockDatabase.schema).toHaveBeenCalledWith('tenant_app');
  });
});

describe('batch ingestion verification', () => {
  it('is a no-op for an empty comment batch', async () => {
    await expect(verifySocialCommentIngestionActivity(siteId, [])).resolves.toBeUndefined();
    expect(mockDatabase.from).not.toHaveBeenCalled();
  });

  it('deduplicates requests but verifies both completion and persistence', async () => {
    const ledger = queueQuery([completed(externalId)]);
    const messages = queueQuery([persisted(externalId)]);
    await verifySocialCommentIngestionActivity(siteId, [externalId, externalId]);
    expect(mockDatabase.from.mock.calls).toEqual([['synced_objects'], ['messages']]);
    expect(ledger.select).toHaveBeenCalledWith('external_id, status');
    expect(ledger.eq.mock.calls).toEqual([['site_id', siteId], ['object_type', 'social_comment']]);
    expect(ledger.in).toHaveBeenCalledWith('external_id', [externalId]);
    expect(messages.select).toHaveBeenCalledWith('custom_data, conversations!inner(site_id)');
    expect(messages.in).toHaveBeenCalledWith('custom_data->>origin_message_id', [externalId]);
    expect(messages.eq.mock.calls).toEqual([
      ['conversations.site_id', siteId], ['role', 'user'], ['custom_data->>source', 'comment'],
    ]);
    expect(ledger.upsert).not.toHaveBeenCalled();
    expect(messages.upsert).not.toHaveBeenCalled();
  });

  it.each(['processing', 'error', 'pending', null, 'COMPLETED'])('rejects %s claims', async (status) => {
    queueQuery([{ external_id: externalId, status }]);
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId])).rejects.toThrow('not completed');
    expect(mockDatabase.from).toHaveBeenCalledTimes(1);
  });

  it('does not let duplicate or unrelated completed keys satisfy a missing key', async () => {
    queueQuery([completed(externalId), completed(externalId), completed('unrelated')]);
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId, 'missing'])).rejects.toThrow('every requested comment');
  });

  it('rejects missing claims before checking messages', async () => {
    queueQuery([]);
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId])).rejects.toThrow('not completed');
    expect(mockDatabase.from).toHaveBeenCalledTimes(1);
  });

  it('does not bless an old completed claim without a saved message', async () => {
    queueQuery([completed(externalId)]);
    queueQuery([]);
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId])).rejects.toThrow('not persisted');
  });

  it('does not count repeated persisted messages as different comment IDs', async () => {
    queueQuery([completed(externalId), completed('missing')]);
    queueQuery([persisted(externalId), persisted(externalId)]);
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId, 'missing'])).rejects.toThrow('1 social comment(s)');
  });

  it('pages persisted rows so duplicates cannot hide another requested ID', async () => {
    queueQuery([completed(externalId), completed('last')]);
    const first = queueQuery(Array.from({ length: 100 }, () => persisted(externalId)));
    const second = queueQuery([persisted('last')]);
    await verifySocialCommentIngestionActivity(siteId, [externalId, 'last']);
    expect(first.range).toHaveBeenCalledWith(0, 99);
    expect(second.range).toHaveBeenCalledWith(100, 199);
    for (const query of [first, second]) {
      expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
      expect(query.in).toHaveBeenCalledWith('custom_data->>origin_message_id', [externalId, 'last']);
      expect(query.eq).toHaveBeenCalledWith('conversations.site_id', siteId);
    }
  });

  it('verifies ledger and message IDs in bounded chunks of at most 100', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `outstand:instagram:${i}`);
    const queries = [];
    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100);
      queries.push({ chunk, ledger: queueQuery(chunk.map(completed)), messages: queueQuery(chunk.map(persisted)) });
    }
    await verifySocialCommentIngestionActivity(siteId, ids);
    expect(mockDatabase.from).toHaveBeenCalledTimes(6);
    for (const { chunk, ledger, messages } of queries) {
      expect(ledger.in).toHaveBeenCalledWith('external_id', chunk);
      expect(messages.in).toHaveBeenCalledWith('custom_data->>origin_message_id', chunk);
      expect(ledger.eq).toHaveBeenCalledWith('site_id', siteId);
      expect(messages.eq).toHaveBeenCalledWith('conversations.site_id', siteId);
    }
  });

  it.each(['ledger', 'messages'])('rejects a later %s chunk failure rather than partially verifying', async (table) => {
    const ids = Array.from({ length: 101 }, (_, i) => `outstand:instagram:${i}`);
    queueQuery(ids.slice(0, 100).map(completed));
    queueQuery(ids.slice(0, 100).map(persisted));
    if (table === 'messages') queueQuery([completed(ids[100])]);
    queueQuery(null, { message: 'later chunk failed' });
    await expect(verifySocialCommentIngestionActivity(siteId, ids)).rejects.toThrow('later chunk failed');
  });

  it.each(['ledger', 'messages'])('fails closed for an invalid %s response', async (table) => {
    if (table === 'messages') queueQuery([completed(externalId)]);
    queueQuery(null);
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId])).rejects.toThrow('Invalid');
  });

  it('uses the fallback tenant schema for ledger and message reads', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = 'fallback_app';
    queueQuery([completed(externalId)]);
    queueQuery([persisted(externalId)]);
    await verifySocialCommentIngestionActivity(siteId, [externalId]);
    expect(mockDatabase.schema.mock.calls).toEqual([['fallback_app'], ['fallback_app']]);
  });
});

describe('input validation', () => {
  it('verifies new scoped origin IDs without parsing or truncating account/post identity', async () => {
    const id = 'outstand-comment-claim:v2:["site-1","x","account","post"]:"comment"';
    const query = queueQuery([{ id: 'saved-message' }]);
    await assertSocialCommentPersistedActivity(siteId, id);
    expect(query.eq).toHaveBeenCalledWith('custom_data->>origin_message_id', id);
  });
  it.each(['', '  ', null, 7])('rejects invalid site identifiers (%j) before database access', async (value) => {
    const invalid = value as string;
    await expect(getSocialCommentSyncStatesActivity(invalid, [])).rejects.toThrow('siteId');
    await expect(recordSocialCommentSyncSuccessActivity(invalid, 'post-1', 'x')).rejects.toThrow('siteId');
    await expect(assertSocialCommentPersistedActivity(invalid, externalId)).rejects.toThrow('siteId');
    await expect(hasSocialCommentPersistedActivity(invalid, externalId)).rejects.toThrow('siteId');
    await expect(verifySocialCommentIngestionActivity(invalid, [])).rejects.toThrow('siteId');
    expect(mockDatabase.from).not.toHaveBeenCalled();
  });

  it('validates the entire ID list before any query or checkpoint write', async () => {
    await expect(getSocialCommentSyncStatesActivity(siteId, ['post-1', ' '])).rejects.toThrow('postIds');
    await expect(verifySocialCommentIngestionActivity(siteId, [externalId, ''])).rejects.toThrow('externalIds');
    await expect(getSocialCommentSyncStatesActivity(siteId, null as unknown as string[])).rejects.toThrow('array');
    await expect(recordSocialCommentSyncSuccessActivity(siteId, '', 'x')).rejects.toThrow('postId');
    await expect(recordSocialCommentSyncSuccessActivity(siteId, 'post-1', ' ')).rejects.toThrow('network');
    await expect(assertSocialCommentPersistedActivity(siteId, '')).rejects.toThrow('externalId');
    expect(mockDatabase.from).not.toHaveBeenCalled();
  });
});