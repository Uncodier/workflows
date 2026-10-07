const mockPost = jest.fn();
const mockConnected = jest.fn();
const mockReplies: any[] = [];
const mockQueries: any[] = [];
const mockFrom = jest.fn((table: string) => {
  const query: any = { table, filters: [], write: undefined };
  const finish = () => {
    if (!mockReplies.length) throw new Error(`Unexpected query ${table}`);
    return Promise.resolve(mockReplies.shift());
  };
  for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) query[method] = (...args: any[]) => {
    query.filters.push([method, ...args]); return query;
  };
  for (const method of ['insert', 'update']) query[method] = (payload: any) => {
    query.write = { method, payload }; return query;
  };
  query.single = finish;
  query.maybeSingle = finish;
  query.then = (resolve: any, reject: any) => finish().then(resolve, reject);
  mockQueries.push(query);
  return query;
});
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: mockPost } }));
jest.mock('../src/temporal/services', () => ({ getSupabaseService: () => ({ getConnectionStatus: mockConnected }) }));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));

import { callPersonRoleSearchActivity, callPersonWorkEmailsActivity, prepareFinderPersonActivity, upsertFinderCompanyActivity,
  upsertLeadForPersonActivity, upsertPersonActivity, updateIcpMiningProgressActivity, checkExistingLeadForPersonActivity } from '../src/temporal/activities/finderActivities';
import { enrichWithValidatedContacts } from '../src/temporal/workflows/icpMining/enrichWithValidatedContacts';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';

const row = (data: any) => ({ data, error: null });
const failure = (message: string, code?: string) => ({ data: null, error: { message, code } });

