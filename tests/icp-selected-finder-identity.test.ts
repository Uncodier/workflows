import { selectedFinderStore } from './fixtures/selectedFinderStore';
const mockPost = jest.fn();
const observedEnrichment = jest.fn();
let mockStore: Awaited<ReturnType<typeof selectedFinderStore>>;
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {
  from: (table: string) => mockStore.from(table), rpc: (name: string, args: any) => mockStore.rpc(name, args),
} }));
jest.mock('../src/temporal/services', () => ({ getSupabaseService: () => ({ getConnectionStatus: async () => true }) }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: mockPost } }));

import * as finder from '../src/temporal/activities/finderActivities';
import { acknowledgeSelectedIcpPersonActivity, getSelectedIcpPersonActivity, readSelectedIcpPeopleActivity, reconcileSelectedIcpPersonAckActivity } from '../src/temporal/activities/icpSelectedPeopleActivities';
import { processSelectedPeople } from '../src/temporal/workflows/icpMining/processSelectedPeople';
import { enrichWithValidatedContacts } from '../src/temporal/workflows/icpMining/enrichWithValidatedContacts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const site = uuid(1), actor = uuid(901), owner = uuid(902), ordinalRun = uuid(903), list = uuid(101);
const identity = { id: list, site_id: site, run_id: ordinalRun };
const detailsPath = '/api/finder/person_contacts_lookup/details';
const contactPath = '/api/finder/person_contacts_lookup/work_emails';
const email = 'confirmed@example.test';
const query = (sql: string, args?: any[]): Promise<{ rows: any[] }> => mockStore.sql(sql, args);

beforeAll(async () => { mockStore = await selectedFinderStore(); });
afterAll(async () => { await mockStore?.close(); });
beforeEach(async () => {
  jest.resetAllMocks(); delete mockStore.hooks.beforeRpc; delete mockStore.hooks.beforeContactCheck;
  await query('BEGIN');
  await query('INSERT INTO auth.users VALUES ($1),($2)', [actor, owner]);
  await query('UPDATE sites SET user_id=$1 WHERE id=$2', [owner, site]);
  await query("INSERT INTO site_members(id,site_id,user_id,status,licensed) VALUES ($1,$2,$1,'active',true)", [actor, site]);
  await query(`UPDATE icp_mining SET user_id=$1,icp_criteria='{"source":"selected_people"}' WHERE id=$2`, [actor,list]);
});
afterEach(async () => { await query('ROLLBACK'); });

async function addMember(id: string) {
  await query('INSERT INTO icp_mining_people (icp_mining_id,site_id,person_id,created_by) VALUES ($1,$2,$3,$4)', [list,site,id,actor]);
  await query("SELECT claim_icp_mining_execution($1,$2,$3,'finder-identity-test')", [list,site,ordinalRun]);
}
function providerDetails(id: string, doc: Record<string,unknown> = {}) {
  mockPost.mockImplementation(async (path: string, payload: any) => {
    if (path === detailsPath && payload.person_id === id && payload.userId === actor && payload.site_id === site) {
      return { success: true, data: { data: { person: { id, full_name: 'Ada', ...doc } } } };
    }
    if (path === contactPath && payload.person_id === id && payload.site_id === site) return { success: true, data: { emails: [email] } };
    throw new Error(`Unexpected provider request: ${path}`);
  });
}
async function processMember() {
  const state = await readSelectedIcpPeopleActivity(identity);
  const forbidden = jest.fn(() => { throw new Error('Unexpected external activity'); });
  return processSelectedPeople({ ...identity, version: 0, processed: 0, found: 0, max_candidates: 1, max_matches: 1,
    research_enabled: false, state }, {
    acknowledgeSelectedIcpPersonActivity, reconcileSelectedIcpPersonAckActivity, getSelectedIcpPersonActivity, getLeadActivity: forbidden, research: forbidden,
    enrich: async options => {
      const result = await enrichWithValidatedContacts(options, { ...finder, validateContactInformation: forbidden, lookEmailOnIcyPeas: forbidden },
        { trustProviderEmails: true, reuseExistingLeadOnly: true, resolveRoleIdentity: true });
      observedEnrichment(result); return result;
    },
  });
}
const memberOutcome = async () => (await query(`SELECT m.processing_status,m.outcome,m.lead_id,l.user_id,l.person_id AS local_id,
  p.external_person_id::text AS numeric_id,p.finder_selected_person_id AS opaque_id,
  m.person_id=coalesce(p.finder_selected_person_id,p.external_person_id::text) AS exact,r.processed_targets,r.found_matches
  FROM icp_mining_people m JOIN icp_mining r ON r.id=m.icp_mining_id LEFT JOIN leads l ON l.id=m.lead_id AND l.site_id=m.site_id
  LEFT JOIN persons p ON p.id=l.person_id WHERE m.icp_mining_id=$1`, [list])).rows[0];
