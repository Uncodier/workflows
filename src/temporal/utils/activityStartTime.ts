/** Persisted activity times are strict local 24-hour HH:mm, never coerced or trimmed. */
export function isValidActivityStartTime(value: unknown): value is string {
  return typeof value === 'string' && value.length === 5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Call only after validating the supplied time; missing times retain legacy runtime behavior. */
export function isBeforeActivityStartTime(now: Date, timezone: string, startTime: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (key: string) => parts.find(part => part.type === key)!.value;
  return `${get('hour')}:${get('minute')}` < startTime;
}