describe('Finder persistence activities with mocked database boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockReplies.length = 0; mockQueries.length = 0;
    mockConnected.mockResolvedValue(true);
  });
  it('fetches verification metadata before deciding whether the lead needs contact validation', async () => {
    mockReplies.push(row({ id: 'lead', email: 'valid@test', metadata: { emailVerified: true } }));
    const result = await checkExistingLeadForPersonActivity({ person_id: 'person', site_id: 'site' });
    expect(result.existingLead.metadata.emailVerified).toBe(true);
    expect(mockQueries[0].filters.find((entry: any[]) => entry[0] === 'select')[1]).toContain('metadata');
  });

  it('updates a known local person ID and preserves omitted IDs, validated contacts and raw research', async () => {
    const existing = { id: 'local-person', role_query_id: 'query', external_person_id: 11, emails: [{ email: 'valid@test', validation_status: 'valid' }],
      personal_emails: ['personal@test'], phones: ['+1234'], raw_result: { research: { report: 'research' }, roles: [{ id: 1, title: 'CEO' }] } };
    mockReplies.push(row(existing), row(existing));
    const result = await upsertPersonActivity({ id: 'local-person', emails: [], phones: null, raw_result: { roles: [] } });
    expect(result.success).toBe(true);
    expect(mockQueries[0].filters).toContainEqual(['eq', 'id', 'local-person']);
    const payload = mockQueries[1].write.payload;
    expect(payload).toMatchObject({ emails: existing.emails, personal_emails: existing.personal_emails, phones: existing.phones,
      raw_result: existing.raw_result });
    expect(payload).not.toHaveProperty('role_query_id');
    expect(payload).not.toHaveProperty('external_person_id');
  });

  it('never inserts a person after a failed identity lookup', async () => {
    mockReplies.push(failure('read denied'));
    const result = await upsertPersonActivity({ external_person_id: 11, external_role_id: 21, raw_result: {} });
    expect(result).toEqual({ success: false, error: 'read denied' });
    expect(mockQueries.some(q => q.write)).toBe(false);
  });

  it('finds an existing person even if role ID is absent', async () => {
    mockReplies.push(row({ id: 'p', raw_result: {} }), row({ id: 'p' }));
    await upsertPersonActivity({ external_person_id: 11, raw_result: {} });
    expect(mockQueries[0].filters).toContainEqual(['eq', 'external_person_id', 11]);
    expect(mockQueries[1].write.method).toBe('update');
  });

  it('preserves validated lead primaries, metadata/research, social data and idempotent notes', async () => {
    const existing = { id: 'lead', email: 'verified@test', personal_email: 'personal@test', phone: '+1234', name: 'Ada',
      notes: 'Additional phone: +1234', company_id: 'old-company', status: 'qualified',
      metadata: { research: { status: 'completed', report: 'rich' }, email_validation: { status: 'valid' }, finder: { old: true } },
      social_networks: { twitter: '@ada' }, address: { city: 'Madrid', country: 'ES' } };
    mockReplies.push(row(existing), row(existing));
    const result = await upsertLeadForPersonActivity({ person_id: 'p', site_id: 'site', name: 'Ada', email: 'new@test',
      person_emails: [], notes: existing.notes, linkedin_url: 'https://linkedin.com/in/ada', company_id: 'correct-company',
      profile: { position: 'President', address: { city: '', country: null }, metadata: { finder: { new: true } } } });
    expect(result).toMatchObject({ success: true, leadId: 'lead' });
    const payload = mockQueries[1].write.payload;
    expect(payload).toMatchObject({ email: existing.email, personal_email: existing.personal_email, phone: existing.phone,
      notes: existing.notes, company_id: 'correct-company', position: 'President', address: existing.address,
      social_networks: { twitter: '@ada', linkedin: 'https://linkedin.com/in/ada' },
      metadata: { ...existing.metadata, finder: { old: true, new: true } } });
    expect(payload).not.toHaveProperty('status');
  });

  it('counts options.email as contact and honors NOT NULL email for phone-only creation', async () => {
    mockReplies.push(row(null), row({ id: 'new-lead' }));
    expect(await upsertLeadForPersonActivity({ person_id: 'p', site_id: 's', userId: 'u', name: 'Ada',
      phone: '+1234', person_emails: [], company_id: 'c' })).toMatchObject({ success: true, leadId: 'new-lead' });
    expect(mockQueries[1].write.payload[0].email).toBe('');
    mockReplies.push(row(null), row(null), row({ id: 'email-lead' }));
    expect(await upsertLeadForPersonActivity({ person_id: 'p2', site_id: 's', userId: 'u', name: 'Ada',
      email: 'ada@test', person_emails: [] })).toMatchObject({ success: true, leadId: 'email-lead' });
  });
  it('replaces unusable primaries only through the validated contact path and retains raw alternatives', async () => {
    mockReplies.push(row({ id: 'lead', email: 'bounce@test', phone: 'not a phone', metadata: { finder: { source: 'keep' } } }), row({ id: 'lead' }));
    const result = await upsertLeadForPersonActivity({ person_id: 'person', site_id: 'site', name: 'Ada',
      email: 'valid@example.test', person_emails: ['valid@example.test'], validated_contact_policy: true,
      profile: { metadata: { finder: { raw: { validation_status: 'invalid', email: 'bounce@test' } } } } });
    expect(result.success).toBe(true);
    const payload = mockQueries[1].write.payload;
    expect(payload).toMatchObject({ email: 'valid@example.test', phone: null,
      metadata: { emailVerified: true, finder: { source: 'keep', raw: { email: 'bounce@test' } } } });
  });

  it.each(['read', 'write'])('surfaces lead %s errors without success', async stage => {
    mockReplies.push(stage === 'read' ? failure('db failed', 'PGRST116') : row({ id: 'l', email: 'valid@test' }));
    if (stage === 'write') mockReplies.push(failure('db failed'));
    expect(await upsertLeadForPersonActivity({ person_id: 'p', site_id: 's', name: 'Ada', person_emails: [] }))
      .toMatchObject({ success: false, error: 'db failed' });
  });

  describe('same-site contact-key lead reuse', () => {
    const options = { person_id: 'new-person', site_id: 'site', userId: 'mining-user', name: 'Ada',
      email: 'ada@example.test', person_emails: ['ada@example.test'], segment_id: 'campaign-segment',
      company_id: 'company', notes: 'ICP enrichment', validated_contact_policy: true,
      phone: '+14155559999', linkedin_url: 'https://linkedin.com/in/ada',
      profile: { position: 'Founder', address: { city: 'Madrid' }, metadata: { finder: { new: true } } } };
    const existing = { id: 'canonical-lead', person_id: 'legacy-person', site_id: 'site', name: options.name,
      email: options.email, phone: '+14155551234', personal_email: 'personal@example.test', user_id: 'owner',
      segment_id: 'old-segment', status: 'qualified', origin: 'import', created_at: '2026-01-01', notes: 'Prior note',
      metadata: { research: { report: 'Preserve research' }, finder: { old: true } },
      social_networks: { twitter: '@ada' }, address: { country: 'ES' } };
    const conflict = () => failure('duplicate key value violates unique constraint "leads_site_name_email_unique"', '23505');

    function expectReusedWrite(query: any) {
      expect(query.write.method).toBe('update');
      expect(query.filters).toContainEqual(['eq', 'site_id', 'site']);
      expect(query.filters).toContainEqual(['eq', 'id', existing.id]);
      expect(query.write.payload).toMatchObject({ person_id: existing.person_id, segment_id: options.segment_id,
        company_id: 'company', position: 'Founder', email: existing.email, phone: existing.phone,
        personal_email: existing.personal_email, notes: 'Prior note\nICP enrichment',
        address: { country: 'ES', city: 'Madrid' },
        social_networks: { twitter: '@ada', linkedin: options.linkedin_url },
        metadata: { research: existing.metadata.research, emailVerified: true,
          finder: { old: true, new: true, contacts: { phones: [existing.phone, options.phone] } } } });
      for (const key of ['user_id', 'status', 'origin', 'created_at']) expect(query.write.payload).not.toHaveProperty(key);
    }

    it('assigns the segment and enrichment to the legacy lead without inserting or changing its person/owner/status', async () => {
      mockReplies.push(row(null), row(existing), row(existing));
      expect(await upsertLeadForPersonActivity(options)).toMatchObject({ success: true, leadId: existing.id });
      expect(mockQueries[1].filters).toEqual([
        ['select', '*'], ['eq', 'site_id', 'site'], ['eq', 'name', options.name], ['eq', 'email', options.email],
      ]);
      expect(mockQueries.some(query => query.write?.method === 'insert')).toBe(false);
      expectReusedWrite(mockQueries[2]);
    });

    it.each(['insert', 'update'])('recovers the exact unique conflict during %s using the canonical lead data', async operation => {
      if (operation === 'insert') mockReplies.push(row(null), row(null), conflict(), row(existing), row(existing));
      else mockReplies.push(row({ id: 'person-lead', person_id: options.person_id, email: 'old@example.test' }),
        conflict(), row(existing), row(existing));
      expect(await upsertLeadForPersonActivity(options)).toMatchObject({ success: true, leadId: existing.id });
      expectReusedWrite(mockQueries[mockQueries.length - 1]);
    });

    it('keeps an existing segment when no new segment is supplied and links only an unlinked legacy lead', async () => {
      mockReplies.push(row(null), row({ ...existing, person_id: null }), row(existing));
      expect(await upsertLeadForPersonActivity({ ...options, segment_id: undefined })).toMatchObject({ success: true });
      expect(mockQueries[2].write.payload.person_id).toBe(options.person_id);
      expect(mockQueries[2].write.payload).not.toHaveProperty('segment_id');
    });

    it('uses the person name and first available email when options omit them', async () => {
      mockReplies.push(row(null), row({ full_name: 'Ada' }), row({ emails: [options.email] }), row(existing), row(existing));
      expect(await upsertLeadForPersonActivity({ person_id: options.person_id, site_id: options.site_id,
        segment_id: options.segment_id })).toMatchObject({ success: true, leadId: existing.id });
      expect(mockQueries[3].filters).toContainEqual(['eq', 'email', options.email]);
      expect(mockQueries[4].write.payload.segment_id).toBe(options.segment_id);
    });

    it('does not conflate phone-only people sharing a name and empty email', async () => {
      mockReplies.push(row(null), conflict());
      expect(await upsertLeadForPersonActivity({ ...options, email: undefined, person_emails: [] }))
        .toMatchObject({ success: false, error: expect.stringContaining('leads_site_name_email_unique') });
      expect(mockQueries).toHaveLength(2);
      expect(mockQueries[1].write.method).toBe('insert');
    });

    it.each([
      ['contact lookup', [row(null), failure('read denied')], 'read denied'],
      ['canonical update', [row(null), row(existing), failure('write denied')], 'write denied'],
      ['conflict lookup', [row(null), row(null), conflict(), failure('lookup denied')], 'lookup denied'],
      ['missing winner', [row(null), row(null), conflict(), row(null)], 'leads_site_name_email_unique'],
      ['conflict update', [row(null), row(null), conflict(), row(existing), failure('update denied')], 'update denied'],
      ['unrelated constraint', [row(null), row(null), failure('duplicate key violates "other_unique"', '23505')], 'other_unique'],
      ['insert timeout', [row(null), row(null), failure('statement timeout', '57014')], 'statement timeout'],
    ])('does not hide %s failures as matches', async (_stage, replies, error) => {
      mockReplies.push(...replies as any[]);
      expect(await upsertLeadForPersonActivity(options)).toMatchObject({ success: false,
        error: expect.stringContaining(error as string) });
      expect(mockReplies).toHaveLength(0);
    });

    it.each([false, true])('advances the ICP cursor past a reused lead and processes the next candidate (race=%s)', async race => {
      if (race) mockReplies.push(row(null), row(null), conflict(), row(existing), row(existing));
      else mockReplies.push(row(null), row(existing), row(existing));
      mockReplies.push(row(null), row(null), row({ id: 'next-lead' }));
      const contacts: any = {
        prepareFinderPersonActivity: jest.fn(async (input: any) => ({ success: true, errors: [],
          person: { id: `local-${input.person_id}`, full_name: input.source_search_result.person.full_name,
            emails: input.source_search_result.person.emails, raw_result: {} }, role: {} })),
        checkExistingLeadForPersonActivity: jest.fn().mockResolvedValue({ success: true }),
        upsertPersonActivity: jest.fn(async (input: any) => ({ success: true, person: input })),
        upsertLeadForPersonActivity,
        validateContactInformation: jest.fn(), lookEmailOnIcyPeas: jest.fn(),
        callPersonWorkEmailsActivity: jest.fn(), callPersonContactsLookupPersonalEmailsActivity: jest.fn(),
        callPersonContactsLookupPhoneNumbersActivity: jest.fn(),
      };
      const checkpoint = jest.fn().mockResolvedValue({ success: true });
      const result = await processPageSafely({ icp_mining_id: 'list', role_query_id: 'query', site_id: 'site',
        page: 3, page_size: 10, start_index: 0, max_candidates: 10, max_matches: 10, userId: 'mining-user',
        execution: { run_id: 'run', version: 0, processed: 30, found: 26 },
        snapshot: { page: 3, hasMore: true, candidates: [
          { person: { id: 1, full_name: 'Ada', emails: [options.email] } },
          { person: { id: 2, full_name: 'Bob', emails: ['bob@example.test'] } },
        ] } }, {
        getRoleQueryByIdActivity: jest.fn(), callPersonRoleSearchActivity: jest.fn(),
        getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true, segmentId: options.segment_id }),
        getLeadActivity: jest.fn(), research: jest.fn(), checkpointIcpMiningExecutionActivity: checkpoint,
        enrich: input => enrichWithValidatedContacts(input, contacts, { trustProviderEmails: true }),
      });
      expect(result).toMatchObject({ success: true, processed: 2, foundMatches: 2,
        leadsCreated: [existing.id, 'next-lead'], errors: [], pageCompleted: true,
        checkpoint: { processed: 32, found: 28, page: 4, offset: 0, snapshot: null } });
      const reused = mockQueries.find(query => query.write?.method === 'update');
      expect(reused.write.payload.segment_id).toBe(options.segment_id);
      expect(reused.filters).toContainEqual(['eq', 'id', existing.id]);
      expect(checkpoint).toHaveBeenCalledTimes(2);
      expect(contacts.prepareFinderPersonActivity).toHaveBeenCalledTimes(2);
      expect(contacts.lookEmailOnIcyPeas).not.toHaveBeenCalled();
      expect(mockReplies).toHaveLength(0);
    });
  });

  it('does not conflate companies with same name and conflicting domains', async () => {
    mockReplies.push(row([]), row([{ id: 'wrong', name: 'Acme', website: 'other.test' }]), row({ id: 'correct', name: 'Acme' }));
    expect(await upsertFinderCompanyActivity({ organization: { id: 31, name: 'Acme', domain: 'acme.test', description: 'Company data' } }))
      .toMatchObject({ success: true, company: { id: 'correct' } });
    expect(mockQueries[2].write.method).toBe('insert');
    expect(mockQueries[2].write.payload).toMatchObject({ name: 'Acme', website: 'acme.test', description: 'Company data' });
    expect(mockQueries[2].write.payload).not.toHaveProperty('id');
  });

  it('does not match other Facebook pages when Finder returns the CM Studio profile', async () => {
    const organization = { id: 23053505, name: 'CM Studio', website: 'https://facebook.com/CulturaMercadologica',
      linkedin_info: { public_profile_url: 'https://www.linkedin.com/company/cmstudiomkt/' } };
    mockReplies.push(row([
      { id: 'other-1', name: 'Other', website: 'https://facebook.com/OtherOne' },
      { id: 'other-2', name: 'Another', website: 'https://www.facebook.com/OtherTwo' },
    ]), row([]), row([]), row({ id: 'cm-studio' }));

    expect(await upsertFinderCompanyActivity({ organization })).toMatchObject({ success: true, company: { id: 'cm-studio' } });
    expect(mockQueries[0].filters).toContainEqual(['ilike', 'website', '%facebook.com/culturamercadologica%']);
    expect(mockQueries.filter(query => query.write)).toHaveLength(1);
    expect(mockQueries[3].write).toMatchObject({ method: 'insert', payload: {
      name: 'CM Studio', website: organization.website, linkedin_url: organization.linkedin_info.public_profile_url,
    } });
  });

  it('matches only the exact social page, ignoring www, case, trailing slash and tracking parameters', async () => {
    mockReplies.push(row([
      { id: 'different', website: 'https://facebook.com/CulturaMercadologicaTeam' },
      { id: 'correct', website: 'https://www.facebook.com/culturamercadologica/?ref=share' },
    ]), row({ id: 'correct' }));

    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/CulturaMercadologica',
    } })).toMatchObject({ success: true, company: { id: 'correct' } });
    expect(mockQueries[0].filters).toContainEqual(['ilike', 'website', '%facebook.com/culturamercadologica%']);
    expect(mockQueries[1].write.method).toBe('update');
    expect(mockQueries[1].filters).toContainEqual(['eq', 'id', 'correct']);
  });

  it('does not merge different social pages just because their company names match', async () => {
    mockReplies.push(row([]), row([{ id: 'other', name: 'CM Studio', website: 'https://facebook.com/OtherStudio' }]),
      row({ id: 'new' }));

    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/CulturaMercadologica',
    } })).toMatchObject({ success: true, company: { id: 'new' } });
    expect(mockQueries[2].write.method).toBe('insert');
    expect(mockQueries.filter(query => query.write && query.write.method === 'update')).toHaveLength(0);
  });

  it('does not match a name-only company to a social page without shared identity evidence', async () => {
    mockReplies.push(row([]), row([{ id: 'unknown', name: 'CM Studio', website: null, linkedin_url: null }]),
      row({ id: 'new' }));

    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/CulturaMercadologica',
    } })).toMatchObject({ success: true, company: { id: 'new' } });
    expect(mockQueries[2].write.method).toBe('insert');
  });

  it('rejects a bare shared-platform hostname without a company page or trusted identity', async () => {
    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/',
    } })).toMatchObject({ success: false, error: 'Cannot resolve organization identity: CM Studio' });
    expect(mockQueries).toHaveLength(0);
  });

  it('does not identify a bare Facebook host from a same-name page with no matching LinkedIn', async () => {
    mockReplies.push(row([]), row([{
      id: 'other', name: 'CM Studio', website: 'https://facebook.com/OtherStudio', linkedin_url: null,
    }]), row({ id: 'new' }));
    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/', linkedin_url: 'https://linkedin.com/company/cmstudiomkt',
    } })).toMatchObject({ success: true, company: { id: 'new' } });
    expect(mockQueries[2].write.method).toBe('insert');
  });

  it('fails closed when multiple companies have the exact same social page', async () => {
    mockReplies.push(row([
      { id: 'duplicate-1', website: 'https://facebook.com/CulturaMercadologica' },
      { id: 'duplicate-2', website: 'https://www.facebook.com/culturamercadologica/' },
    ]));

    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/CulturaMercadologica',
    } })).toMatchObject({ success: false, error: 'Ambiguous organization identity: CM Studio' });
    expect(mockQueries.some(query => query.write)).toBe(false);
  });

  it('uses the Facebook profile id rather than conflating different profile.php pages', async () => {
    mockReplies.push(row([
      { id: 'different', website: 'https://facebook.com/profile.php?id=456' },
      { id: 'correct', website: 'https://www.facebook.com/profile.php?id=123&ref=share' },
    ]), row({ id: 'correct' }));

    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/profile.php?id=123',
    } })).toMatchObject({ success: true, company: { id: 'correct' } });
    expect(mockQueries[0].filters).toContainEqual(['ilike', 'website', '%facebook.com/profile.php?id=123%']);
    expect(mockQueries[1].write.method).toBe('update');
    expect(mockQueries[1].filters).toContainEqual(['eq', 'id', 'correct']);
  });

  it('refuses a Facebook profile.php page without an identity id', async () => {
    expect(await upsertFinderCompanyActivity({ organization: {
      name: 'CM Studio', website: 'https://facebook.com/profile.php',
    } })).toMatchObject({ success: false, error: 'Cannot resolve organization identity: CM Studio' });
    expect(mockQueries).toHaveLength(0);
  });

  it('merges sparse company refresh and nested address without clearing rich fields', async () => {
    mockReplies.push(row([{ id: 'company', name: 'Acme', website: 'https://acme.test', description: 'Rich', address: { city: 'Madrid', country: 'ES' } }]), row({ id: 'company' }));
    await upsertFinderCompanyActivity({ organization: { name: 'Acme', description: '', address: { city: null, postal_code: '1234' } } });
    const payload = mockQueries[1].write.payload;
    expect(payload).toMatchObject({ address: { city: 'Madrid', country: 'ES', postal_code: '1234' } });
    expect(payload).not.toHaveProperty('website');
    expect(payload).not.toHaveProperty('description');
  });

  it('surfaces provider logical errors in contact endpoint payloads', async () => {
    mockPost.mockResolvedValue({ success: true, data: { success: false, error: 'quota exceeded' } });
    expect(await callPersonWorkEmailsActivity({ person_id: '11' })).toEqual({ success: false, error: 'quota exceeded' });
  });

  it('preserves available search result when optional details fails, then saves and links exact source organization', async () => {
    const source = { id: 21, role_title: 'President', organization: { id: 31, name: 'Acme', domain: 'acme.test', custom: 'rich' },
      person: { id: 11, full_name: 'Ada', work_emails: [{ email: 'ada@test', validation_status: 'valid' }], skills: ['logistics'] } };
    mockPost.mockResolvedValue({ success: false, error: { message: 'provider unavailable' } });
    mockReplies.push(row(null), row(null), row({ id: 'person', raw_result: source }), row([]), row([]), row({ id: 'company' }));
    const result = await prepareFinderPersonActivity({ person_id: '11', site_id: 's', source_search_result: source });
    expect(result).toMatchObject({ success: true, person: { id: 'person' }, companyId: 'company', role: { id: 21 },
      errors: ['Details lookup: provider unavailable'] });
    expect(mockQueries[2].write.payload).toMatchObject({ external_person_id: 11, external_role_id: 21, emails: ['ada@test'],
      raw_result: { finder_search_result: source, skills: ['logistics'] } });
  });

  it('does not hide company persistence failures behind successful person preparation', async () => {
    mockPost.mockResolvedValue({ success: true, data: { id: 11 } });
    mockReplies.push(row(null), row(null), row({ id: 'p' }), failure('company permission denied'));
    const result = await prepareFinderPersonActivity({ person_id: '11', site_id: 's', source_search_result: {
      id: 21, person: { id: 11, full_name: 'Ada' }, organization: { id: 31, name: 'Acme' } } });
    expect(result).toMatchObject({ success: false, error: 'company permission denied', errors: ['company permission denied'] });
  });

  it('durably records ambiguous education without blocking the selected employer', async () => {
    const university = { id: 32, name: 'Universidad Tecnológica de México', domain: 'unitec.mx' };
    const source = { id: 21, person: { id: 11, full_name: 'Ada' }, organization: { id: 31, name: 'Employer', domain: 'employer.test' } };
    mockPost.mockResolvedValue({ success: true, data: { id: 11, educations: [{ organization: university }] } });
    mockReplies.push(row(null), row(null), row({ id: 'person' }), row([]), row([]), row({ id: 'employer' }),
      row([{ id: 'campus', website: 'https://unitec.mx/campus-marina/' }, { id: 'university', website: 'https://unitec.mx/' }]),
      row({ id: 'person', raw_result: {} }), row({ id: 'person' }));
    const result = await prepareFinderPersonActivity({ person_id: '11', site_id: 'site', source_search_result: source,
      isolate_identity_reviews: true });
    expect(result).toMatchObject({ success: true, companyId: 'employer', requiresIdentityReview: false, errors: [],
      identityReviews: [{ site_id: 'site', selected: false, status: 'pending', organization: university }] });
    expect(mockQueries.at(-1).write.payload.raw_result).toMatchObject({
      educations: [{ organization: university }],
      icp_organization_identity_reviews: [{ id: 'site:32', status: 'pending', selected: false }],
    });
    expect(mockReplies).toHaveLength(0);
  });

  it('defers an ambiguous employer only after saving the pending review', async () => {
    mockPost.mockResolvedValue({ success: true, data: { id: 11 } });
    mockReplies.push(row(null), row(null), row({ id: 'person' }),
      row([{ id: 'a', website: 'acme.test' }, { id: 'b', website: 'https://acme.test' }]),
      row({ id: 'person', raw_result: {} }), row({ id: 'person' }));
    const result = await prepareFinderPersonActivity({ person_id: '11', site_id: 'site', isolate_identity_reviews: true,
      source_search_result: { id: 21, person: { id: 11 }, organization: { id: 31, name: 'Acme', domain: 'acme.test' } } });
    expect(result).toMatchObject({ success: true, requiresIdentityReview: true, errors: [],
      identityReviews: [{ id: 'site:31', selected: true, status: 'pending' }] });
    expect(result.companyId).toBeUndefined();
    expect(mockQueries.filter(q => q.table === 'companies').some(q => q.write)).toBe(false);
  });

  it('does not acknowledge a review when its durable save fails', async () => {
    mockPost.mockResolvedValue({ success: true, data: { id: 11 } });
    mockReplies.push(row(null), row(null), row({ id: 'person' }),
      row([{ id: 'a', website: 'acme.test' }, { id: 'b', website: 'acme.test' }]), failure('review read denied'));
    expect(await prepareFinderPersonActivity({ person_id: '11', site_id: 'site', isolate_identity_reviews: true,
      source_search_result: { id: 21, person: { id: 11 }, organization: { id: 31, name: 'Acme', domain: 'acme.test' } } }))
      .toMatchObject({ success: false, error: 'review read denied' });
  });

  it('does not rewrite another role person row when details selects a different role', async () => {
    mockReplies.push(row({ id: 'old-role-person', external_person_id: 11, external_role_id: 9, created_at: '2020-01-01', raw_result: {} }),
      row(null), row({ id: 'new-role-person' }));
    mockPost.mockResolvedValue({ success: true, data: { id: 11, roles: [{ id: 21, role_title: 'President' }] } });
    const result = await prepareFinderPersonActivity({ person_id: '11', site_id: 's', source_search_result: { id: 11, full_name: 'Ada' } });
    expect(result).toMatchObject({ success: true, person: { id: 'new-role-person' } });
    expect(mockQueries[1].filters).toContainEqual(['eq', 'external_role_id', 21]);
    expect(mockQueries[1].filters).not.toContainEqual(['eq', 'id', 'old-role-person']);
    expect(mockQueries[2].write.method).toBe('insert');
  });

  it('rejects mismatched source person identity before any mutation', async () => {
    mockReplies.push(row({ id: '11111111-1111-1111-1111-111111111111', external_person_id: 22 }));
    const result = await prepareFinderPersonActivity({ person_id: '11111111-1111-1111-1111-111111111111', site_id: 's',
      source_search_result: { id: 21, person: { id: 11 } } });
    expect(result).toMatchObject({ success: false, error: 'Source person identity does not match existing person' });
    expect(mockQueries.some(q => q.write)).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('normalizes real role search_results for fullness-based pagination', async () => {
    const results = Array.from({ length: 10 }, (_, id) => ({ id, person: { id: id + 100 } }));
    mockPost.mockResolvedValue({ success: true, data: { search_results: results } });
    expect(await callPersonRoleSearchActivity({ page: 0, page_size: 10 })).toMatchObject({ success: true, persons: results, hasMore: true });
  });

  it('merges a trusted local company ID and fails closed if stale', async () => {
    mockReplies.push(row({ id: 'trusted', address: { city: 'Madrid' } }), row({ id: 'trusted' }));
    expect(await upsertFinderCompanyActivity({ company_id: 'trusted', organization: { name: 'Acme', address: { country: 'ES' } } }))
      .toMatchObject({ success: true, company: { id: 'trusted' } });
    expect(mockQueries[1].write.payload).toMatchObject({ address: { city: 'Madrid', country: 'ES' } });
    mockReplies.push(row(null));
    expect(await upsertFinderCompanyActivity({ company_id: 'stale', organization: { name: 'Acme' } }))
      .toMatchObject({ success: false, error: 'Company to update was not found' });
  });

  it('does not double-count an absolute progress checkpoint when the activity is retried', async () => {
    mockReplies.push(row({ processed_targets: 10, found_matches: 2, errors: [] }), row(null),
      row({ processed_targets: 15, found_matches: 4, errors: [] }), row(null));
    const checkpoint = { id: 'mining', processedTargets: 15, foundMatches: 4, deltaProcessed: 5, deltaFound: 2,
      currentPage: 1, currentPageOffset: 5 };
    expect(await updateIcpMiningProgressActivity(checkpoint)).toEqual({ success: true });
    expect(await updateIcpMiningProgressActivity(checkpoint)).toEqual({ success: true });
    for (const write of mockQueries.filter(q => q.write)) {
      expect(write.write.payload).toMatchObject({ processed_targets: 15, found_matches: 4, current_page: 1, current_page_offset: 5 });
    }
  });
});