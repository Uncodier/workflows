import type { OutreachActivityKey } from './outreachActivity';
import { isBeforeActivityStartTime, isValidActivityStartTime, resolveActivityStartTime, type ActivityStartTimeMode } from './activityStartTime';
import { activityStartTimes, nextActivityRun, type ActivityStartTimes, type ActivityRun } from './activityScheduling';

export interface OutreachConfiguration {
  shouldExecute: boolean;
  reason: string;
  activityKey: OutreachActivityKey;
  segmentIds: string[];
  allSegments: boolean;
  dailyMessageLimit: number;
  maxUnansweredMessages: number;
  weekdays: number[];
  channelAccounts: Record<string, string[]>;
  availableChannels: string[];
  leadChannels?: string[];
  hasEmailChannel: boolean;
  hasWhatsappChannel: boolean;
  hasAnyChannel: boolean;
  timezone: string;
  startTimeMode?: ActivityStartTimeMode;
  startTimesByWeekday?: ActivityStartTimes;
  /** Custom time for either outreach activity; absent mode/time preserves legacy behavior. */
  startTime?: string;
}

export function outreachTimezone(settings: any): string {
  const hours = Array.isArray(settings?.business_hours) ? settings.business_hours[0] : settings?.business_hours;
  return hours?.timezone ?? 'America/Mexico_City';
}

export function localOutreachDay(now: Date, timezone: string): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const get = (key: string) => parts.find(part => part.type === key)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
}

/** Search UTC minutes instead of assuming a fixed offset (DST and half-hour zones). */
export function nextOutreachRun(now: Date, timezone: string, weekdays: number[], startTime = '09:00'): Date | null {
  if (!weekdays.length || !isValidActivityStartTime(startTime)) return null;
  return nextActivityRun(now, timezone, activityStartTimes({}, weekdays, { mode: 'custom', startTime }))?.targetTime ?? null;
}

/** Configuration activity results contain the persisted per-day openings, not stale analysis. */
export function nextConfiguredOutreachRun(now: Date, configuration: OutreachConfiguration): ActivityRun | null {
  if (!configuration.shouldExecute) return null;
  const times = configuration.startTimesByWeekday ?? activityStartTimes({}, configuration.weekdays, {
    mode: 'custom', startTime: configuration.startTime ?? '09:00',
  });
  return nextActivityRun(now, configuration.timezone, times);
}

const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))] : [];

export function isOutreachChannelKey(channel: string): boolean {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(channel) && channel !== 'audio' && channel !== 'prototype'
    && !Object.prototype.hasOwnProperty.call(Object.prototype, channel);
}

export function selectedAccountIds(settings: any, selected: string[], channel: string): string[] {
  const channels = settings?.channels || {};
  const connections: any[] = Array.isArray(channels.connections) ? channels.connections : [];
  return selected.filter(id => {
    if (!id || id.length > 200 || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id)) return false;
    if (['email', 'agent_email', 'whatsapp', 'agent_whatsapp'].includes(id)) {
      if (!['email', 'whatsapp'].includes(channel)) return false;
      if ((channel === 'email') !== ['email', 'agent_email'].includes(id)) return false;
      const account = channels[id];
      if (!account || account.enabled === false || !['active', 'synced', 'connected'].includes(account.status)) return false;
      if (id === 'email') return !!account.email;
      if (id === 'agent_email') {
        const username = account.username || account.data?.username;
        const domain = (account.domain === 'custom' ? account.customDomain : account.domain) || account.data?.domain;
        const address = username && domain ? `${username}@${domain}` : account.email || account.inbox_id || account.id || '';
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
      }
      return !!account.account_sid && !!(account.existingNumber || account.from_number || account.messaging_service_sid)
        && (id !== 'agent_whatsapp' || !!account.access_token);
    }
    const matches = connections.filter(account => account?.id === id);
    const account = matches.length === 1 ? matches[0] : undefined;
    return account?.type === channel && account.status === 'connected' && account.enabled !== false
      && !(channel === 'email' && account.metadata?.emailChannelActive === false)
      && typeof account.zavu_sender_id === 'string' && !!account.zavu_sender_id.trim();
  });
}

