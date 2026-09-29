import { supabaseServiceRole } from '../../lib/supabase/client';
import { resolveDailyStandUpConfiguration, type DailyStandUpConfiguration } from '../utils/dailyStandUpConfiguration';

/** Re-read at execution and delivery so queued timers cannot bypass updated preferences. */
export async function getDailyStandUpConfigurationActivity(params: {
  site_id: string;
}): Promise<DailyStandUpConfiguration> {
  const { data, error } = await supabaseServiceRole.from('settings')
    .select('activities, business_hours').eq('site_id', params.site_id).maybeSingle();
  if (error) throw new Error(`Daily Standup settings unavailable: ${error.message}`);
  return resolveDailyStandUpConfiguration(data);
}