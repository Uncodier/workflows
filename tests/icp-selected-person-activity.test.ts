const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockPost = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { rpc: mockRpc, from: mockFrom } }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: mockPost } }));
import { getSelectedIcpPersonActivity, readSelectedIcpPeopleActivity } from '../src/temporal/activities/icpSelectedPeopleActivities';
import { normalizeFinderPerson } from '../src/temporal/utils/finderData';

const identity = { id: 'list', site_id: 'site', run_id: 'run', ordinal: '9007199254740993' };
const person = { id: '12345', first_name: 'Carlos', roles: [{ id: 'role', organization: { name: 'Company' } }] };
const mockSingle = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  mockRpc.mockResolvedValue({ data: { person_id: '12345', created_by: 'creator' } });
  const query: any = { maybeSingle: mockSingle };
  for (const method of ['select', 'eq', 'order', 'limit']) query[method] = jest.fn(() => query);
  mockFrom.mockReturnValue(query); mockSingle.mockResolvedValue({ data: null });
});

it.each([person, { person }])('reuses persisted real Finder raw_result and normalizes without details calls: %j', async raw => {
  mockSingle.mockResolvedValue({ data: { raw_result: raw, updated_at: new Date().toISOString() } });
  const source = await getSelectedIcpPersonActivity(identity);
  expect(source).toEqual(raw);
  expect(normalizeFinderPerson(source)).toMatchObject(person);
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledWith('get_selected_icp_member', expect.objectContaining({ p_ordinal: identity.ordinal }));
});

it.each([person, { person }, { data: person }, { data: { person } }])('accepts actual upstream details payload and API data wrapper: %j', async payload => {
  // apiService adds its response envelope; the API forwards upstream JSON unchanged.
  mockPost.mockResolvedValue({ success: true, data: payload });
  const source = await getSelectedIcpPersonActivity(identity);
  expect(normalizeFinderPerson(source)).toMatchObject(person);
  expect(mockPost).toHaveBeenCalledWith('/api/finder/person_contacts_lookup/details', {
    person_id: '12345', site_id: 'site', userId: 'creator',
  });
});

it('rejects upstream identity mismatch instead of enriching a different selected person', async () => {
  mockPost.mockResolvedValue({ success: true, data: { person: { id: 'other-person' } } });
  await expect(getSelectedIcpPersonActivity(identity)).rejects.toThrow('identity mismatch');
});

it('never accepts a role ID as evidence of a person ID, even if both equal the selection', async () => {
  const wrongRole = { id: '12345', person: { name: 'Unverified person' } };
  mockSingle.mockResolvedValue({ data: { raw_result: wrongRole, updated_at: new Date().toISOString() } });
  mockPost.mockResolvedValue({ success: true, data: wrongRole });
  await expect(getSelectedIcpPersonActivity(identity)).rejects.toThrow('identity mismatch');
  expect(mockPost).toHaveBeenCalledTimes(1);
});

it('rejects a details error envelope even when its nested data contains a matching ID', async () => {
  mockPost.mockResolvedValue({ success: true, data: { success: false, error: 'Lookup failed', data: person } });
  await expect(getSelectedIcpPersonActivity(identity)).rejects.toThrow('Lookup failed');
});

it.each([
  { pending: 1, members: [] },
  { pending: 0, members: [{ ordinal: '4', person_id: '12345', created_by: 'actor' }] },
  { pending: 1, members: [{ ordinal: 4, person_id: '12345', created_by: 'actor' }] },
])('rejects incomplete or invalid membership evidence rather than falling back to search', async invalid => {
  mockRpc.mockResolvedValue({ data: { selectedOnly: false, searchExhausted: false, ...invalid } });
  await expect(readSelectedIcpPeopleActivity(identity)).rejects.toThrow(/Invalid selected ICP/);
  expect(mockPost).not.toHaveBeenCalled();
});

it('fails before all database person/provider reads when persisted creator authorization is revoked', async () => {
  mockRpc.mockResolvedValue({ error: { message: 'Selected member creator has no active site license' } });
  await expect(getSelectedIcpPersonActivity(identity)).rejects.toThrow('active site license');
  expect(mockFrom).not.toHaveBeenCalled(); expect(mockPost).not.toHaveBeenCalled();
});

it('refreshes stale verified cache once under member attribution', async () => {
  mockSingle.mockResolvedValue({ data: { raw_result: person, updated_at: '2020-01-01' } });
  mockPost.mockResolvedValue({ success: true, data: { ...person, skills: ['updated'] } });
  expect(await getSelectedIcpPersonActivity(identity)).toMatchObject({ skills: ['updated'] });
  expect(mockPost).toHaveBeenCalledTimes(1);
});

it('rejects a rounded JSON number even when its coerced digits resemble the selection', async () => {
  mockRpc.mockResolvedValue({ data: { person_id: '9007199254740992', created_by: 'creator' } });
  mockPost.mockResolvedValue({ success: true, data: { id: 9007199254740992 } });
  await expect(getSelectedIcpPersonActivity(identity)).rejects.toThrow('identity mismatch');
});

it.each(['membership', 'cache', 'invalid ID'])('classifies a definite pre-provider failure (%s) only on patched requests', async cause => {
  if (cause === 'membership') mockRpc.mockResolvedValue({ error: { message: 'revoked' } });
  if (cause === 'cache') mockSingle.mockRejectedValue(new Error('DB timeout'));
  if (cause === 'invalid ID') mockRpc.mockResolvedValue({ data: { person_id: {}, created_by: 'actor' } });
  await expect(getSelectedIcpPersonActivity({ ...identity, classifyPreflight: true }))
    .rejects.toMatchObject({ type: 'SELECTED_SOURCE_NOT_STARTED', nonRetryable: true });
  await expect(getSelectedIcpPersonActivity(identity)).rejects.not.toHaveProperty('nonRetryable');
  expect(mockPost).not.toHaveBeenCalled();
});

it.each(['uncertain transport', 'mismatched response'])('never classifies a provider failure as unstarted: %s', async label => {
  if (label === 'uncertain transport') mockPost.mockRejectedValue(new Error('uncertain transport'));
  else mockPost.mockResolvedValue({ success: true, data: { id: 'not-selected' } });
  await expect(getSelectedIcpPersonActivity({ ...identity, classifyPreflight: true })).rejects.not.toHaveProperty('type', 'SELECTED_SOURCE_NOT_STARTED');
  expect(mockPost).toHaveBeenCalledTimes(1);
});
