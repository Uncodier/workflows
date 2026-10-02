const mockActivities: Record<string, jest.Mock> = {};
const mockChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_, name: string) => mockActivities[name] ||= jest.fn() }),
  executeChild: (...args: any[]) => mockChild(...args), upsertSearchAttributes: jest.fn(),
}));
import { generatePersonEmailWorkflow } from '../src/temporal/workflows/generatePersonEmailWorkflow';
import { validateEmailWorkflow } from '../src/temporal/workflows/validateEmailWorkflow';

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
    expect(mockChild).toHaveBeenCalledWith(validateEmailWorkflow, expect.objectContaining({
      args: [{ email: 'ada@acme.test', aggressiveMode: false }],
    }));
  });
  it('returns an AI-generated email only after successful deliverability validation', async () => {
    mockActivities.leadContactGenerationActivity.mockResolvedValue({ success: true,
      email_generation_analysis: ['invalid@acme.test', 'ada@acme.test', 'unused@acme.test'] });
    mockChild.mockResolvedValueOnce({ success: true, data: { isValid: false, deliverable: false } })
      .mockResolvedValueOnce({ success: true, data: { isValid: true, deliverable: true } });
    expect(await generatePersonEmailWorkflow(options)).toMatchObject({ success: true, outcome: 'matched',
      validatedEmail: 'ada@acme.test', validatedEmails: ['ada@acme.test'] });
    expect(mockChild).toHaveBeenCalledTimes(2);
    expect(mockChild).toHaveBeenNthCalledWith(2, validateEmailWorkflow, expect.objectContaining({
      args: [{ email: 'ada@acme.test', aggressiveMode: false }],
    }));
  });
  it('does not accept an AI guess when Reoon has no verification credits', async () => {
    mockChild.mockResolvedValue({ success: false, error: { code: 'NO_CREDITS', message: 'Reoon has no available verification credits' } });
    expect(await generatePersonEmailWorkflow(options)).toMatchObject({ success: false, outcome: 'retryable_error', validatedEmails: [] });
    expect(mockChild).toHaveBeenCalledTimes(1);
  });
  it('does not accept an AI guess without confirmed deliverability', async () => {
    mockChild.mockResolvedValue({ success: true, data: { isValid: true, deliverable: false } });
    expect(await generatePersonEmailWorkflow(options)).not.toHaveProperty('validatedEmail');
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