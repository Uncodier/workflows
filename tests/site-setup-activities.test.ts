const siteId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const mockPost = jest.fn();
const mockCreateAgent = jest.fn();
const mockFrom = jest.fn();
const mockGetConnectionStatus = jest.fn();
const mockActivityInfo = { workflowNamespace: 'offline', workflowExecution: { workflowId: 'setup', runId: 'run' }, activityId: 'email', attempt: 1 };
jest.mock('@temporalio/activity', () => ({
  ...jest.requireActual('@temporalio/activity'), Context: { current: () => ({ info: mockActivityInfo }) },
}));
const client = { from: mockFrom };
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { request: (path: string, options: any) => mockPost(path, options.body, options.headers) } }));
jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({
    getClient: () => client, getConnectionStatus: mockGetConnectionStatus,
  }),
}));

import {
  assignAccountManagerActivity, createAgentsActivity, sendSetupFollowUpEmailActivity,
  type SiteSetupParams,
} from '../src/temporal/activities/siteSetupActivities';
import { getSiteActivity } from '../src/temporal/activities/siteLookupActivities';
import { CancelledFailure } from '@temporalio/activity';

let site: Record<string, unknown> | null;
let rows: Array<Record<string, unknown>>;
let lookupError: string | undefined;
let siteError: string | undefined;
let filters: Array<{ table: string; criteria: Record<string, unknown> }>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SETUP_EMAIL_SERVICE_API_KEY = require('crypto').randomUUID();
  site = { id: siteId, user_id: ownerId, name: 'Actual Company', url: null };
  rows = [];
  filters = [];
  lookupError = undefined;
  siteError = undefined;
  mockFrom.mockImplementation((table: string) => {
    const criteria: Record<string, unknown> = {};
    filters.push({ table, criteria });
    const query = {
      select: jest.fn(() => query),
      insert: jest.fn((payload: Array<Record<string, unknown>>) => ({
        select: () => ({ single: async () => {
          try { return { data: await mockCreateAgent(payload[0]), error: null }; }
          catch (error) {
            if (error instanceof CancelledFailure) throw error;
            return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
          }
        } }),
      })),
      eq: jest.fn((key: string, value: unknown) => { criteria[key] = value; return query; }),
      maybeSingle: jest.fn(async () => ({ data: site, error: siteError ? { message: siteError } : null })),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({
        data: rows.filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value)),
        error: lookupError ? { message: lookupError } : null,
      })),
    };
    return query;
  });
  mockCreateAgent.mockImplementation(async row => { rows.push({ ...row }); return { ...row }; });
});

