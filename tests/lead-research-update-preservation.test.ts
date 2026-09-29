const mockFetchLead = jest.fn();
const mockUpdateLead = jest.fn();
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: () => ({
  getConnectionStatus: async () => true, fetchLead: mockFetchLead, updateLead: mockUpdateLead,
}) }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: {} }));
jest.mock('../src/temporal/client', () => ({}));
jest.mock('../src/config/config', () => ({ temporalConfig: {} }));
import { updateLeadActivity } from '../src/temporal/activities/leadActivities';

describe('research profile updates preserve collected data', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchLead.mockResolvedValue({ site_id: 'site', notes: 'Imported provider summary',
      metadata: { finder: { person: { skills: ['TypeScript'] } }, emailVerified: true },
      social_networks: { linkedin: 'https://linkedin.com/in/person' } });
    mockUpdateLead.mockResolvedValue({ id: 'lead' });
  });
  afterEach(() => jest.restoreAllMocks());
  it('merges research with Finder snapshots, notes and social links without overwriting contact or ownership', async () => {
    const result = await updateLeadActivity({ lead_id: 'lead', site_id: 'site', preserveExistingData: true, updateData: {
      notes: 'Research summary', metadata: { research_analysis: { summary: 'Deep details' } },
      social_networks: { github: 'https://github.com/person' }, email: 'unverified@example.test', site_id: 'other',
      assignee_id: null, status: 'new', company_id: 'B', segment_id: 'segment-B', campaign_id: 'campaign-B', command_id: 'command-B',
      custom_relationship_ids: ['wrong'], person_id: 'person-B', user_id: 'user-B', origin: 'AI', created_at: '2099-01-01',
    } });
    expect(result.success).toBe(true);
    const saved = mockUpdateLead.mock.calls[0][1];
    expect(saved.metadata).toMatchObject({ finder: { person: { skills: ['TypeScript'] } }, emailVerified: true,
      research_analysis: { summary: 'Deep details' } });
    expect(saved.notes).toContain('Imported provider summary');
    expect(saved.notes).toContain('Research summary');
    expect(saved.social_networks).toHaveProperty('linkedin');
    for (const field of ['email', 'site_id', 'assignee_id', 'status', 'company_id', 'segment_id', 'campaign_id', 'command_id',
      'person_id', 'user_id', 'origin', 'created_at', 'custom_relationship_ids']) expect(saved).not.toHaveProperty(field);
  });
  it('rejects a cross-site update before writing', async () => {
    expect((await updateLeadActivity({ lead_id: 'lead', site_id: 'other', preserveExistingData: true,
      updateData: { metadata: { extra: true } } })).success).toBe(false);
    expect(mockUpdateLead).not.toHaveBeenCalled();
  });
  it('rejects model completion/verification/link metadata and allows only explicit trusted running attempts', async () => {
    await updateLeadActivity({ lead_id: 'lead', site_id: 'site', preserveExistingData: true, updateData: { metadata: {
      deep_research: { status: 'completed', completed_at: '2026-09-29' }, deep_research_result: { success: true },
      research_company_link: { workflow_id: 'forged', company_id: 'B' }, emailVerified: false,
      finder: { person: { skills: ['Overwritten'] } },
    } } });
    const metadata = mockUpdateLead.mock.calls[0][1].metadata;
    expect(metadata).not.toHaveProperty('deep_research');
    expect(metadata).not.toHaveProperty('deep_research_result');
    expect(metadata).not.toHaveProperty('research_company_link');
    expect(metadata.emailVerified).toBe(true);
    expect(metadata.finder.person.skills).toEqual(['TypeScript']);
    await updateLeadActivity({ lead_id: 'lead', site_id: 'site', preserveExistingData: true, recordResearchAttempt: true,
      updateData: { metadata: { deep_research: { status: 'running', workflow_id: 'trusted-workflow', attempted_at: '2026-09-29' } } } });
    expect(mockUpdateLead.mock.calls[1][1].metadata.deep_research.status).toBe('running');
  });
});