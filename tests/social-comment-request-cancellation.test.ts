const mockRequest = jest.fn();
const mockContext = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { request: mockRequest } }));
jest.mock('@temporalio/activity', () => ({ Context: { current: mockContext } }));
import { fetchOutstandPostRepliesActivity } from '../src/temporal/activities/outstandCommentActivities';

beforeEach(() => jest.resetAllMocks());

it('bounds HTTP below the two-minute activity timeout and forwards cancellation', async () => {
  const controller = new AbortController();
  mockContext.mockReturnValue({ cancellationSignal: controller.signal });
  mockRequest.mockResolvedValue({ success: true, data: [] });
  await expect(fetchOutstandPostRepliesActivity('site', 'post', 'facebook')).resolves.toEqual([]);
  expect(mockRequest).toHaveBeenCalledWith(expect.any(String), {
    method: 'GET', timeout: 90_000, signal: controller.signal,
  });
});

it('does not convert cancellation into a retryable LinkedIn provider error', async () => {
  const controller = new AbortController();
  const reason = new Error('Activity canceled');
  mockContext.mockReturnValue({ cancellationSignal: controller.signal });
  mockRequest.mockImplementation(async () => {
    controller.abort(reason);
    return { success: false, error: { message: 'Request aborted' } };
  });
  await expect(fetchOutstandPostRepliesActivity('site', 'post', 'linkedin')).rejects.toBe(reason);
});

it('keeps upstream 502 retryable and never treats it as an empty successful read', async () => {
  mockContext.mockImplementation(() => { throw new Error('No activity context'); });
  mockRequest.mockResolvedValue({ success: false, error: { status: 502, message: 'Provider unavailable' } });
  await expect(fetchOutstandPostRepliesActivity('site', 'post', 'linkedin')).rejects.toMatchObject({
    type: 'OUTSTAND_COMMENTS_ERROR', nonRetryable: false,
  });
});