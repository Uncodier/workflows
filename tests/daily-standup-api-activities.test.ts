const mockRequest = jest.fn();
const mockPost = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { request: mockRequest, post: mockPost } }));
jest.mock('../src/temporal/activities/validateEmailActivities', () => ({ validateEmail: jest.fn() }));
import { cmoWrapUpActivity } from '../src/temporal/activities/cmoActivities';
import { sendDailyStandUpNotificationActivity } from '../src/temporal/activities/apiActivities';

describe('Daily Standup API section contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequest.mockResolvedValue({ success: true, data: { subject: 'Standup', message: 'Selected report',
      summary: 'Selected report', command_id: 'generated-command', report_sections: ['records', 'inventory'] } });
    mockPost.mockResolvedValue({ success: true, data: { success: true } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('forwards section IDs as a top-level wrap-up parameter', async () => {
    expect(await cmoWrapUpActivity({ site_id: 'site', report_sections: ['records', 'inventory'] }))
      .toMatchObject({ success: true, report_sections: ['records', 'inventory'], command_id: 'generated-command', message: 'Selected report' });
    expect(mockRequest).toHaveBeenCalledWith('/api/agents/cmo/dailyStandUp/wrapUp', expect.objectContaining({
      method: 'POST', body: { site_id: 'site', report_sections: ['records', 'inventory'] },
    }));
  });

  it('forwards the scoped report contract to the notification endpoint', async () => {
    await sendDailyStandUpNotificationActivity({ site_id: 'site', subject: 'Standup', message: 'Selected report', report_sections: ['records', 'inventory'] });
    expect(mockPost).toHaveBeenCalledWith('/api/notifications/dailyStandUp', expect.objectContaining({
      site_id: 'site', report_sections: ['records', 'inventory'], message: 'Selected report',
    }));
  });

  it('does not introduce a selection into historical notification payloads', async () => {
    await sendDailyStandUpNotificationActivity({ site_id: 'site', subject: 'Standup', message: 'Legacy report' });
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('report_sections');
  });

  it('surfaces notification revalidation failures', async () => {
    mockPost.mockResolvedValue({ success: false, error: { message: 'Daily Standup preferences changed' } });
    await expect(sendDailyStandUpNotificationActivity({ site_id: 'site', subject: 'Standup', message: 'Selected report', report_sections: ['sales'] }))
      .rejects.toThrow('Daily Standup preferences changed');
  });
});