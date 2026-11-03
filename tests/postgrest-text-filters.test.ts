import { createClient } from '@supabase/supabase-js';
import { postgrestTextIn } from '../src/lib/supabase/textFilters';
import { commentAccountBoundaryKey, scopedCommentExternalId } from '../src/temporal/workflows/helpers/socialCommentScope';

const scope = { siteId: 'site', network: 'instagram', accountId: 'account', postId: 'post' };

describe('literal PostgREST text IN filters', () => {
  it('quotes and escapes JSON identities, backslashes and filter punctuation', () => {
    const values = ['plain', 'a"b', 'a\\b', 'a,b', 'a)b', 'á', 'plain'];
    expect(postgrestTextIn(values)).toBe('(\"plain\",\"a\\\"b\",\"a\\\\b\",\"a,b\",\"a)b\",\"á\")');
    expect(postgrestTextIn([])).toBe('()');
  });

  it('passes escaped scoped identities through the installed SDK without double quoting', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response('[]', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const db = createClient('https://example.supabase.co', 'test-key', { global: { fetch } });
    const keys = [commentAccountBoundaryKey(scope), scopedCommentExternalId(scope, 'comment"\\1')];
    await db.from('social_comment_sync_state').select('outstand_post_id')
      .eq('site_id', scope.siteId).filter('outstand_post_id', 'in', postgrestTextIn(keys));
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('outstand_post_id')).toBe(`in.${postgrestTextIn(keys)}`);
    expect(JSON.parse(`[${url.searchParams.get('outstand_post_id')!.slice(4, -1)}]`)).toEqual(keys);
    expect(url.searchParams.get('site_id')).toBe('eq.site');
  });
});