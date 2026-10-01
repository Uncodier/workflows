const mockSettings = jest.fn();
const mockDb = jest.fn();
const calls: Array<{ table: string; methods: Array<[string, ...any[]]> }> = [];
jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({ fetchCompleteSettings: mockSettings }),
}));
jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: { from: (table: string) => {
    const entry = { table, methods: [] as Array<[string, ...any[]]> };
    calls.push(entry);
    const chain: any = {};
    for (const name of ['select', 'eq', 'in', 'is', 'or', 'order', 'range', 'limit', 'update', 'maybeSingle']) {
      chain[name] = (...args: any[]) => { entry.methods.push([name, ...args]); return chain; };
    }
    chain.then = (resolve: any, reject: any) => Promise.resolve(mockDb(entry)).then(resolve, reject);
    return chain;
  } },
}));
import { getOutreachConfigurationActivity, fetchOutreachHistory } from '../src/temporal/activities/outreachConfigurationActivity';
import { selectOutreachLeads } from '../src/temporal/activities/outreachLeadSelection';

const config = (extra = {}) => ({
  business_hours: [{ timezone: 'America/Mexico_City' }],
  channels: { email: { status: 'synced', email: 'sender@example.com' } },
  activities: { leads_initial_cold_outreach: { status: 'active', channel_accounts: { email: ['email'] },
    segment_ids: ['segment'], daily_message_limit: 5, max_unanswered_messages: 2, ...extra } },
});

