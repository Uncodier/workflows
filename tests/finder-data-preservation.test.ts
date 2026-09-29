import {
  contactValues, finderCompanyRecord, finderPersonRecord, finderResponseError,
  mergeFinderData, normalizeFinderPerson, personPersistencePayload, selectFinderRole,
} from '../src/temporal/utils/finderData';

export const searchResult = {
  id: 21, role_title: 'President', is_current: true, start_date: '2020-01-01',
  organization: { id: 31, name: 'Acme', domain: 'acme.test', description: 'Rich organization',
    linkedin_info: { public_profile_url: 'https://linkedin.com/company/acme', industry: { name: 'Software Development' } },
    employees_count: 250, funding_rounds: [{ round: 'B', amount: 1000000 }], custom_provider_field: 'retained' },
  person: { id: 11, full_name: 'Ada Example', location: { name: 'Mexico City', country: { code: 'MX' } },
    linkedin_info: { public_profile_url: 'https://linkedin.com/in/ada', headline: 'Founder' },
    skills: ['logistics'], work_emails: [{ email: 'ada@acme.test', validation_status: 'valid' }] },
  provider_score: 99,
};

describe('Finder provider data mapping', () => {
  it('merges role search, sparse details and prior raw data without dropping any rich fields', () => {
    const data = normalizeFinderPerson(searchResult, {
      id: 11, full_name: '', location: null,
      roles: [{ id: 21, organization: { id: 31, description: '', domain: null } }],
      educations: [{ id: 8, organization: { name: 'University' }, degree: 'Engineering' }],
    }, { biography: 'Existing biography', roles: [{ id: 22, organization: { name: 'Previous' } }] });
    const role = selectFinderRole(data, { source: searchResult });
    expect(role).toMatchObject({ id: 21, role_title: 'President', organization: searchResult.organization });
    expect(data).toMatchObject({ biography: 'Existing biography', full_name: 'Ada Example', location: searchResult.person.location,
      skills: ['logistics'], finder_search_result: searchResult });
    expect(data.roles).toHaveLength(2);
    expect(data.educations[0].degree).toBe('Engineering');
    expect(finderPersonRecord(data, role)).toMatchObject({ external_person_id: 11, external_role_id: 21,
      external_organization_id: 31, company_name: 'Acme', emails: ['ada@acme.test'], location: 'Mexico City' });
  });

  it('uses exact source role identity instead of unrelated current roles or substring names', () => {
    const data = { roles: [
      { id: 5, is_current: true, organization: { name: '' } },
      { id: 6, is_current: true, start_date: '2030-01-01', organization: { name: 'Acme Ventures' } },
      { id: 21, organization: { name: 'Acme' } },
    ] };
    expect(selectFinderRole(data, { source: searchResult, company_name: 'Acme' })?.id).toBe(21);
    expect(selectFinderRole(data, { company_name: 'Acme' })?.id).toBe(21);
  });

  it('keeps research, annotated contacts, arrays, false and zero on sparse refresh', () => {
    const existing = { role_query_id: 'query-1', full_name: 'Ada', emails: [{ email: 'ada@acme.test', validation_status: 'valid' }],
      phones: ['+1234'], personal_emails: ['ada@personal.test'], raw_result: { research: { report: 'deep report' }, skills: ['old'] } };
    const payload = personPersistencePayload(existing, { full_name: '', emails: [], phones: null, personal_emails: [],
      is_current: false, raw_result: { research: null, skills: ['new'], score: 0 } });
    expect(payload).toMatchObject({ emails: existing.emails, phones: existing.phones, personal_emails: existing.personal_emails,
      is_current: false, raw_result: { research: { report: 'deep report' }, skills: ['old', 'new'], score: 0 } });
    expect(payload).not.toHaveProperty('full_name');
    expect(payload).not.toHaveProperty('role_query_id');
    expect(contactValues(existing.emails, ['ADA@acme.test', 'second@test'], existing.phones)).toEqual(['ada@acme.test', 'second@test', '+1234']);
    expect(mergeFinderData(existing.emails, ['ada@acme.test'])).toEqual(existing.emails);
    expect(mergeFinderData(existing.emails, [{ email: 'ada@acme.test', validation_status: 'unknown', source: 'refresh' }]))
      .toEqual([{ email: 'ada@acme.test', validation_status: 'valid', source: 'refresh' }]);
  });

  it('maps only real company columns, never writes provider free-text into constrained enum columns', () => {
    const company = finderCompanyRecord(searchResult.organization);
    expect(company).toMatchObject({ name: 'Acme', website: 'acme.test', description: 'Rich organization', employees_count: 250 });
    expect(company).not.toHaveProperty('id');
    expect(company).not.toHaveProperty('industry');
    expect(company).not.toHaveProperty('metadata');
    expect(company).not.toHaveProperty('raw_result');
    expect(company).not.toHaveProperty('funding_rounds');
    expect(finderCompanyRecord({ name: 'Sparse', industry: 'technology', size: '51-200', is_public: false, employees_count: 0 }))
      .toMatchObject({ industry: 'technology', size: '51-200', is_public: false, employees_count: 0 });
  });

  it('recognizes provider errors hidden inside HTTP-200 envelopes', () => {
    expect(finderResponseError({ data: { success: false, error: { message: 'Quota exceeded' } } })).toBe('Quota exceeded');
    expect(finderResponseError({ error: 'Unavailable' })).toBe('Unavailable');
    expect(finderResponseError({ emails: [] })).toBeUndefined();
  });
});