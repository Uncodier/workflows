import { SupabaseClient } from '@supabase/supabase-js';

export interface Reservation {
  id: string;
  site_id: string;
  lead_id?: string;
  buyer_user_id?: string;
  assignee_user_id?: string;
  catalog_item_id?: string;
  status: string;
  start_time: string;
  end_time: string;
  notes?: string;
  location_id?: string;
  channel?: string;
  metadata?: any;
}

export async function fetchUpcomingReservations(
  client: SupabaseClient,
  timeWindowHours: number = 24
): Promise<Reservation[]> {
  console.log(`🔍 Fetching reservations for window ~${timeWindowHours}h...`);
  
  const now = new Date();
  
  // Rango para la consulta: desde (now + timeWindow - buffer) hasta (now + timeWindow + buffer)
  // ej. si timeWindow es 24h, buscar reservaciones que empiecen en 23.5h a 24.5h desde ahora
  const targetTimeStart = new Date(now.getTime() + (timeWindowHours - 0.5) * 60 * 60 * 1000);
  const targetTimeEnd = new Date(now.getTime() + (timeWindowHours + 0.5) * 60 * 60 * 1000);

  const { data, error } = await client
    .from('reservations')
    .select('*')
    .in('status', ['confirmed', 'active', 'scheduled', 'pending']) // Adaptable
    .gte('start_time', targetTimeStart.toISOString())
    .lte('start_time', targetTimeEnd.toISOString());

  if (error) {
    console.error('❌ Error fetching upcoming reservations:', error);
    throw new Error(`Failed to fetch upcoming reservations: ${error.message}`);
  }

  // Filter out reservations that already had their reminder sent for this window
  const validReservations = (data || []).filter(res => {
    const flagKey = `_reminder_${timeWindowHours}h_sent`;
    return !(res.metadata && res.metadata[flagKey]);
  });

  console.log(`✅ Successfully fetched ${validReservations.length} upcoming reservations for ${timeWindowHours}h window (filtered from ${data?.length || 0})`);
  return validReservations;
}