describe('outreach DB selection', () => {
  beforeEach(() => {
    jest.clearAllMocks(); calls.length = 0;
    mockSettings.mockResolvedValue([config()]);
    mockDb.mockImplementation(({ table, methods }) => {
      if (table === 'segments') return { data: [{ id: 'segment' }], error: null };
      if (table === 'leads' && methods.some((m: any[]) => m[0] === 'update')) return { error: null };
      if (table === 'leads') return { data: [{ id: 'lead', status: 'new', email: 'lead@example.com', segment_id: 'segment', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }], count: 12, error: null };
      return { data: [], error: null };
    });
  });

  it('filters site and selected segments before pagination and limits the page by daily cap', async () => {
    const result = await selectOutreachLeads({ site_id: 'site', activity: 'leads_initial_cold_outreach', page: 1, pageSize: 30, waitMs: 0 });
    expect(result.leads).toHaveLength(1);
    expect(result).toMatchObject({ hasMorePages: true, pageSize: 5, totalCandidatesFound: 12 });
    const query = calls.find(c => c.table === 'leads')!.methods;
    expect(query).toContainEqual(['eq', 'site_id', 'site']);
    expect(query).toContainEqual(['in', 'segment_id', ['segment']]);
    expect(query).toContainEqual(['range', 5, 9]);
    expect(query.findIndex(m => m[0] === 'in' && m[1] === 'segment_id')).toBeLessThan(query.findIndex(m => m[0] === 'range'));
  });

  it('refuses cross-site or missing selected segments', async () => {
    mockDb.mockReturnValue({ data: [], error: null });
    const result = await getOutreachConfigurationActivity({ site_id: 'site', activity_key: 'leads_initial_cold_outreach' });
    expect(result.shouldExecute).toBe(false);
    expect(calls.every(call => call.table === 'segments')).toBe(true);
  });

  it('re-reads Follow Up start time and blocks before any audience or lead work, but scheduling can look ahead', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T16:00:00Z')); // 10:00 local
    try {
      const input = config();
      const activity = { ...input.activities.leads_initial_cold_outreach, weekdays: [2], start_time: '09:00' };
      mockSettings.mockImplementation(async () => [{ ...input, activities: { leads_follow_up: { ...activity } } }]);
      const params = { site_id: 'site', activity_key: 'leads_follow_up' as const };
      expect(await getOutreachConfigurationActivity(params)).toMatchObject({ shouldExecute: true, startTime: '09:00' });
      calls.length = 0;
      activity.start_time = '11:00';
      expect(await getOutreachConfigurationActivity({ ...params, lead_id: 'lead' })).toMatchObject({
        shouldExecute: false, startTime: '11:00', reason: 'Before configured follow-up start time',
      });
      expect(calls).toHaveLength(0);
      expect(await getOutreachConfigurationActivity({ ...params, check_day: false })).toMatchObject({ shouldExecute: true, startTime: '11:00' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('selects a Telegram-only lead by its site-owned conversation identity', async () => {
    const settings = config({ channel_accounts: { telegram: ['telegram-account'] } });
    mockSettings.mockResolvedValue([{ ...settings, channels: { connections: [
      { id: 'telegram-account', type: 'telegram', status: 'connected', zavu_sender_id: 'sender' },
    ] } }]);
    const base = mockDb.getMockImplementation()!;
    mockDb.mockImplementation(entry => {
      if (entry.table === 'leads') return { data: [{ id: 'lead', site_id: 'site', status: 'new', segment_id: 'segment', created_at: '2026-01-01T00:00:00Z' }], count: 1, error: null };
      if (entry.table === 'conversations') return { data: [
        { id: 'conversation', site_id: 'site', lead_id: 'lead', channel: 'telegram', custom_data: { chat_id: '1234567' } },
      ], error: null };
      return base(entry);
    });
    const selected = await selectOutreachLeads({ site_id: 'site', activity: 'leads_initial_cold_outreach', waitMs: 0 });
    expect(selected.leads).toHaveLength(1);
    expect(selected.leads[0].outreach_channels).toEqual(['telegram']);
    const query = calls.find(c => c.table === 'conversations')!.methods;
    expect(query).toContainEqual(['eq', 'site_id', 'site']);
    expect(query).toContainEqual(['eq', 'lead_id', 'lead']);
  });

  it('uses a stable cursor so cold transitions cannot shift the next candidate page', async () => {
    await selectOutreachLeads({ site_id: 'site', activity: 'leads_initial_cold_outreach', page: 1,
      pageSize: 30, waitMs: 0, cursor: { createdAt: '2026-01-01T00:00:00Z', id: '11111111-1111-4111-8111-111111111111' } });
    const query = calls.find(c => c.table === 'leads')!.methods;
    expect(query).toContainEqual(['range', 0, 4]);
    expect(query.find(m => m[0] === 'or')![1]).toContain('created_at.gt.2026-01-01T00:00:00.000Z');
    expect(query).toContainEqual(['in', 'status', ['new', 'contacted']]);
  });

  it('reads inbound history through the site-owned conversation even without message.lead_id', async () => {
    await fetchOutreachHistory('site', 'lead');
    expect(calls[0].methods).toContainEqual(['eq', 'conversations.lead_id', 'lead']);
    expect(calls[0].methods).toContainEqual(['eq', 'conversations.site_id', 'site']);
  });

  it('marks a never-replied lead cold only after confirmed unanswered cap and reply wait', async () => {
    const base = mockDb.getMockImplementation()!;
    mockDb.mockImplementation(entry => entry.table === 'messages' ? { data: [
      { id: 'sent1', role: 'assistant', created_at: '2026-01-02T00:00:00Z', custom_data: { status: 'sent' } },
      { id: 'sent2', role: 'assistant', created_at: '2026-01-03T00:00:00Z', custom_data: { delivery: { success: true } } },
    ], error: null } : base(entry));
    const result = await selectOutreachLeads({ site_id: 'site', activity: 'leads_initial_cold_outreach', waitMs: 48 * 3600000 });
    expect(result.leads).toEqual([]);
    const update = calls.find(c => c.methods.some(m => m[0] === 'update'))!;
    expect(update.methods).toContainEqual(['eq', 'site_id', 'site']);
    expect(update.methods).toContainEqual(['eq', 'updated_at', '2026-01-01T00:00:00Z']);
    expect(update.methods.find(m => m[0] === 'update')![1]).toMatchObject({ status: 'cold' });
  });

  it('does not select or mark cold a contact who has ever replied for cold outreach', async () => {
    const base = mockDb.getMockImplementation()!;
    mockDb.mockImplementation(entry => entry.table === 'messages'
      ? { data: [{ id: 'inbound', role: 'user', created_at: '2026-01-04T00:00:00Z' }], error: null } : base(entry));
    expect((await selectOutreachLeads({ site_id: 'site', activity: 'leads_initial_cold_outreach', waitMs: 0 })).leads).toEqual([]);
    expect(calls.some(c => c.methods.some(m => m[0] === 'update'))).toBe(false);
  });
});