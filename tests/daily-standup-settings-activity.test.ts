const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
import { getDailyStandUpConfigurationActivity } from '../src/temporal/activities/dailyStandUpConfigurationActivity';

describe('persisted Daily Standup settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T16:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('loads the latest saved sections and days, scoped to the site', async () => {
    mockSingle.mockResolvedValue({ data: { activities: { daily_resume_and_stand_up: {
      status: 'active', weekdays: [2], report_sections: ['sales', 'reservations'],
    } } }, error: null });
    expect(await getDailyStandUpConfigurationActivity({ site_id: 'site' }))
      .toMatchObject({ shouldExecute: true, weekdays: [2], reportSections: ['sales', 'reservations'] });
    expect(mockFrom).toHaveBeenCalledWith('settings');
    expect(mockEq).toHaveBeenCalledWith('site_id', 'site');
    expect(mockSelect).toHaveBeenCalledWith('activities, business_hours');
  });

  it('blocks missing settings instead of activating a default report', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    expect(await getDailyStandUpConfigurationActivity({ site_id: 'site' })).toMatchObject({ shouldExecute: false });
  });

  it('throws on database failure rather than silently enabling all sections', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await expect(getDailyStandUpConfigurationActivity({ site_id: 'site' })).rejects.toThrow('Daily Standup settings unavailable');
  });
});