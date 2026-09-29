import { resolveDailyStandUpConfiguration } from './dailyStandUpConfiguration';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface DailyStandUpRun {
  targetTime: Date;
  localDate: string;
  timezone: string;
  scheduledTime: string;
  fallbackUsed: boolean;
}

/** Find the next selected local opening time, including explicitly selected closed days. */
export function nextDailyStandUpRun(settings: any, now = new Date()): DailyStandUpRun | null {
  const configuration = resolveDailyStandUpConfiguration(settings, now, false);
  if (!configuration.shouldExecute) return null;

  const hours = Array.isArray(settings?.business_hours) ? settings.business_hours[0] : settings?.business_hours;
  const openings = new Map(configuration.weekdays.map(weekday => {
    const day = hours?.days?.[WEEKDAYS[weekday]] ?? hours?.[WEEKDAYS[weekday]];
    const opening = day?.start ?? day?.open;
    const validOpening = day?.enabled !== false && typeof opening === 'string'
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(opening);
    const scheduledTime = validOpening ? opening : '09:00';
    const [hour, minute] = scheduledTime.split(':').map(Number);
    return [weekday, { scheduledTime, minuteOfDay: hour * 60 + minute, fallbackUsed: !validOpening }];
  }));

  // Search actual UTC instants: IANA rules handle DST, fractional offsets and local date rollover.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: configuration.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const local = (time: number) => {
    const parts = formatter.formatToParts(time);
    const get = (key: string) => parts.find(part => part.type === key)!.value;
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      weekday: WEEKDAYS.indexOf(get('weekday').toLowerCase()),
      minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
    };
  };
  const start = Math.ceil(now.getTime() / 60000) * 60000;
  let previous = local(start - 60000);
  for (let time = start; time <= start + 8 * 86400000; time += 60000) {
    const current = local(time);
    const opening = openings.get(current.weekday);
    // A missing spring-forward opening runs at the first valid minute after the gap.
    const crossesGap = opening && previous.date === current.date
      && previous.minuteOfDay < opening.minuteOfDay && current.minuteOfDay > opening.minuteOfDay;
    if (opening && (current.minuteOfDay === opening.minuteOfDay || crossesGap)) {
      return {
        targetTime: new Date(time), localDate: current.date, timezone: configuration.timezone,
        scheduledTime: opening.scheduledTime, fallbackUsed: opening.fallbackUsed,
      };
    }
    previous = current;
  }
  return null;
}