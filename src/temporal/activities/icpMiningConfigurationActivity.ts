import { supabaseServiceRole } from '../../lib/supabase/client';
import { resolveIcpMiningConfiguration } from '../utils/icpMiningConfiguration';

export async function getIcpMiningConfigurationActivity(params: {
  site_id: string;
  targetLeadsWithEmail?: number;
  researchEnabled?: boolean;
}) {
  const { data, error } = await supabaseServiceRole.from('settings')
    .select('activities').eq('site_id', params.site_id).maybeSingle();
  if (error) throw new Error(`ICP settings unavailable: ${error.message}`);
  return resolveIcpMiningConfiguration(data, params);
}