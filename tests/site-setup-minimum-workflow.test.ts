import { randomUUID } from 'node:crypto';

const mockActivities = {
  getSiteActivity: jest.fn(), createAgentsActivity: jest.fn(),
  assignAccountManagerActivity: jest.fn(), sendSetupFollowUpEmailActivity: jest.fn(),
};
const mockStartChild = jest.fn();
const mockPatched = jest.fn((_id: string) => true);
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities,
  startChild: (...args: unknown[]) => mockStartChild(...args),
  patched: (id: string) => mockPatched(id),
  isCancellation: (error: unknown) => error instanceof Error && error.name === 'CancelledFailure',
}));
jest.mock('../src/temporal/workflows/buildSegmentsWorkflow', () => ({ buildSegmentsWorkflow: jest.fn() }));

import { siteSetupWorkflow } from '../src/temporal/workflows/siteSetupWorkflow';
import { defaultAgentsConfig } from '../src/temporal/config/agentsConfig';

const siteId = randomUUID();
const ownerId = randomUUID();
const actorId = randomUUID();
const site = { id: siteId, name: 'Saved project', user_id: ownerId, url: '' };
const agent = { agent_id: randomUUID(), type: 'support', name: 'Support', status: 'active' };
const allAgents = { success: true, agents: [agent], total_created: 1, total_existing: 0, errors: [] };
const manager = {
  success: true, account_manager: { manager_id: randomUUID(), name: 'Manager', email: 'manager@example.test' },
  assignment_date: '2026-10-07T00:00:00Z',
};
const email = {
  success: true, messageId: randomUUID(), recipient: 'contact@example.test', timestamp: '2026-10-07T00:00:00Z',
};

beforeEach(() => {
  jest.resetAllMocks();
  mockPatched.mockReturnValue(true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site });
  mockActivities.createAgentsActivity.mockResolvedValue(allAgents);
  mockActivities.assignAccountManagerActivity.mockResolvedValue(manager);
  mockActivities.sendSetupFollowUpEmailActivity.mockResolvedValue(email);
  mockStartChild.mockResolvedValue({ result: async () => ({
    success: true, segmentsBuilt: 5, siteUrl: 'https://example.test', mode: 'create', executionTime: '1s',
  }) });
});
afterEach(() => jest.restoreAllMocks());

it('needs only a saved site ID, creates agents and explicitly skips missing optional data', async () => {
  const result = await siteSetupWorkflow({ site_id: siteId });
  expect(mockPatched).toHaveBeenCalledWith('site-setup-minimum-data-v1');
  expect(mockActivities.createAgentsActivity).toHaveBeenCalledWith(expect.objectContaining({
    site_id: siteId, user_id: ownerId, company_name: site.name,
  }));
  expect(result.success).toBe(true);
  expect(result.status).toBe('partial');
  expect(result.steps).toEqual({
    agents: { status: 'completed' },
    segments: { status: 'skipped', reason: 'missing_site_url' },
    account_manager: { status: 'skipped', reason: 'missing_contact_email' },
    follow_up_email: { status: 'skipped', reason: 'missing_contact_email' },
  });
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.assignAccountManagerActivity).not.toHaveBeenCalled();
  expect(mockActivities.sendSetupFollowUpEmailActivity).not.toHaveBeenCalled();
});

it('uses persisted site identity and company rather than stale supplied hints', async () => {
  await siteSetupWorkflow({ site_id: siteId, user_id: actorId, company_name: 'Outdated hint' });
  expect(mockActivities.createAgentsActivity).toHaveBeenCalledWith(expect.objectContaining({
    user_id: ownerId, company_name: site.name,
  }));
});

it('does not invent an owner from an actor hint when persisted ownership is missing', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { ...site, user_id: null } });
  const result = await siteSetupWorkflow({ site_id: siteId, user_id: actorId });
  expect(result.status).toBe('failed');
  expect(result.steps?.agents).toEqual({ status: 'skipped', reason: 'missing_user_id' });
  expect(mockActivities.createAgentsActivity).not.toHaveBeenCalled();
  expect(mockStartChild).not.toHaveBeenCalled();
});