/** checkDay=false validates future scheduling without applying today's weekday/start-time guard. */
export function resolveOutreachConfiguration(settings: any, activityKey: OutreachActivityKey, now = new Date(), checkDay = true): OutreachConfiguration {
  const raw = settings?.activities?.[activityKey] || {};
  const timing = resolveActivityStartTime(raw);
  const isFollowUp = activityKey === 'leads_follow_up';
  const label = isFollowUp ? 'follow-up' : 'cold outreach';
  const invalidSelection = raw.channel_accounts != null && (typeof raw.channel_accounts !== 'object'
    || Array.isArray(raw.channel_accounts) || Object.keys(raw.channel_accounts).some(key => !isOutreachChannelKey(key)));
  const keys = [...new Set(['email', 'whatsapp', ...Object.keys(raw.channel_accounts || {})])].filter(isOutreachChannelKey);
  const channelAccounts = Object.fromEntries(keys.map(channel =>
    [channel, selectedAccountIds(settings, strings(raw.channel_accounts?.[channel]), channel)]));
  const availableChannels = keys.filter(channel => channelAccounts[channel].length > 0);
  const result: OutreachConfiguration = {
    shouldExecute: false, reason: '', activityKey,
    segmentIds: strings(raw.segment_ids), allSegments: raw.all_segments === true,
    dailyMessageLimit: raw.daily_message_limit ?? 30, maxUnansweredMessages: raw.max_unanswered_messages ?? 3,
    weekdays: raw.weekdays ?? [2, 3, 4], channelAccounts, availableChannels,
    hasEmailChannel: channelAccounts.email.length > 0, hasWhatsappChannel: channelAccounts.whatsapp.length > 0,
    hasAnyChannel: availableChannels.length > 0,
    timezone: outreachTimezone(settings),
    ...(timing.mode ? { startTimeMode: timing.mode } : {}),
    ...(timing.startTime ? { startTime: timing.startTime } : {}),
  };
  if (raw.status !== 'active') result.reason = 'Outreach is inactive; explicit activation is required';
  else if (invalidSelection) result.reason = 'Invalid outreach channel selection';
  else if (!Number.isInteger(result.dailyMessageLimit) || result.dailyMessageLimit < 1 || result.dailyMessageLimit > 10000) result.reason = 'Invalid daily message limit';
  else if (!Number.isInteger(result.maxUnansweredMessages) || result.maxUnansweredMessages < 1 || result.maxUnansweredMessages > 100) result.reason = 'Invalid unanswered message limit';
  else if (!result.hasAnyChannel) result.reason = 'Select at least one connected outreach account';
  else if (!result.allSegments && !result.segmentIds.length) result.reason = 'Select segments or explicitly enable all segments';
  else if (activityKey === 'leads_follow_up' && (!Array.isArray(result.weekdays) || !result.weekdays.length
    || result.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) result.reason = 'Select valid follow-up weekdays';
  else if (timing.error) result.reason = timing.error.replace('Invalid start time', `Invalid ${label} start time`);
  else {
    try {
      if (typeof result.timezone !== 'string' || !result.timezone.trim()) throw new Error('Invalid timezone');
      const day = localOutreachDay(now, result.timezone);
      if (timing.mode) result.startTimesByWeekday = activityStartTimes(settings,
        isFollowUp ? result.weekdays : [0, 1, 2, 3, 4, 5, 6], timing, { businessDaysOnly: !isFollowUp });
      const start = result.startTimesByWeekday?.[day.weekday];
      if (checkDay && activityKey === 'leads_follow_up' && !result.weekdays.includes(day.weekday)) result.reason = 'Not a selected follow-up weekday';
      else if (checkDay && timing.mode && !start) result.reason = `Business is closed on this ${label} weekday`;
      else if (checkDay && start && isBeforeActivityStartTime(now, result.timezone, start.scheduledTime)) {
        result.reason = `Before configured ${label} start time`;
      }
    } catch { result.reason = 'Invalid site timezone'; }
  }
  result.shouldExecute = !result.reason;
  if (result.shouldExecute) result.reason = 'Outreach configuration is active and eligible';
  return result;
}