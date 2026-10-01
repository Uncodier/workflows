import { resolveDailyStandUpConfiguration } from './dailyStandUpConfiguration';
import { activityStartTimes, nextActivityRun, type ActivityRun } from './activityScheduling';

export type DailyStandUpRun = ActivityRun;

/** Find the next selected opening or custom time, preserving unconfigured legacy schedules. */
export function nextDailyStandUpRun(settings: any, now = new Date()): DailyStandUpRun | null {
  const configuration = resolveDailyStandUpConfiguration(settings, now, false);
  if (!configuration.shouldExecute) return null;
  const times = activityStartTimes(settings, configuration.weekdays, {
    mode: configuration.startTimeMode, startTime: configuration.startTime,
  }, { legacyOpening: true });
  return nextActivityRun(now, configuration.timezone, times);
}