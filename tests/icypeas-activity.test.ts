const mockRequest = jest.fn();
const mockContext = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { request: mockRequest } }));
jest.mock('@temporalio/activity', () => ({ Context: { current: mockContext } }));
import { lookEmailOnIcyPeas } from '../src/temporal/activities/icypeasActivities';

const options = { site_id: '9be0a6a2-5567-41bf-ad06-cb4014f0faf2', firstname: 'Ada', lastname: 'Example', domainOrCompany: 'acme.test' };
describe('registered IcyPeas activity boundary', () => {
  beforeEach(() => { jest.resetAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('uses the durable API and cancellation-aware activity sleep until the result is complete', async () => {
    const controller = new AbortController();
    const sleep = jest.fn().mockResolvedValue(undefined);
    mockContext.mockReturnValue({ sleep, cancellationSignal: controller.signal });
    mockRequest.mockResolvedValueOnce({ success: true, data: { outcome: 'pending', status: 'NONE', searchId: 'saved', retryAfterMs: 60_000 } })
      .mockResolvedValueOnce({ success: true, data: { outcome: 'matched', status: 'FOUND', searchId: 'saved', emails: [{ email: 'ada@acme.test' }] } });
    expect(await lookEmailOnIcyPeas(options)).toMatchObject({ success: true, searchId: 'saved', data: { email: 'ada@acme.test' } });
    expect(sleep).toHaveBeenCalledWith(60_000);
    for (const [endpoint, request] of mockRequest.mock.calls) {
      expect(endpoint).toBe('/api/integrations/icypeas/email-search/resolve');
      expect(request).toMatchObject({ method: 'POST', body: options, signal: controller.signal, timeout: 20_000 });
    }
  });

  it('does not submit a legacy unscoped search or convert it to success', async () => {
    mockContext.mockImplementation(() => { throw new Error('outside activity'); });
    expect(await lookEmailOnIcyPeas({ domainOrCompany: 'acme.test', firstname: 'Ada' })).toMatchObject({ success: false, outcome: 'failed' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not swallow Temporal cancellation into a successful empty lookup', async () => {
    const controller = new AbortController();
    const cancellation = new Error('cancelled');
    mockContext.mockReturnValue({ cancellationSignal: controller.signal, sleep: async () => {
      controller.abort(cancellation); throw cancellation;
    } });
    mockRequest.mockResolvedValue({ success: true, data: { outcome: 'pending', status: 'NONE', searchId: 'saved' } });
    await expect(lookEmailOnIcyPeas(options)).rejects.toBe(cancellation);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});