describe('minimum-data agent setup', () => {
  it('accepts the API contract and persists only valid minimal schema fields', async () => {
    const params: SiteSetupParams = { site_id: siteId, user_id: actorId, setup_type: 'basic', options: { enable_chat: true } };
    const result = await createAgentsActivity(params);
    expect(result).toMatchObject({ success: true, total_created: 3, total_existing: 0, partial: false, errors: [] });
    expect(rows.map(row => row.type)).toEqual(['support', 'sales', 'marketing']);
    for (const row of rows) {
      expect(row).toMatchObject({ site_id: siteId, user_id: ownerId, status: 'active' });
      expect(row.prompt).toContain('Actual Company');
      expect(Object.keys(row).sort()).toEqual(['description', 'id', 'name', 'prompt', 'role', 'site_id', 'status', 'type', 'user_id']);
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('needs only site_id and does not require a URL, company, contact, or caller user', async () => {
    site = { id: siteId, user_id: ownerId };
    expect(await createAgentsActivity({ site_id: siteId })).toMatchObject({ success: true, total_created: 3 });
    expect(rows[0].prompt).not.toContain('undefined');
  });

  it('reuses existing custom configuration/status and creates only missing agents on retry', async () => {
    await createAgentsActivity({ site_id: siteId });
    rows[0] = { ...rows[0], status: 'inactive', name: 'Custom Support', role: 'Custom Role', configuration: { webhook: 'saved' }, prompt: 'Custom prompt' };
    const before = structuredClone(rows);
    mockCreateAgent.mockClear();
    const result = await createAgentsActivity({ site_id: siteId });
    expect(result).toMatchObject({ success: true, total_created: 0, total_existing: 3 });
    expect(result.agents[0]).toMatchObject({ status: 'inactive', name: 'Custom Support' });
    expect(rows).toEqual(before);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('continues a failed insert, returns an honest partial result, and retries only missing agents', async () => {
    mockCreateAgent.mockImplementation(async row => {
      if (row.type === 'sales') throw new Error('Sales insert rejected');
      rows.push({ ...row }); return { ...row };
    });
    expect(await createAgentsActivity({ site_id: siteId })).toMatchObject({
      success: false, partial: true, total_created: 2, total_existing: 0, errors: ['Sales Assistant: Failed to create agent: Sales insert rejected'],
    });
    mockCreateAgent.mockImplementation(async row => { rows.push({ ...row }); return { ...row }; });
    expect(await createAgentsActivity({ site_id: siteId })).toMatchObject({ success: true, total_created: 1, total_existing: 2 });
    expect(rows).toHaveLength(3);
  });

  it('recovers a committed insert with a lost response without overwriting or duplicating it', async () => {
    mockCreateAgent.mockImplementation(async row => { rows.push({ ...row, status: 'training' }); throw new Error('Lost response'); });
    const result = await createAgentsActivity({ site_id: siteId, agent_types: ['sales'] });
    expect(result).toMatchObject({ success: true, total_created: 0, total_existing: 1, agents: [{ status: 'training' }] });
    expect(rows).toHaveLength(1);
  });

  it('uses a deterministic primary key to recover concurrent insert collisions', async () => {
    mockCreateAgent.mockImplementation(async row => {
      if (rows.some(existing => existing.id === row.id)) throw new Error('Duplicate primary key');
      rows.push({ ...row });
      return { ...row };
    });
    const results = await Promise.all([
      createAgentsActivity({ site_id: siteId, agent_types: ['sales'] }),
      createAgentsActivity({ site_id: siteId, agent_types: ['sales'] }),
    ]);
    expect(results.every(result => result.success)).toBe(true);
    expect(results.reduce((total, result) => total + result.total_created, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.total_existing, 0)).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('normalizes legacy aliases, deduplicates them, and rejects unknown types per agent', async () => {
    const result = await createAgentsActivity({ site_id: siteId, agent_types: ['support', 'customer_support', 'general', 'sales', 'unknown', 'toString'] });
    expect(result).toMatchObject({ success: false, partial: true, total_created: 3 });
    expect(result.errors).toHaveLength(2);
    expect(rows.map(row => row.type)).toEqual(['support', 'marketing', 'sales']);
  });

  it('preserves detailed config/status and keeps separate roles of the same type', async () => {
    const agents_config = [
      { name: 'Growth Lead', role: 'Growth', type: 'marketing', status: 'training', prompt: 'Custom prompt', configuration: { custom: true }, tools: { crm: true } },
      { name: 'Content Writer', type: 'marketing' },
      { name: 'Invalid Agent', type: 'sales', status: 'broken' },
      { name: 'Support', type: 'customer_support' },
    ];
    const params = { site_id: siteId, custom_config: { use_detailed_config: true, agents_config } };
    const first = await createAgentsActivity(params);
    expect(first).toMatchObject({ success: false, partial: true, total_created: 3 });
    expect(rows[0]).toMatchObject({ status: 'training', prompt: 'Custom prompt', configuration: { custom: true }, tools: { crm: true } });
    const second = await createAgentsActivity(params);
    expect(second).toMatchObject({ total_created: 0, total_existing: 3 });
    expect(rows).toHaveLength(3);
  });

  it('reuses same-site compatible legacy manager-created agents without overwriting customization', async () => {
    rows.push({ id: 'legacy', name: 'Renamed sales', role: 'Sales Assistant', type: 'sales', status: 'inactive', site_id: siteId, user_id: actorId, prompt: 'Keep custom' });
    rows.push({ id: 'other-site', name: 'Sales Assistant', role: 'Sales Assistant', type: 'sales', status: 'active', site_id: actorId, user_id: ownerId });
    const before = structuredClone(rows);
    expect(await createAgentsActivity({ site_id: siteId, agent_types: ['sales'] })).toMatchObject({ total_created: 0, total_existing: 1, agents: [{ agent_id: 'legacy' }] });
    expect(rows).toEqual(before);
    expect(filters.find(query => query.table === 'agents')?.criteria).toEqual({ site_id: siteId, type: 'sales' });
  });

  it('does not count a renamed Growth row as Data Analyst through its colliding name', async () => {
    rows.push({ id: 'legacy-growth', name: 'Data Analyst', role: 'Growth Lead', type: 'marketing', status: 'training', site_id: siteId, user_id: actorId });
    const result = await createAgentsActivity({ site_id: siteId, custom_config: { use_detailed_config: true, agents_config: [
      { name: 'Growth Lead', role: 'Growth Lead', type: 'marketing' },
      { name: 'Data Analyst', role: 'Data Analyst', type: 'marketing' },
    ] } });
    expect(result).toMatchObject({ total_existing: 1, total_created: 1, success: true });
    expect(new Set(result.agents.map(agent => agent.agent_id)).size).toBe(2);
  });

  it('rejects conflicting role/name and arbitrary same-type basic fallback', async () => {
    rows.push({ id: 'wrong-role', name: 'Sales Assistant', role: 'Other Role', type: 'sales', status: 'active', site_id: siteId, user_id: ownerId });
    expect(await createAgentsActivity({ site_id: siteId, agent_types: ['sales'] })).toMatchObject({ total_created: 1, total_existing: 0 });
  });

  it('prioritizes exact ID before role and matching role before legacy unroled name', async () => {
    await createAgentsActivity({ site_id: siteId, agent_types: ['sales'] });
    const exact = rows[0];
    rows = [{ ...exact, id: 'name-only', role: '' }, { ...exact, id: 'role-only', name: 'Customized' }, exact];
    expect((await createAgentsActivity({ site_id: siteId, agent_types: ['sales'] })).agents[0].agent_id).toBe(exact.id);
    rows.pop();
    expect((await createAgentsActivity({ site_id: siteId, agent_types: ['sales'] })).agents[0].agent_id).toBe('role-only');
  });

  it('consumes an unroled name match once when two roles share a display name', async () => {
    rows.push({ id: 'legacy', name: 'Assistant', role: ' ', type: 'marketing', status: 'active', site_id: siteId, user_id: actorId });
    const result = await createAgentsActivity({ site_id: siteId, custom_config: { use_detailed_config: true, agents_config: [
      { name: 'Assistant', role: 'Growth', type: 'marketing' }, { name: 'Assistant', role: 'Data', type: 'marketing' },
    ] } });
    expect(result).toMatchObject({ total_existing: 1, total_created: 1 });
    expect(new Set(result.agents.map(agent => agent.agent_id)).size).toBe(2);
  });

  it('fails closed on lookup errors instead of inserting possible duplicates', async () => {
    lookupError = 'Database unavailable';
    expect(await createAgentsActivity({ site_id: siteId })).toMatchObject({ success: false, total_created: 0, partial: false });
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it.each([
    { agent_types: [] },
    { custom_config: { use_detailed_config: true, agents_config: [] } },
  ])('does not report success with no requested agents %p', async options => {
    const result = await createAgentsActivity({ site_id: siteId, ...options });
    expect(result).toMatchObject({ success: false, total_created: 0, total_existing: 0, errors: ['No agents were requested'] });
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('propagates Temporal cancellation without recovering or continuing writes', async () => {
    const cancellation = new CancelledFailure('Cancelled');
    mockCreateAgent.mockRejectedValue(cancellation);
    await expect(createAgentsActivity({ site_id: siteId })).rejects.toBe(cancellation);
    expect(mockCreateAgent).toHaveBeenCalledTimes(1);
    expect(filters.filter(query => query.table === 'agents' && query.criteria.type)).toHaveLength(1);
  });

  it.each([
    { id: actorId, user_id: ownerId },
    { id: siteId, user_id: ownerId, archived_at: '2026-10-06T00:00:00Z' },
  ])('refuses mismatched or archived site identity %p', async record => {
    site = record;
    await expect(createAgentsActivity({ site_id: siteId })).rejects.toThrow(/identity|Archived/);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('validates site existence and persisted owner before any insert', async () => {
    await expect(createAgentsActivity({ site_id: 'not-a-uuid' })).rejects.toThrow('site_id');
    expect(mockFrom).not.toHaveBeenCalled();
    site = null;
    await expect(createAgentsActivity({ site_id: siteId })).rejects.toThrow('Site not found');
    site = { id: siteId };
    await expect(createAgentsActivity({ site_id: siteId, user_id: actorId })).rejects.toThrow('Site owner user_id');
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });
});

describe('optional setup services', () => {
  it('explicitly skips unavailable account-manager assignment without any mock request', async () => {
    expect(await assignAccountManagerActivity({ site_id: siteId })).toMatchObject({ success: false, skipped: true, skipped_reason: expect.any(String) });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'invalid', 'no-email@example.com', 'a@example.com\r\nBcc:bad@example.com'])('skips unusable email %p without inventing a recipient', async contact_email => {
    expect(await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email })).toMatchObject({ success: false, skipped: true, recipient: '' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sends to an explicit recipient via the real schema without invented sender or manager', async () => {
    mockPost.mockResolvedValue({ success: true, data: { success: true, status: 'sent', messageId: 'real-message', recipient: 'owner@example.com', sent_at: '2026-10-06T00:00:00Z' } });
    const result = await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: ' owner@example.com ' });
    expect(result).toEqual({ success: true, messageId: 'real-message', recipient: 'owner@example.com', timestamp: '2026-10-06T00:00:00Z' });
    expect(mockPost).toHaveBeenCalledWith('/api/site/setup/email', {
      site_id: siteId, email: 'owner@example.com', subject: 'Site setup update', message: expect.any(String), operation_key: expect.stringMatching(/^setup-email-v1:[a-f0-9]{64}$/),
    }, { 'x-api-key': process.env.SETUP_EMAIL_SERVICE_API_KEY });
    const message = mockPost.mock.calls[0][1].message;
    expect(message).not.toMatch(/undefined|Account manager|completed|24 hours/);
  });

  it.each([
    { success: false, error: { message: 'No email channel' } },
    { success: true, data: { success: false, error: { message: 'Provider failed' } } },
    { success: true, data: {} },
    { success: true, data: { status: 'queued', messageId: 'not-sent' } },
    { success: true, data: { status: 'sent' } },
  ])('does not claim success from unconfirmed API response %p', async response => {
    mockPost.mockResolvedValue(response);
    expect(await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: 'owner@example.com' })).toMatchObject({ success: false, recipient: '', messageId: '' });
  });

  it('keeps the operation key across Temporal retry attempts and exposes uncertainty safely', async () => {
    mockPost.mockResolvedValue({ success: true, data: { status: 'uncertain', reason: 'prior_attempt_unconfirmed' } });
    mockActivityInfo.attempt = 1;
    const first = await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: 'owner@example.com' });
    mockActivityInfo.attempt = 2;
    await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: 'owner@example.com' });
    expect(mockPost.mock.calls[0][1].operation_key).toBe(mockPost.mock.calls[1][1].operation_key);
    mockActivityInfo.workflowExecution.runId = 'new-run';
    await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: 'owner@example.com' });
    expect(mockPost.mock.calls[2][1].operation_key).not.toBe(mockPost.mock.calls[0][1].operation_key);
    mockActivityInfo.workflowExecution.runId = 'run';
    expect(first).toMatchObject({ success: false, skipped: true, unconfirmed: true, skipped_reason: 'prior_attempt_unconfirmed' });
  });

  it('fails closed when the dedicated service credential is absent', async () => {
    delete process.env.SETUP_EMAIL_SERVICE_API_KEY;
    expect(await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: 'owner@example.com' })).toMatchObject({ skipped: true, skipped_reason: 'setup_email_service_unconfigured' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('propagates provider skips rather than claiming a sent message', async () => {
    mockPost.mockResolvedValue({ success: true, data: { success: true, status: 'skipped', email_id: 'temp-123' } });
    expect(await sendSetupFollowUpEmailActivity({ site_id: siteId, contact_email: 'owner@example.com' })).toMatchObject({ success: false, skipped: true, messageId: '' });
  });
});

describe('scoped site lookup', () => {
  it('reads an existing site directly without an unrelated global connectivity probe', async () => {
    expect(await getSiteActivity(siteId)).toMatchObject({ success: true, site: { id: siteId, user_id: ownerId, url: '' } });
    expect(filters).toEqual([{ table: 'sites', criteria: { id: siteId } }]);
    expect(mockGetConnectionStatus).not.toHaveBeenCalled();
  });

  it('returns real not-found and database errors without mock site data', async () => {
    site = null;
    expect(await getSiteActivity(siteId)).toEqual({ success: false, error: 'Site not found' });
    siteError = 'Permission denied';
    expect(await getSiteActivity(siteId)).toEqual({ success: false, error: 'Failed to fetch site: Permission denied' });
  });
});