const person = async (id: string, provider: string | null, numeric: string | null, role = '1', doc: Record<string,unknown> = {}) =>
  query(`INSERT INTO persons(id,finder_selected_person_id,external_person_id,external_role_id,raw_result)
    VALUES ($1,$2,$3,$4,$5)`, [id,provider,numeric,role,JSON.stringify(doc)]);
const foreignLead = async (personId: string | null, siteId = site) => query(`INSERT INTO leads(id,site_id,user_id,person_id,name,email,metadata)
  VALUES ($1,$2,$3,$4,'Ada',$5,'{"research":{"original":true},"finder":{"prior":true}}')`, [uuid(940),siteId,owner,personId,email]);

it.each([
  ['12345',true], ['9007199254740993',true], ['9223372036854775807',true], ['0',true],
  ['9223372036854775808',false], ['0012345',false], ['A.b:_-9',false], [uuid(942),false],
])('consumes a cold verified profile once and persists exact SQL identity for %s', async (id, numeric) => {
  const providerId = String(id);
  await addMember(providerId); providerDetails(providerId);
  // For UUID-shaped provider IDs, a local row with exactly that UUID is unrelated.
  await person(uuid(942), null, '42');
  expect(await processMember()).toMatchObject({ success: true, found: 1 });
  expect(await memberOutcome()).toMatchObject({ processing_status: 'completed', outcome: 'matched', exact: true,
    numeric_id: numeric ? providerId : null, opaque_id: numeric ? null : providerId, user_id: actor });
  expect(mockPost.mock.calls.map(([path, body]) => [path,body.person_id])).toEqual([[detailsPath,providerId],[contactPath,providerId]]);
});

it('reuses an exact sibling role (not another tenant) with no provider calls or identity/contact writes', async () => {
  const id = 'Candidate:X';
  await addMember(id);
  await person(uuid(910),id,null,'1',{ id, full_name: 'New name' });
  await person(uuid(911),id,null,'2',{ id, full_name: 'New name' });
  await query('UPDATE persons SET created_at=now()-interval \'1 day\' WHERE id=$1',[uuid(911)]);
  await foreignLead(uuid(911));
  await query(`UPDATE leads SET metadata=metadata || '{"emailVerified":true}'::jsonb WHERE id=$1`,[uuid(940)]);
  await query("INSERT INTO leads(id,site_id,person_id,name,email) VALUES ($1,$2,$3,'Ada',$4)",[uuid(941),uuid(2),uuid(910),email]);
  expect(await processMember()).toMatchObject({ found: 1, errors: [] });
  expect(await memberOutcome()).toMatchObject({ exact: true, local_id: uuid(911), lead_id: uuid(940), user_id: owner });
  expect((await query('SELECT * FROM leads WHERE id=$1',[uuid(940)])).rows[0]).toMatchObject({ email,name:'Ada',
    metadata: { research: { original:true }, finder: { prior:true, person: { id } } } });
  expect(mockPost).not.toHaveBeenCalled();
});

