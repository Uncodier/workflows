/** Persisted activity times are strict local 24-hour HH:mm, never coerced or trimmed. */
export function isValidActivityStartTime(value: unknown): value is string {
  return typeof value === 'string' && value.length === 5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type ActivityStartTimeMode = 'business_opening' | 'custom';

export interface ActivityStartTime {
  mode?: ActivityStartTimeMode;
  startTime?: string;
  error?: string;
}

/** An explicit opening mode resets a saved override even when persistence merges old keys. */
export function resolveActivityStartTime(raw: any): ActivityStartTime {
  const mode = raw?.start_time_mode;
  if (mode !== undefined && mode !== 'business_opening' && mode !== 'custom') {
    return { error: 'Invalid start time mode' };
  }
  if (mode === 'business_opening') return { mode };
  if (mode === 'custom' || raw?.start_time !== undefined) {
    return isValidActivityStartTime(raw?.start_time)
      ? { mode: 'custom', startTime: raw.start_time }
      : { error: 'Invalid start time; expected HH:mm' };
  }
  // Historical settings retain their runtime behavior until a choice is saved.
  return {};
}

/** Call only after validating the supplied time; missing times retain legacy runtime behavior. */
export function isBeforeActivityStartTime(now: Date, timezone: string, startTime: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (key: string) => parts.find(part => part.type === key)!.value;
  return `${get('hour')}:${get('minute')}` < startTime;
}