import { type ActivityStartTime, isValidActivityStartTime } from './activityStartTime';

export const ACTIVITY_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export type ActivityStartTimes = Record<number, { scheduledTime: string; fallbackUsed: boolean }>;

export interface ActivityRun {
  targetTime: Date;
  localDate: string;
  timezone: string;
  scheduledTime: string;
  fallbackUsed: boolean;
}

/** Resolve each local day's opening, not a snapshot of the day the scheduler ran. */
export function activityStartTimes(
  settings: any,
  weekdays: number[],
  timing: ActivityStartTime,
  options: { legacyOpening?: boolean; businessDaysOnly?: boolean } = {},
): ActivityStartTimes {
  if (timing.error) return {};
  const hours = Array.isArray(settings?.business_hours) ? settings.business_hours[0] : settings?.business_hours;
  const times: ActivityStartTimes = {};
  for (const weekday of weekdays) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    const day = hours?.days?.[ACTIVITY_WEEKDAYS[weekday]] ?? hours?.[ACTIVITY_WEEKDAYS[weekday]];
    // Cold outreach keeps operating-day restrictions for either timing choice.
    if (options.businessDaysOnly && (day?.enabled === false || (!day && (weekday === 0 || weekday === 6)))) continue;
    if (timing.mode === 'business_opening' && day?.enabled === false) continue;
    const opening = day?.start ?? day?.open;
    const validOpening = day?.enabled !== false && isValidActivityStartTime(opening);
    const useOpening = timing.mode === 'business_opening' || (timing.mode === undefined && options.legacyOpening);
    times[weekday] = {
      scheduledTime: timing.startTime ?? (useOpening && validOpening ? opening : '09:00'),
      fallbackUsed: timing.startTime === undefined && !(useOpening && validOpening),
    };
  }
  return times;
}

/** Search actual UTC minutes so IANA rules handle DST, fractional offsets and date rollover. */
export function nextActivityRun(now: Date, timezone: string, times: ActivityStartTimes): ActivityRun | null {
  const entries = Object.entries(times);
  if (!entries.length || entries.some(([, value]) => !isValidActivityStartTime(value.scheduledTime))) return null;
  if (typeof timezone !== 'string' || !timezone.trim() || !Number.isFinite(now.getTime())) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch { return null; }
  const local = (time: number) => {
    const parts = formatter.formatToParts(time);
    const get = (key: string) => parts.find(part => part.type === key)!.value;
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      weekday: ACTIVITY_WEEKDAYS.indexOf(get('weekday').toLowerCase()),
      minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
    };
  };
  const start = Math.ceil(now.getTime() / 60000) * 60000;
  let previous = local(start - 60000);
  for (let time = start; time <= start + 8 * 86400000; time += 60000) {
    const current = local(time);
    const opening = times[current.weekday];
    if (opening) {
      const [hour, minute] = opening.scheduledTime.split(':').map(Number);
      const targetMinute = hour * 60 + minute;
      // Nonexistent spring-forward times use the first valid minute after the gap,
      // including zones whose forward jump crosses the local midnight boundary.
      const crossesGap = current.minuteOfDay > targetMinute
        && (previous.date === current.date ? previous.minuteOfDay < targetMinute : previous.date < current.date);
      if (current.minuteOfDay === targetMinute || crossesGap) {
        return { targetTime: new Date(time), localDate: current.date, timezone, ...opening };
      }
    }
    previous = current;
  }
  return null;
}