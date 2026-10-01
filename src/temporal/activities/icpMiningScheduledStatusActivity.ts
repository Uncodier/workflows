import { getSupabaseService } from '../services/supabaseService';
import type { IcpMiningScheduledStatusUpdate } from '../services/supabase-impl/icpMiningScheduledStatus';

export type { IcpMiningScheduledStatusUpdate } from '../services/supabase-impl/icpMiningScheduledStatus';

/** Called only for the nearest newly started ICP timer, not the coverage slot. */
export async function saveIcpMiningScheduledStatusActivity(
  update: IcpMiningScheduledStatusUpdate,
): Promise<void> {
  await getSupabaseService().saveIcpMiningScheduledStatus(update);
}