async function expectConflictReview(id: string) {
  expect(await memberOutcome()).toMatchObject({ processing_status:'completed',outcome:'needs_review',lead_id:null,processed_targets:1,found_matches:0 });
  const { rows } = await query('SELECT id FROM persons WHERE coalesce(finder_selected_person_id,external_person_id::text)=$1',[id]);
  const [child] = observedEnrichment.mock.calls[0];
  expect(child).toMatchObject({ success:true,outcome:'needs_review',selectedIdentityReview:{siteId:site,providerId:id,reason:'conflicting_lead_identity'} });
  expect(rows.map(row => row.id)).toContain(child.personId); expect(child.leadId).toBeUndefined();
  const calls = mockPost.mock.calls.length;
  expect((await readSelectedIcpPeopleActivity(identity)).pending).toBe(0);
  await processMember();
  expect(observedEnrichment).toHaveBeenCalledTimes(1); expect(mockPost).toHaveBeenCalledTimes(calls);
}

it.each([false,true])('leaves a conflicting foreign or unlinked name/email untouched (insert race=%s)', async race => {
  const id = '000123';
  await addMember(id); providerDetails(id,{ emails:[email] }); await person(uuid(910),null,'123');
  if (race) mockStore.hooks.beforeRpc = async rpc => {
    if (rpc === 'insert_selected_finder_lead') { delete mockStore.hooks.beforeRpc; await foreignLead(null); }
  };
  else await foreignLead(uuid(910));
  expect(await processMember()).toMatchObject({ success:true,processed:1,found:0 });
  await expectConflictReview(id);
  const { rows } = await query('SELECT user_id,person_id,metadata FROM leads');
  expect(rows).toEqual([{user_id:owner,person_id:race ? null : uuid(910),metadata:{research:{original:true},finder:{prior:true}}}]);
});

it('does not update a lead whose linked provider identity changed after the exact read', async () => {
  const id = 'selected';
  await addMember(id); await person(uuid(910),id,null,'1',{id,full_name:'Selected'}); await foreignLead(uuid(910));
  await query(`UPDATE leads SET metadata=metadata || '{"emailVerified":true}'::jsonb`);
  mockStore.hooks.beforeRpc = async rpc => {
    if (rpc === 'update_selected_finder_lead') await query('UPDATE persons SET finder_selected_person_id=$1 WHERE id=$2',['someone-else',uuid(910)]);
  };
  expect(await processMember()).toMatchObject({ retryableFailure:true,errors: [expect.stringContaining('identity mismatch')] });
  expect(await memberOutcome()).toMatchObject({ processing_status:'pending', found_matches:0 });
  expect((await query('SELECT metadata FROM leads')).rows[0].metadata.finder).toEqual({ prior:true });
  expect(mockPost).not.toHaveBeenCalled();
});

it('rechecks only exact provider identity when a sibling-role lead wins an insert race', async () => {
  const id='opaque.race'; await addMember(id); providerDetails(id,{ emails:[email] });
  mockStore.hooks.beforeRpc = async rpc => {
    if (rpc === 'insert_selected_finder_lead') {
      delete mockStore.hooks.beforeRpc;
      await person(uuid(910),id,null,'2',{id}); await foreignLead(uuid(910));
    }
  };
  expect(await processMember()).toMatchObject({ success:true,found:1 });
  expect(await memberOutcome()).toMatchObject({ exact:true, local_id:uuid(910),lead_id:uuid(940),user_id:owner });
});

it('does not buy contacts or merge another identity into a person with conflicting cached evidence', async () => {
  await addMember('opaque'); await person(uuid(912),'opaque',null,'2',{ id:'different', emails:[email] });
  providerDetails('opaque');
  expect(await processMember()).toMatchObject({ retryableFailure:true,errors:[expect.stringContaining('Conflicting persisted')] });
  expect(mockPost.mock.calls.map(([path]) => path)).toEqual([detailsPath]);
  expect(await memberOutcome()).toMatchObject({ processing_status:'pending',found_matches:0 });
  expect((await query('SELECT raw_result FROM persons')).rows).toEqual([{raw_result:{id:'different',emails:[email]}}]);
});

