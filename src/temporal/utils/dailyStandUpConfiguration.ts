import { localOutreachDay } from './outreachConfiguration';

export const DAILY_STAND_UP_REPORT_SECTIONS = [
  'sales', 'tasks', 'requirements', 'social', 'channels',
  'records', 'orders', 'reservations', 'inventory',
] as const;

export type DailyStandUpReportSection = typeof DAILY_STAND_UP_REPORT_SECTIONS[number];
export const DEFAULT_DAILY_STAND_UP_WEEKDAYS = [1, 5];

export interface DailyStandUpConfiguration {
  shouldExecute: boolean;
  reason: string;
  weekdays: number[];
  reportSections: DailyStandUpReportSection[];
  timezone: string;
}

/** Missing fields preserve legacy defaults; explicit empty/invalid selections never broaden them. */
export function resolveDailyStandUpConfiguration(
  settings: any,
  now = new Date(),
  checkDay = true,
): DailyStandUpConfiguration {
  const raw = settings?.activities?.daily_resume_and_stand_up;
  const status = typeof raw === 'string' ? raw : raw?.status;
  const weekdays = raw?.weekdays === undefined ? DEFAULT_DAILY_STAND_UP_WEEKDAYS : raw.weekdays;
  const sections = raw?.report_sections === undefined ? DAILY_STAND_UP_REPORT_SECTIONS : raw.report_sections;
  const hours = Array.isArray(settings?.business_hours) ? settings.business_hours[0] : settings?.business_hours;
  const timezone = hours?.timezone ?? 'America/Mexico_City';
  const validDays = Array.isArray(weekdays) && weekdays.length > 0
    && weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6);
  const validSections = Array.isArray(sections) && sections.length > 0
    && sections.every(section => DAILY_STAND_UP_REPORT_SECTIONS.includes(section));
  const result: DailyStandUpConfiguration = {
    shouldExecute: false,
    reason: '',
    weekdays: validDays ? [...new Set<number>(weekdays)].sort((a, b) => a - b) : [],
    reportSections: validSections ? DAILY_STAND_UP_REPORT_SECTIONS.filter(section => sections.includes(section)) : [],
    timezone,
  };

  if (status !== 'active') result.reason = 'Daily Standup is inactive; explicit activation is required';
  else if (!validDays) result.reason = 'Select at least one valid Daily Standup weekday';
  else if (!validSections) result.reason = 'Select at least one valid Daily Standup report section';
  else {
    try {
      if (typeof timezone !== 'string' || !timezone.trim()) throw new Error('Invalid timezone');
      const day = localOutreachDay(now, timezone);
      if (checkDay && !result.weekdays.includes(day.weekday)) result.reason = 'Not a selected Daily Standup weekday';
    } catch {
      result.reason = 'Invalid site timezone';
    }
  }
  result.shouldExecute = !result.reason;
  if (result.shouldExecute) result.reason = 'Daily Standup configuration is active and eligible';
  return result;
}