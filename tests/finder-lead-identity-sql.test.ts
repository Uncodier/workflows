import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Existing isolated PostgreSQL fixture dependency; no Supabase/provider connection.
let mockDb: any;
let mockBeforeInsert: (() => Promise<void>) | undefined;
const mockQueries: any[] = [];
const mockFrom = (table: string) => {
  const filters: string[] = [];
  const params: any[] = [];
  let operation = 'select';
  let payload: any;
  let limit: number | undefined;
  const query: any = {};
  query.select = () => query;
  query.eq = (column: string, value: any) => { params.push(value); filters.push(`"${column}" = $${params.length}`); return query; };
  query.ilike = (column: string, value: any) => { params.push(value); filters.push(`"${column}" ILIKE $${params.length}`); return query; };
  query.in = (column: string, values: any[]) => {
    const placeholders = values.map(value => { params.push(value); return `$${params.length}`; });
    filters.push(placeholders.length ? `"${column}" IN (${placeholders.join(',')})` : 'false'); return query;
  };
  query.order = () => query;
  query.limit = (value: number) => { limit = value; return query; };
  query.insert = (value: any) => { operation = 'insert'; payload = Array.isArray(value) ? value[0] : value; return query; };
  query.update = (value: any) => { operation = 'update'; payload = value; return query; };
  const execute = async (single: boolean) => {
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const values = params.slice();
    const entries = Object.entries(payload || {});
    const parameter = (value: any) => { values.push(value && typeof value === 'object' ? JSON.stringify(value) : value); return `$${values.length}`; };
    let sql = `SELECT * FROM "${table}"${where}${limit ? ` LIMIT ${limit}` : ''}`;
    if (operation === 'insert') sql = `INSERT INTO "${table}" (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map(([,value]) => parameter(value)).join(',')}) RETURNING *`;
    if (operation === 'update') sql = `UPDATE "${table}" SET ${entries.map(([key,value]) => `"${key}" = ${parameter(value)}`).join(',')}${where} RETURNING *`;
    mockQueries.push({ table, operation, sql, params: values, payload });
    try {
      if (operation === 'insert' && mockBeforeInsert) {
        const hook = mockBeforeInsert; mockBeforeInsert = undefined; await hook();
      }
      const result = await mockDb.query(sql, values);
      if (single && result.rows.length > 1) return { data: null, error: { message: 'Multiple rows', code: 'PGRST116' } };
      return { data: single ? result.rows[0] || null : result.rows, error: null };
    } catch (error: any) { return { data: null, error: { message: error.message, code: error.code } }; }
  };
  query.single = () => execute(true); query.maybeSingle = () => execute(true);
  query.then = (yes: any, no: any) => execute(false).then(yes,no);
  return query;
};
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
jest.mock('../src/temporal/services', () => ({ getSupabaseService: () => ({ getConnectionStatus: async () => true }) }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: () => { throw new Error('Provider calls forbidden'); } } }));

import { checkExistingLeadForPersonActivity, upsertLeadForPersonActivity } from '../src/temporal/activities/finderActivities';
import { enrichWithValidatedContacts } from '../src/temporal/workflows/icpMining/enrichWithValidatedContacts';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';

const currentId = '1531216e-06c5-4535-afc5-8830ba27fda7';
const oldId = '96c5f36c-328f-469b-9ecb-69b384c25a3b';
const input = { person_id: currentId, site_id: 'site', userId: 'owner', name: 'Yamil Morales',
  personal_email: 'yamil@example.test', person_emails: [], linkedin_url: 'https://www.linkedin.com/in/yamilmorales/',
  segment_id: 'new-segment', validated_contact_policy: true, icp_reuse_only: true,
  profile: { metadata: { finder: { fresh: true } } } };