it('preserves another writer’s Finder metadata on a CAS race and keeps the member pending', async () => {
  const id='cas'; await addMember(id); await person(uuid(912),id,null,'2',{id}); await foreignLead(uuid(912));
  await query(`UPDATE leads SET metadata=metadata || '{"emailVerified":true}'::jsonb`);
  mockStore.hooks.beforeRpc = async rpc => {
    if (rpc === 'update_selected_finder_lead') await query(`UPDATE leads SET metadata=jsonb_set(metadata,'{finder}','{"concurrent":true}')`);
  };
  expect(await processMember()).toMatchObject({ retryableFailure:true,found:0,errors:[expect.stringContaining('Concurrent Finder metadata change')] });
  expect((await query('SELECT metadata FROM leads')).rows[0].metadata.finder).toEqual({concurrent:true});
  expect(mockPost).not.toHaveBeenCalled();
});

it('rejects a mismatched supplied source in preparation before any DB write or provider lookup', async () => {
  expect(await finder.prepareFinderPersonActivity({ person_id:'008',site_id:site,source_search_result:{id:'008',person:{id:8}},
    selected_member_attribution:true })).toMatchObject({ success:false,error:expect.stringContaining('source identity mismatch') });
  expect((await query('SELECT id FROM persons')).rows).toHaveLength(0);
  expect(mockPost).not.toHaveBeenCalled();
});


it('reviews two distinct exact same-site leads without buying contacts or choosing either one', async () => {
  const id='duplicate'; await addMember(id); await person(uuid(912),id,null,'2',{id}); await foreignLead(uuid(912));
  await query("INSERT INTO leads(site_id,person_id,name,email) VALUES($1,$2,'Different','diff@example.test')",[site,uuid(912)]);
  expect(await processMember()).toMatchObject({ success:true,processed:1,found:0 });
  await expectConflictReview(id);
  expect(mockPost).not.toHaveBeenCalled();
  expect((await query('SELECT count(*)::integer AS n FROM leads')).rows).toEqual([{n:2}]);
});

it.each(['deleted', 'moved-site', 'different-key', 'failed-read'])('keeps an unproven contact-key conflict pending: %s', async cause => {
  const id='close-race'; await addMember(id); providerDetails(id,{ emails:[email] }); await foreignLead(null);
  mockStore.hooks.beforeContactCheck = async () => {
    if (cause==='deleted') await query('DELETE FROM leads');
    else if (cause==='moved-site') await query('UPDATE leads SET site_id=$1',[uuid(2)]);
    else if (cause==='different-key') await query("UPDATE leads SET email='changed@example.test'");
    else throw new Error('fixture read failed');
  };
  expect(await processMember()).toMatchObject({ retryableFailure:true,processed:0,found:0 });
  expect(await memberOutcome()).toMatchObject({processing_status:'pending',outcome:null,lead_id:null});
  expect(observedEnrichment.mock.calls[0][0].selectedIdentityReview).toBeUndefined();
});

it('does not convert an unrelated 23505 to review', async () => {
  await query('CREATE UNIQUE INDEX fixture_other_unique ON leads(site_id,lower(name))');
  const id='not-the-same-key'; await addMember(id); providerDetails(id,{emails:[email]});
  await query("INSERT INTO leads(site_id,name,email) VALUES ($1,'ADA','other@example.test')",[site]);
  expect(await processMember()).toMatchObject({ retryableFailure:true,processed:0,found:0 });
  expect(await memberOutcome()).toMatchObject({processing_status:'pending',found_matches:0});
  expect(observedEnrichment.mock.calls[0][0].errors.join()).toContain('fixture_other_unique');
  expect(observedEnrichment.mock.calls[0][0].selectedIdentityReview).toBeUndefined();
});
