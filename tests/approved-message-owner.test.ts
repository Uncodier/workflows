import { createClient } from '@supabase/supabase-js';
import { getApprovedMessagesActivity } from '../src/temporal/activities/messageActivities';
import { cleanupFailedFollowUpActivity } from '../src/temporal/activities/leadActivities';

const mockFetch = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({}));
jest.mock('../src/temporal/client', () => ({}));
jest.mock('../src/config/config', () => ({}));
jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({ getConnectionStatus: async () => true }),
}));
jest.mock('../src/lib/supabase/client', () => ({
  get supabaseServiceRole() {
    return createClient('https://offline.invalid', 'offline', { global: { fetch: mockFetch } });
  },
}));

test('owner filter precedes the queue limit and protects invalid-row repairs against stale reads', async () => {
  const row = (id: string, data: Record<string, unknown> = {}, conversation_id = 'c') => ({
    id, conversation_id, custom_data: { status: 'accepted', command_status: 'pending', ...data },
  });
  const manual = { dispatch_owner: 'chat_intervention' };
  const queue = [...Array.from({ length: 101 }, (_, i) => row(`direct-${i}`, manual, 'missing')),
    row('ai', { dispatch_owner: 'workflow' }), row('legacy'), row('json-null', { dispatch_owner: null }),
    row('collision', {}, 'missing'), row('invalid', {}, 'missing')];
  const ownerFilter = '(custom_data->>dispatch_owner.is.null,custom_data->>dispatch_owner.neq.chat_intervention)';
  const protectedRow = (r: typeof queue[number]) => (r.custom_data as Record<string, unknown>).dispatch_owner === 'chat_intervention';
  mockFetch.mockImplementation(async (url, init) => {
    const { pathname, searchParams: q } = new URL(url);
    let result;
    if (pathname.endsWith('/messages')) {
      expect(q.get('custom_data->>status')).toBe('eq.accepted');
      expect(q.getAll('or')).toContain(ownerFilter);
      if (init.method === 'PATCH') {
        const target = queue.find(r => `eq.${r.id}` === q.get('id'))!;
        if (!protectedRow(target)) Object.assign(target, JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      expect(q.getAll('or')).toContainEqual(expect.stringContaining('outreach_deferred_until.lte.'));
      expect(q.get('limit')).toBe('100');
      result = queue.filter(r => !protectedRow(r)).slice(0, Number(q.get('limit')));
    } else if (pathname.endsWith('/conversations')) {
      Object.assign(queue.find(r => r.id === 'collision')!.custom_data, manual);
      result = [{ id: 'c', site_id: 's', lead_id: 'l' }];
    } else {
      expect(pathname).toMatch(/\/leads$/);
      result = [{ id: 'l' }];
    }
    return new Response(JSON.stringify(result), { status: 200 });
  });
  expect((await getApprovedMessagesActivity()).map(m => m.message_id)).toEqual(['ai', 'legacy', 'json-null']);
  expect(queue.find(r => r.id === 'invalid')!.custom_data.status).toBe('failed');
  expect(queue.filter(protectedRow).every(r => r.custom_data.status === 'accepted' && r.custom_data.command_status === 'pending')).toBe(true);
});

test('failed proposal cleanup cannot sweep a direct reply inserted after the empty-parent snapshot', async () => {
  const requests: string[] = [];
  mockFetch.mockImplementation(async (url, init) => {
    const { pathname, searchParams: q } = new URL(url);
    const resource = `${init.method} ${pathname.split('/').pop()}`;
    requests.push(resource);
    let rows;
    switch (resource) {
      case 'GET conversations': rows = [{ id: 'c' }]; break;
      case 'GET messages': rows = [{ id: 'failed', custom_data: { status: 'failed' } }]; break;
      case 'DELETE messages':
        expect(q.get('id')).toBe('eq.failed'); // never a conversation-wide sweep
        expect(q.get('or')).toContain('custom_data->>dispatch_owner.neq.chat_intervention');
        rows = [{ id: 'failed' }]; break;
      case 'DELETE conversations':
        expect(q.get('message_count')).toBe('eq.0');
        rows = []; break; // concurrent reply made the parent nonempty
      default: throw Error(`Unexpected cleanup: ${resource}`);
    }
    return new Response(JSON.stringify(rows));
  });
  await expect(cleanupFailedFollowUpActivity({ site_id: 's', lead_id: 'l', conversation_id: 'c',
    message_id: 'failed', failure_reason: 'failed' })).resolves.toMatchObject({ success: true, message_deleted: true, conversation_deleted: false });
  expect(requests).toEqual(['GET conversations', 'GET messages', 'DELETE messages', 'DELETE conversations']);
});