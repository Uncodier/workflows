import { finderCompanyRecord } from '../src/temporal/utils/finderData';
import { hasDeepResearchOutput, inspectDeepResearchOutput } from '../src/temporal/utils/leadResearchState';

describe('research company schema mapping', () => {
  it('restores all supported structured fields except untrusted local identities/timestamps', () => {
    const input = { name: 'Acme', website: 'https://acme.test', industry: 'technology', size: '51-200',
      annual_revenue: '10M-50M', founded: '2001', description: 'Company facts', address: { city: 'Madrid' },
      legal_name: 'Acme Ltd', tax_id: 'TAX123', tax_country: 'ES', registration_number: 'REG456', vat_number: 'VAT789',
      legal_structure: 'ltd', phone: '+34911234567', email: 'contact@acme.test', linkedin_url: 'https://linkedin.com/company/acme',
      employees_count: 50, is_public: false, stock_symbol: 'ACME', logo_url: 'https://acme.test/logo.png', cover_image_url: 'https://acme.test/cover.png',
      social_media: { twitter: 'acme' }, key_people: [{ name: 'CEO' }], funding_info: { round: 'A' }, certifications: ['ISO'], awards: ['Award'],
      business_model: 'b2b', products_services: ['Analytics'], tech_stack: ['TS'], languages: ['es'], business_hours: { monday: '9-5' },
      video_url: 'https://acme.test/video', press_releases: [{ title: 'Launch' }], partnerships: [{ name: 'Partner' }], competitor_info: { primary: ['Competitor'] },
      sustainability_score: 0, diversity_info: { policy: 'Inclusive' }, remote_policy: 'hybrid', office_locations: [{ city: 'Madrid' }],
      market_cap: '9007199254740993', last_funding_date: '2026-09-01', ipo_date: '2020-02-29', acquisition_date: '2026-08-01' };
    expect(finderCompanyRecord({ ...input, id: 'model-local-id', parent_company_id: 'model-parent', acquired_by_id: 'model-acquirer',
      created_at: 'bad', updated_at: 'bad', unsupported: { keep: 'only in raw' } })).toEqual(input);
  });

  it.each([
    ['legal_structure', 'Not a valid legal structure'], ['business_model', 'Mixed'], ['remote_policy', 'Anywhere'],
    ['industry', 'AI and robotics'], ['size', '50-ish'], ['annual_revenue', '$1,000,000'],
    ['sustainability_score', -1], ['sustainability_score', 101], ['sustainability_score', 0.5],
    ['market_cap', '9223372036854775808'], ['market_cap', Number.MAX_SAFE_INTEGER + 1], ['market_cap', -10],
    ['last_funding_date', '2026-02-30'], ['ipo_date', 'no date'], ['acquisition_date', '2026-13-01'],
  ])('leaves invalid %s values in raw instead of sending schema-invalid data', (field, value) => {
    const raw = { name: 'Acme', [field]: value };
    expect(finderCompanyRecord(raw)).not.toHaveProperty(field);
    expect(raw[field]).toBe(value);
  });
});

describe('completed analysis evidence', () => {
  it.each(['timeout', 'running', 'pending', 'failed', 'not_initialized'])('rejects status %s with otherwise substantive output', status => {
    expect(hasDeepResearchOutput({ success: true, data: { status, deliverables: { company: { description: 'Partial findings' } } } })).toBe(false);
  });
  it('rejects missing status and identity/template-only deliverables', () => {
    expect(hasDeepResearchOutput({ success: true, data: { deliverables: { lead: { notes: 'No proof API completed' } } } })).toBe(false);
    expect(hasDeepResearchOutput({ success: true, data: { status: 'completed', deliverables: {
      lead: { company_id: 'wrong', segment_id: 'wrong' }, company: { name: 'Acme', languages: ['en'], _research_timestamp: '2026-09-29', is_public: false },
    } } })).toBe(false);
  });
  it('accepts alternate nested API envelope research_analysis and rejects an inner timeout', () => {
    const response = { success: true, data: { success: true, data: { status: 'completed', research_analysis: { conclusions: 'New verified conclusion' } } } };
    expect(inspectDeepResearchOutput(response)).toMatchObject({ completed: true, analysis: { conclusions: 'New verified conclusion' } });
    response.data.data.status = 'timeout';
    expect(hasDeepResearchOutput(response)).toBe(false);
  });
});