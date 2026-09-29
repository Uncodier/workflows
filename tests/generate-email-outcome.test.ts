const mockActivities: Record<string, jest.Mock> = {};
const mockChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_, name: string) => mockActivities[name] ||= jest.fn() }),
  executeChild: (...args: any[]) => mockChild(...args), upsertSearchAttributes: jest.fn(),
}));
import { generatePersonEmailWorkflow } from '../src/temporal/workflows/generatePersonEmailWorkflow';

describe('generated email definitive vs retryable result', () => {
  const options = { person_id: 'person', full_name: 'Ada Example', company_name: 'Acme', company_domain: 'acme.test', site_id: 'site', reportOutcome: true };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockActivities.leadContactGenerationActivity.mockResolvedValue({ success: true, email_generation_analysis: ['ada@acme.test'] });
    mockChild.mockResolvedValue({ success: true, data: { isValid: false, deliverable: false } });
  });
  afterEach(() => jest.restoreAllMocks());
  it('does not retry definitive invalid email results forever', async () => {
    expect(await generatePersonEmailWorkflow(options)).toMatchObject({ success: false, outcome: 'no_match' });
  });
  it('keeps validation outage retryable rather than definitive no-match', async () => {
    mockChild.mockResolvedValue({ success: false, error: { message: 'provider down' } });
    expect(await generatePersonEmailWorkflow(options)).toMatchObject({ success: false, outcome: 'retryable_error' });
  });
  it('keeps generation failure distinct from an empty successful response', async () => {
    mockActivities.leadContactGenerationActivity.mockResolvedValue({ success: false, error: 'provider down' });
    expect(await generatePersonEmailWorkflow(options)).not.toHaveProperty('outcome', 'no_match');
    mockActivities.leadContactGenerationActivity.mockResolvedValue({ success: true, email_generation_analysis: [] });
    expect(await generatePersonEmailWorkflow(options)).toMatchObject({ outcome: 'no_match' });
  });
});