describe('Finder role identity against isolated PostgreSQL', () => {
  beforeAll(async () => {
    // Run PGlite outside Jest's VM, as the existing dispatcher SQL suite does.
    const child = spawn(process.execPath, ['-e', `
      const { PGlite } = require(process.argv[1]);
      const db = new PGlite({ parsers: { 20: value => value } });
      let queue = Promise.resolve();
      process.on('message', request => { queue = queue.then(async () => {
        try { const result = await db[request.method](...request.args); process.send({ id: request.id, result }); }
        catch (error) { process.send({ id: request.id, error: { message: error.message, code: error.code } }); }
        if (request.method === 'close') process.disconnect();
      }); });
    `, resolve(__dirname, '../../API/node_modules/@electric-sql/pglite')], { stdio: ['ignore','ignore','inherit','ipc'] });
    let id = 0;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
    child.on('message', (reply: any) => {
      const request = pending.get(reply.id); pending.delete(reply.id);
      if (reply.error) request?.reject(reply.error); else request?.resolve(reply.result);
    });
    const fail = (error: any) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
    child.on('error', fail); child.on('exit', code => fail(new Error(`SQL fixture exited: ${code}`)));
    mockDb = Object.fromEntries(['query','exec','close'].map(method => [method, (...args: any[]) => new Promise((resolve,reject) => {
      pending.set(++id, { resolve,reject }); child.send({ id,method,args });
    })]));
    await mockDb.exec(`CREATE TABLE persons (id text PRIMARY KEY, external_person_id bigint, external_role_id bigint,
      full_name text, linkedin_profile text, emails jsonb DEFAULT '[]', personal_emails jsonb DEFAULT '[]', phones jsonb DEFAULT '[]', raw_result jsonb DEFAULT '{}');
      CREATE TABLE leads (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, site_id text, person_id text REFERENCES persons(id),
      name text, email text, personal_email text, phone text, user_id text, company_id text, segment_id text,
      status text, origin text, created_at timestamptz, metadata jsonb, social_networks jsonb, updated_at timestamptz,
      CONSTRAINT leads_site_name_email_unique UNIQUE(site_id,name,email));`);
  });
  afterAll(async () => { await mockDb.close(); });
  beforeEach(async () => {
    mockQueries.length = 0;
    mockBeforeInsert = undefined;
    await mockDb.exec('TRUNCATE leads, persons');
    await mockDb.query(`INSERT INTO persons(id,external_person_id,external_role_id,full_name,linkedin_profile,personal_emails)
      VALUES ($1,84462653,59654519,'Yamil Morales','https://www.linkedin.com/in/yamilmorales/','["yamil@example.test"]'),
      ($2,84462653,59654509,'Yamil Morales','https://www.linkedin.com/in/yamilmorales/','["yamil@example.test"]')`, [currentId,oldId]);
    await mockDb.query(`INSERT INTO leads(id,site_id,person_id,name,email,personal_email,status,segment_id,user_id,metadata)
      VALUES ('canonical','site',$1,'Yamil Morales','','yamil@example.test','qualified','old-segment','original-owner','{"research":{"report":"keep"}}')`, [oldId]);
  });

  it('finds the existing same-site lead linked to another role UUID before contact enrichment', async () => {
    expect(await checkExistingLeadForPersonActivity({ person_id: currentId, site_id: 'site', icp_role_identity: true }))
      .toMatchObject({ success: true, hasExistingLead: true, existingLead: { id: 'canonical', person_id: oldId } });
  });

  it('reuses rather than inserts and preserves identity, contacts, owner, commercial state and research', async () => {
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: true, leadId: 'canonical' });
    const { rows } = await mockDb.query('SELECT * FROM leads');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ person_id: oldId, email: '', personal_email: input.personal_email,
      status: 'qualified', user_id: 'original-owner', segment_id: 'new-segment',
      metadata: { research: { report: 'keep' }, finder: { fresh: true } } });
    expect(mockQueries.some(query => query.operation === 'insert')).toBe(false);
  });

  it('recovers a real 23505 race on email="" using role identity instead of replaying the insert', async () => {
    await mockDb.exec('DELETE FROM leads');
    mockBeforeInsert = async () => {
      await mockDb.query(`INSERT INTO leads(id,site_id,person_id,name,email,personal_email,status,metadata)
        VALUES ('race-winner','site',$1,'Yamil Morales','','yamil@example.test','qualified','{"research":{"report":"keep"}}')`, [oldId]);
    };
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: true, leadId: 'race-winner' });
    expect(mockQueries.filter(query => query.operation === 'insert')).toHaveLength(1);
    const { rows } = await mockDb.query('SELECT * FROM leads');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'race-winner',person_id: oldId,status: 'qualified',segment_id: 'new-segment' });
  });

  it('does not recover a race by choosing among ambiguous identity-linked winners', async () => {
    await mockDb.exec('DELETE FROM leads');
    mockBeforeInsert = async () => {
      await mockDb.exec(`INSERT INTO persons(id,external_person_id) VALUES ('race-role',84462653);
        INSERT INTO leads(id,site_id,person_id,name,email,personal_email) VALUES
        ('winner','site','${oldId}','Yamil Morales','','yamil@example.test'),
        ('ambiguous','site','race-role','Yamil Morales','other@example.test','yamil@example.test')`);
    };
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('Multiple same-site leads') });
    expect(mockQueries.some(query => query.operation === 'update')).toBe(false);
  });

  it('retains a database update failure rather than acknowledging a reused match', async () => {
    const query = mockDb.query;
    mockDb.query = async (sql: string,values: any[]) => {
      if (sql.startsWith('UPDATE "leads"')) throw new Error('canonical update failed');
      return query(sql,values);
    };
    try {
      expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: 'canonical update failed' });
    } finally { mockDb.query = query; }
    const { rows } = await mockDb.query('SELECT * FROM leads');
    expect(rows[0].segment_id).toBe('old-segment');
  });

  it('never reads or updates another site lead even with identical provider identity', async () => {
    await mockDb.exec("UPDATE leads SET site_id='other-site'");
    expect(await checkExistingLeadForPersonActivity({ person_id: currentId, site_id: 'site', icp_role_identity: true }))
      .toMatchObject({ success: true,hasExistingLead: false });
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: true });
    const { rows } = await mockDb.query("SELECT * FROM leads WHERE site_id='other-site'");
    expect(rows[0]).toMatchObject({ id: 'canonical',segment_id: 'old-segment',person_id: oldId });
    expect(mockQueries.filter(query => query.table === 'leads').every(query =>
      query.operation === 'insert' ? query.payload.site_id === 'site' : query.params.includes('site'))).toBe(true);
  });

  it('does not merge a homonym even when the name, empty email and personal email are identical', async () => {
    await mockDb.query("UPDATE persons SET external_person_id=999,linkedin_profile='https://linkedin.com/in/other' WHERE id=$1",[oldId]);
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('leads_site_name_email_unique') });
    expect(mockQueries.some(query => query.operation === 'update')).toBe(false);
  });

  it('rejects contradictory LinkedIn evidence despite a shared provider ID', async () => {
    await mockDb.query("UPDATE persons SET linkedin_profile='https://linkedin.com/in/different' WHERE id=$1",[oldId]);
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('Conflicting Finder') });
    expect(mockQueries.some(query => query.operation !== 'select')).toBe(false);
  });

  it('does not arbitrarily choose among multiple same-site leads for one stable identity', async () => {
    await mockDb.exec(`INSERT INTO persons(id,external_person_id,full_name) VALUES ('third-role',84462653,'Yamil Morales');
      INSERT INTO leads(id,site_id,person_id,name,email,personal_email) VALUES ('second-lead','site','third-role','Yamil Morales','other@example.test','yamil@example.test')`);
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('Multiple same-site leads') });
    expect(mockQueries.some(query => query.operation !== 'select')).toBe(false);
  });

  it('supports canonical LinkedIn identity when the source has no provider ID', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL,linkedin_profile=$2 WHERE id=$1',[currentId,'https://linkedin.com/in/yamilmorales']);
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: true,leadId: 'canonical' });
  });

  it('rejects conflicting provider IDs behind one LinkedIn identity', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL WHERE id=$1',[currentId]);
    await mockDb.exec(`INSERT INTO persons(id,external_person_id,linkedin_profile) VALUES ('conflict',999,'https://www.linkedin.com/in/yamilmorales/')`);
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('Conflicting Finder provider') });
  });

  it('does not accept a spoofed LinkedIn hostname as person identity', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL,linkedin_profile=$2 WHERE id=$1',[currentId,'https://linkedin.com.evil.test/in/yamilmorales/']);
    expect(await checkExistingLeadForPersonActivity({ person_id: currentId,site_id: 'site',icp_role_identity: true }))
      .toMatchObject({ success: true,hasExistingLead: false });
  });

  it('keeps exact bigint identities without rounding or conflating neighboring provider IDs', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=$2 WHERE id=$1',[currentId,'9007199254740993']);
    await mockDb.query('UPDATE persons SET external_person_id=$2 WHERE id=$1',[oldId,'9007199254740992']);
    expect(await checkExistingLeadForPersonActivity({ person_id: currentId,site_id: 'site',icp_role_identity: true }))
      .toMatchObject({ success: true,hasExistingLead: false });
  });

  it('fails closed on an identity role set larger than the safety bound', async () => {
    await mockDb.exec("INSERT INTO persons(id,external_person_id) SELECT 'role-'||n,84462653 FROM generate_series(1,100) n");
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('role safety limit') });
    expect(mockQueries.some(query => query.operation !== 'select')).toBe(false);
  });

  it('does not turn a failed identity read into an insert or a match', async () => {
    const query = mockDb.query;
    mockDb.query = async (sql: string,values: any[]) => {
      if (sql.startsWith('SELECT * FROM "persons"')) throw new Error('identity read unavailable');
      return query(sql,values);
    };
    try {
      expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: false,error: expect.stringContaining('identity read unavailable') });
      expect(mockQueries.some(query => query.operation !== 'select')).toBe(false);
    } finally { mockDb.query = query; }
  });

  it('resumes page 7 past the two-UUID personal-email-only candidate and checkpoints the next candidate', async () => {
    await mockDb.exec(`INSERT INTO persons(id,external_person_id,full_name) VALUES ('next-person',2,'Bob');
      INSERT INTO leads(id,site_id,person_id,name,email,personal_email,metadata) VALUES ('next-lead','site','next-person','Bob','','bob@example.test','{}')`);
    const forbidden = jest.fn(() => { throw new Error('Unnecessary contact lookup'); });
    const deps: any = { prepareFinderPersonActivity: async (options: any) => {
      const id = options.person_id === '84462653' ? currentId : 'next-person';
      const { rows } = await mockDb.query('SELECT * FROM persons WHERE id=$1', [id]);
      return { success: true, errors: [], person: rows[0], role: {} };
    }, checkExistingLeadForPersonActivity, upsertLeadForPersonActivity, upsertPersonActivity: forbidden,
      lookEmailOnIcyPeas: forbidden, callPersonWorkEmailsActivity: forbidden,
      callPersonContactsLookupPersonalEmailsActivity: forbidden, callPersonContactsLookupPhoneNumbersActivity: forbidden,
      validateContactInformation: forbidden };
    const checkpoint = jest.fn().mockResolvedValue({ success: true });
    const result = await processPageSafely({ icp_mining_id: 'list', role_query_id: 'query', site_id: 'site', userId: 'owner',
      page: 7, start_index: 0, max_candidates: 10, max_matches: 10,
      execution: { run_id: 'run', version: 0, processed: 70, found: 58 },
      snapshot: { page: 7, hasMore: true, candidates: [{ person: { id: 84462653, full_name: 'Yamil Morales' } },
        { person: { id: 2, full_name: 'Bob' } }] } }, {
      getRoleQueryByIdActivity: forbidden, callPersonRoleSearchActivity: forbidden,
      getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true, segmentId: 'new-segment' }),
      checkpointIcpMiningExecutionActivity: checkpoint, getLeadActivity: forbidden, research: forbidden,
      enrich: options => enrichWithValidatedContacts(options,deps,{ trustProviderEmails: true,reuseExistingLeadOnly: true,resolveRoleIdentity: true }),
    });
    expect(result).toMatchObject({ success: true, errors: [], processed: 2, foundMatches: 2,
      leadsCreated: ['canonical','next-lead'], checkpoint: { processed: 72,found: 60,page: 8,offset: 0,snapshot: null } });
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('preserves legacy check behavior without the explicit ICP identity option', async () => {
    expect(await checkExistingLeadForPersonActivity({ person_id: currentId,site_id: 'site' }))
      .toMatchObject({ success: true,hasExistingLead: false });
    expect(mockQueries).toHaveLength(1);
  });

  it.each([currentId,oldId])('rejects ambiguity even when a lead is directly linked to %s', async personId => {
    await mockDb.query(`INSERT INTO leads(id,site_id,person_id,name,email,personal_email)
      VALUES ('direct-lead','site',$1,'Yamil Morales','second@example.test','yamil@example.test')`,[currentId]);
    expect(await checkExistingLeadForPersonActivity({ person_id: personId,site_id: 'site',icp_role_identity: true }))
      .toMatchObject({ success: false,error: expect.stringContaining('Multiple same-site leads') });
    expect(await upsertLeadForPersonActivity({ ...input,person_id: personId }))
      .toMatchObject({ success: false });
    expect(mockQueries.some(query => query.operation !== 'select')).toBe(false);
  });

  it('rejects multiple directly linked leads even without a stable provider identity', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL,linkedin_profile=NULL WHERE id=$1',[oldId]);
    await mockDb.query(`INSERT INTO leads(id,site_id,person_id,name,email) VALUES ('second','site',$1,'Yamil Morales','other@example.test')`,[oldId]);
    expect(await checkExistingLeadForPersonActivity({ person_id: oldId,site_id: 'site',icp_role_identity: true }))
      .toMatchObject({ success: false,error: expect.stringContaining('Multiple same-site leads') });
  });

  it('includes country-host/case/query variants when checking LinkedIn conflicts', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL WHERE id=$1',[currentId]);
    await mockDb.exec(`INSERT INTO persons(id,external_person_id,linkedin_profile)
      VALUES ('hidden-role',999,'https://uk.linkedin.com/in/YamilMorales/?trk=profile#about')`);
    expect(await upsertLeadForPersonActivity(input))
      .toMatchObject({ success: false,error: expect.stringContaining('Conflicting Finder provider') });
  });

  it('filters spoofed hosts and similarly prefixed LinkedIn identifiers from broad retrieval', async () => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL WHERE id=$1',[currentId]);
    await mockDb.exec(`INSERT INTO persons(id,external_person_id,linkedin_profile) VALUES
      ('spoof',999,'https://evil.test/linkedin.com/in/yamilmorales'),
      ('prefix',999,'https://linkedin.com/in/yamilmorales-other')`);
    expect(await upsertLeadForPersonActivity(input)).toMatchObject({ success: true,leadId: 'canonical' });
  });
  it.each(['https://linkedin.com:443/in/yamilmorales/', 'https://linkedin.com/other/../in/yamilmorales/',
    ' https://linkedin.com/in/yamilmorales/', 'https://linkedin.com/in/yamil%6dorales/'])
  ('does not accept unsupported raw LinkedIn identity %s', async linkedin => {
    await mockDb.query('UPDATE persons SET external_person_id=NULL,linkedin_profile=$2 WHERE id=$1',[currentId,linkedin]);
    expect(await checkExistingLeadForPersonActivity({ person_id: currentId,site_id: 'site',icp_role_identity: true }))
      .toMatchObject({ success: true,hasExistingLead: false });
  });
});