it.each([{ success: false }, { success: true }, { success: true, site: { ...site, id: randomUUID() } }])(
  'does not perform privileged setup for an absent or mismatched site %j', async data => {
    mockActivities.getSiteActivity.mockResolvedValue(data);
    await expect(siteSetupWorkflow({ site_id: siteId })).rejects.toThrow('An existing site is required');
    expect(mockActivities.createAgentsActivity).not.toHaveBeenCalled();
    expect(mockStartChild).not.toHaveBeenCalled();
  },
);

it('preserves partial agent progress and still executes independent segments', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { ...site, url: 'https://example.test' } });
  mockActivities.createAgentsActivity.mockResolvedValue({ ...allAgents, success: false, errors: ['One agent failed'] });
  const result = await siteSetupWorkflow({ site_id: siteId });
  expect(result.status).toBe('partial');
  expect(result.success).toBe(false);
  expect(result.agents_created.agents).toEqual([agent]);
  expect(result.steps?.agents.status).toBe('partial');
  expect(result.segments_created.success).toBe(true);
  const args = mockStartChild.mock.calls[0][1].args[0];
  expect(args).toEqual({ site_id: siteId, siteId, userId: ownerId, segmentCount: 5, mode: 'create' });
  expect(args.industryContext).toBeUndefined();
});

it('an agent failure does not prevent independent segments, manager or follow-up attempts', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { ...site, url: 'https://example.test' } });
  mockActivities.createAgentsActivity.mockRejectedValue(new Error('Synthetic unavailable agent insert'));
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.steps?.agents).toEqual({ status: 'failed', reason: 'agent_creation_failed' });
  expect(result.steps?.segments.status).toBe('completed');
  expect(result.steps?.account_manager.status).toBe('completed');
  expect(result.steps?.follow_up_email.status).toBe('completed');
  expect(mockActivities.sendSetupFollowUpEmailActivity.mock.calls[0][0].agents_created).toEqual([]);
});

it('skips a genuinely absent manager integration and still sends through the real email activity', async () => {
  mockActivities.assignAccountManagerActivity.mockResolvedValue({
    ...manager, success: false, skipped: true, skipped_reason: 'account_manager_api_unavailable',
    account_manager: { manager_id: '', name: '', email: '' }, assignment_date: '',
  });
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.steps?.account_manager).toEqual({ status: 'skipped', reason: 'account_manager_api_unavailable' });
  expect(result.follow_up_email_sent.success).toBe(true);
  expect(mockActivities.sendSetupFollowUpEmailActivity).toHaveBeenCalledTimes(1);
});

it('exposes ambiguous delivery as safely skipped/unconfirmed, not known failed or completed', async () => {
  mockActivities.sendSetupFollowUpEmailActivity.mockResolvedValue({ success: false, unconfirmed: true, skipped: true, skipped_reason: 'prior_attempt_unconfirmed', messageId: '', recipient: '', timestamp: '' });
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.steps?.follow_up_email).toEqual({ status: 'skipped', reason: 'setup_email_delivery_unconfirmed' });
  expect(result.follow_up_email_sent.success).toBe(false);
});

it.each(['', 'invalid', 'contact @example.test'])('never sends to an absent or invalid recipient %j', async contact => {
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: contact });
  expect(result.steps?.follow_up_email).toEqual({ status: 'skipped', reason: 'missing_contact_email' });
  expect(mockActivities.assignAccountManagerActivity).not.toHaveBeenCalled();
  expect(mockActivities.sendSetupFollowUpEmailActivity).not.toHaveBeenCalled();
});

it('honors disabled optional work without blocking agents', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { ...site, url: 'https://example.test' } });
  const result = await siteSetupWorkflow({ site_id: siteId, options: { enable_leads: false, enable_email_tracking: false } });
  expect(result.steps?.segments).toEqual({ status: 'skipped', reason: 'disabled' });
  expect(result.steps?.follow_up_email).toEqual({ status: 'skipped', reason: 'disabled' });
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.sendSetupFollowUpEmailActivity).not.toHaveBeenCalled();
});

