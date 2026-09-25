import { getSupabaseService } from '../services/supabaseService';
import { apiService } from '../services/apiService';
import { fetchUpcomingReservations, Reservation } from '../services/supabase-impl/reservations';

export interface FetchUpcomingReservationsParams {
  timeWindowHours: number;
}

export async function fetchUpcomingReservationsActivity(params: FetchUpcomingReservationsParams): Promise<Reservation[]> {
  const supabase = getSupabaseService().getClient();
  return fetchUpcomingReservations(supabase, params.timeWindowHours);
}

export interface ReservationMember {
  email: string;
  name: string;
  role: string;
  lang?: string;
  tz?: string;
}

export interface ReservationNotificationContext {
  members: ReservationMember[];
  serviceName: string;
  locationInfo: string;
}

export async function getReservationNotificationContextsActivity(
  reservations: Reservation[]
): Promise<Record<string, ReservationNotificationContext>> {
  const supabase = getSupabaseService().getClient();
  const leadIds = [...new Set(reservations.map((item) => item.lead_id).filter(Boolean))] as string[];
  const buyerIds = [...new Set(reservations.map((item) => item.buyer_user_id).filter(Boolean))] as string[];
  const itemIds = [...new Set(reservations.map((item) => item.catalog_item_id).filter(Boolean))] as string[];
  const locationIds = [...new Set(reservations.map((item) => item.location_id).filter(Boolean))] as string[];

  const [leadResult, profileResult, itemResult, locationResult] = await Promise.all([
    leadIds.length > 0
      ? supabase.from('leads').select('id, email, name, language').in('id', leadIds)
      : Promise.resolve({ data: [], error: null }),
    buyerIds.length > 0
      ? supabase.from('profiles').select('id, email, name').in('id', buyerIds)
      : Promise.resolve({ data: [], error: null }),
    itemIds.length > 0
      ? supabase.from('catalog_items').select('id, name').in('id', itemIds)
      : Promise.resolve({ data: [], error: null }),
    locationIds.length > 0
      ? supabase.from('locations').select('id, name, address').in('id', locationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const queryError = leadResult.error
    || profileResult.error
    || itemResult.error
    || locationResult.error;
  if (queryError) {
    throw new Error(`Failed to enrich reservation reminders: ${queryError.message}`);
  }

  const leads = new Map((leadResult.data || []).map((row) => [row.id, row]));
  const profiles = new Map((profileResult.data || []).map((row) => [row.id, row]));
  const items = new Map((itemResult.data || []).map((row) => [row.id, row]));
  const locations = new Map((locationResult.data || []).map((row) => [row.id, row]));
  const result: Record<string, ReservationNotificationContext> = {};

  for (const reservation of reservations) {
    const members: ReservationMember[] = [];
    const lead = reservation.lead_id ? leads.get(reservation.lead_id) : undefined;
    if (lead?.email) {
      members.push({
        email: lead.email,
        name: lead.name || 'Customer',
        role: 'lead',
        lang: lead.language,
        tz: 'America/Mexico_City',
      });
    }

    const buyer = reservation.buyer_user_id
      ? profiles.get(reservation.buyer_user_id)
      : undefined;
    if (buyer?.email) {
      members.push({
        email: buyer.email,
        name: buyer.name || 'Buyer',
        role: 'buyer',
      });
    }

    const item = reservation.catalog_item_id
      ? items.get(reservation.catalog_item_id)
      : undefined;
    const location = reservation.location_id
      ? locations.get(reservation.location_id)
      : undefined;
    result[reservation.id] = {
      members,
      serviceName: item?.name || '',
      locationInfo: reservation.channel === 'digital'
        ? 'Reunión en línea (Digital Meet Room)'
        : location
          ? `${location.name}${location.address ? ` - ${location.address}` : ''}`
          : '',
    };
  }

  return result;
}

export async function getReservationMembersActivity(reservation: Reservation): Promise<ReservationMember[]> {
  const contexts = await getReservationNotificationContextsActivity([reservation]);
  return contexts[reservation.id]?.members || [];
}

export interface FormatNotificationParams {
  reservation: Reservation;
  member: ReservationMember;
  timeWindowHours: number;
  serviceName?: string;
  locationInfo?: string;
}

export async function translateAndFormatNotificationActivity(params: FormatNotificationParams): Promise<{ subject: string, message: string }> {
  const { reservation, member, timeWindowHours } = params;
  const supabase = getSupabaseService().getClient();
  
  let serviceName = params.serviceName ?? '';
  let locationInfo = params.locationInfo ?? '';

  // Keep direct callers compatible while the cron path uses batched enrichment.
  if (params.serviceName === undefined && reservation.catalog_item_id) {
    const { data: item } = await supabase.from('catalog_items').select('name').eq('id', reservation.catalog_item_id).maybeSingle();
    if (item?.name) {
      serviceName = item.name;
    }
  }

  // Get location details based on channel
  if (params.locationInfo !== undefined) {
    locationInfo = params.locationInfo;
  } else if (reservation.channel === 'digital') {
    locationInfo = 'Reunión en línea (Digital Meet Room)';
    // If there is a meet url in notes or somewhere, it could be appended here, but for now we label it as digital
  } else if (reservation.location_id) {
    const { data: loc } = await supabase.from('locations').select('name, address').eq('id', reservation.location_id).maybeSingle();
    if (loc) {
      locationInfo = `${loc.name}${loc.address ? ` - ${loc.address}` : ''}`;
    }
  }

  const subject = timeWindowHours === 24 
    ? 'Recordatorio: Tu reservación es mañana' 
    : 'Recordatorio: Tu reservación es en 1 hora';

  const tz = member.tz || 'UTC';
  const lang = member.lang || 'es-MX';
  
  // Custom format avoiding seconds
  const dateOptions: Intl.DateTimeFormatOptions = { 
    timeZone: tz, 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  const timeOptions: Intl.DateTimeFormatOptions = { 
    timeZone: tz, 
    hour: '2-digit', 
    minute: '2-digit' 
  };
  
  const startDate = new Date(reservation.start_time);
  const endDate = new Date(reservation.end_time);
  
  const dateString = startDate.toLocaleDateString(lang, dateOptions);
  const startTimeString = startDate.toLocaleTimeString(lang, timeOptions);
  const endTimeString = endDate.toLocaleTimeString(lang, timeOptions);

  const displayNotes = reservation.notes || '';

  let detailsList = `- **Fecha:** ${dateString}\n- **Horario:** ${startTimeString} a ${endTimeString} (Zona Horaria: ${tz})`;
  if (serviceName) detailsList += `\n- **Servicio:** ${serviceName}`;
  if (locationInfo) detailsList += `\n- **Ubicación:** ${locationInfo}`;
  if (displayNotes) detailsList += `\n- **Notas:** ${displayNotes}`;

  const message = `
# Recordatorio de Reservación

Hola ${member.name},

Este es un recordatorio de que tienes una reservación programada próximamente.

**Detalles de la reserva:**
${detailsList}

Por favor, ponte en contacto si necesitas realizar algún cambio.

¡Gracias!
  `.trim();

  return { subject, message };
}

export interface SendReservationNotificationParams {
  email: string;
  subject: string;
  message: string;
  site_id: string;
  lang?: string;
}

export async function sendReservationNotificationActivity(params: SendReservationNotificationParams): Promise<void> {
  console.log(`📤 Sending reservation notification to team via API`);
  
  // API espera locale para internacionalización, si no se pasa usa 'en'
  const locale = (params.lang || 'es').startsWith('es') ? 'es' : 'en';

  const response = await apiService.post('/api/notifications/reservationReminder', {
    email: params.email,
    subject: params.subject,
    message: params.message,
    site_id: params.site_id,
    locale: locale
  });

  if (!response.success) {
    throw new Error(`Failed to send reservation notification: ${response.error?.message}`);
  }
}

export interface MarkReservationReminderSentParams {
  reservation_id: string;
  timeWindowHours: number;
}

export async function markReservationReminderSentActivity(params: MarkReservationReminderSentParams): Promise<void> {
  const supabase = getSupabaseService().getClient();

  const { error } = await supabase.rpc('mark_reservation_reminder_sent', {
    p_reservation_id: params.reservation_id,
    p_time_window_hours: params.timeWindowHours,
  });

  if (error) {
    console.error(`❌ Failed to update reservation metadata for ${params.reservation_id}:`, error);
    throw new Error(`Failed to update reservation metadata: ${error.message}`);
  }
  
  console.log(`✅ Marked ${params.timeWindowHours}h reminder as sent for reservation ${params.reservation_id}`);
}