it('reports existing usable agents separately from inserted agents on retry', async () => {
  mockActivities.createAgentsActivity.mockResolvedValue({ ...allAgents, total_created: 0, total_existing: 1 });
  const result = await siteSetupWorkflow({ site_id: siteId });
  expect(result.agents_created.total_created).toBe(0);
  expect(result.agents_existing).toBe(1);
  expect(result.steps?.agents.status).toBe('completed');
});

it('reports complete failure honestly when no independent step succeeds', async () => {
  mockActivities.createAgentsActivity.mockRejectedValue(new Error('Synthetic database write failure'));
  const result = await siteSetupWorkflow({ site_id: siteId });
  expect(result.success).toBe(false);
  expect(result.status).toBe('failed');
});

it('retains partial segment counts and still executes follow-up', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { ...site, url: 'https://example.test' } });
  mockStartChild.mockResolvedValue({ result: async () => ({ success: false, segmentsBuilt: 2 }) });
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.segments_created.segments_built).toBe(2);
  expect(result.steps?.segments.status).toBe('partial');
  expect(result.steps?.follow_up_email.status).toBe('completed');
  expect(result.status).toBe('partial');
});

it('never swallows Temporal cancellation to continue side effects', async () => {
  const cancellation = new Error('Cancellation requested');
  cancellation.name = 'CancelledFailure';
  mockActivities.createAgentsActivity.mockRejectedValue(cancellation);
  await expect(siteSetupWorkflow({ site_id: siteId })).rejects.toBe(cancellation);
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.sendSetupFollowUpEmailActivity).not.toHaveBeenCalled();
});

it('a skipped email integration never claims delivery', async () => {
  mockActivities.sendSetupFollowUpEmailActivity.mockResolvedValue({
    success: false, skipped: true, skipped_reason: 'email_provider_skipped', messageId: '', recipient: '', timestamp: '',
  });
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.steps?.follow_up_email).toEqual({ status: 'skipped', reason: 'email_provider_skipped' });
  expect(result.follow_up_email_sent.messageId).toBe('');
  expect(result.follow_up_email_sent.success).toBe(false);
});

it('exposes unknown delivery distinctly without allowing any second send', async () => {
  mockActivities.sendSetupFollowUpEmailActivity.mockResolvedValue({
    success: false, skipped: true, unconfirmed: true, skipped_reason: 'prior_attempt_unconfirmed',
    messageId: '', recipient: '', timestamp: '',
  });
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.steps?.follow_up_email).toEqual({ status: 'skipped', reason: 'setup_email_delivery_unconfirmed' });
  expect(result.status).toBe('partial');
  expect(mockActivities.sendSetupFollowUpEmailActivity).toHaveBeenCalledTimes(1);
});

it('a child failure preserves agents and does not block email', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { ...site, url: 'https://example.test' } });
  mockStartChild.mockRejectedValue(new Error('Synthetic failed child start'));
  const result = await siteSetupWorkflow({ site_id: siteId, contact_email: email.recipient });
  expect(result.steps?.segments).toEqual({ status: 'failed', reason: 'segment_creation_failed' });
  expect(result.agents_created.success).toBe(true);
  expect(result.follow_up_email_sent.success).toBe(true);
  expect(result.status).toBe('partial');
});

it('preserves pre-patch activity order and legacy command arguments', async () => {
  mockPatched.mockReturnValue(false);
  const params = { site_id: siteId, user_id: actorId, company_name: 'Legacy company', contact_name: 'Legacy contact', contact_email: email.recipient };
  await siteSetupWorkflow(params);
  expect(mockActivities.createAgentsActivity).toHaveBeenCalledWith({
    site_id: siteId, user_id: actorId, company_name: params.company_name,
    agent_types: Array.from(new Set(defaultAgentsConfig.agents.map(agent => agent.type))),
    custom_config: { agents_config: defaultAgentsConfig.agents, use_detailed_config: true },
  });
  expect(mockStartChild.mock.calls[0][1].args[0].industryContext).toBe('ecommerce');
  const order = [mockActivities.getSiteActivity, mockActivities.createAgentsActivity, mockStartChild,
    mockActivities.assignAccountManagerActivity, mockActivities.sendSetupFollowUpEmailActivity]
    .map(mock => mock.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});