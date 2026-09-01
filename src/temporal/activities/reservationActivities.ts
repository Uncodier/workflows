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

export async function getReservationMembersActivity(reservation: Reservation): Promise<ReservationMember[]> {
  const supabase = getSupabaseService().getClient();
  const members: ReservationMember[] = [];

  if (reservation.lead_id) {
    const { data: lead } = await supabase.from('leads').select('email, name, language').eq('id', reservation.lead_id).maybeSingle();
    if (lead?.email) {
      members.push({ 
        email: lead.email, 
        name: lead.name || 'Customer', 
        role: 'lead',
        lang: lead.language,
        tz: 'America/Mexico_City'
      });
    }
  }

  if (reservation.buyer_user_id) {
    const { data: profile } = await supabase.from('profiles').select('email, name').eq('id', reservation.buyer_user_id).maybeSingle();
    if (profile?.email) {
      members.push({ email: profile.email, name: profile.name || 'Buyer', role: 'buyer' });
    }
  }

  return members;
}

export interface FormatNotificationParams {
  reservation: Reservation;
  member: ReservationMember;
  timeWindowHours: number;
}

export async function translateAndFormatNotificationActivity(params: FormatNotificationParams): Promise<{ subject: string, message: string }> {
  const { reservation, member, timeWindowHours } = params;
  const supabase = getSupabaseService().getClient();
  
  let serviceName = '';
  let locationInfo = '';

  // Get service / item name
  if (reservation.catalog_item_id) {
    const { data: item } = await supabase.from('catalog_items').select('name').eq('id', reservation.catalog_item_id).maybeSingle();
    if (item?.name) {
      serviceName = item.name;
    }
  }

  // Get location details based on channel
  if (reservation.channel === 'digital') {
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
  
  const { data: reservation, error: fetchError } = await supabase
    .from('reservations')
    .select('metadata')
    .eq('id', params.reservation_id)
    .single();

  if (fetchError) {
    console.error(`❌ Failed to fetch reservation metadata for ${params.reservation_id}:`, fetchError);
    throw new Error(`Failed to fetch reservation metadata: ${fetchError.message}`);
  }

  const metadata = reservation?.metadata || {};
  const flagKey = `_reminder_${params.timeWindowHours}h_sent`;
  metadata[flagKey] = true;

  const { error: updateError } = await supabase
    .from('reservations')
    .update({ metadata })
    .eq('id', params.reservation_id);

  if (updateError) {
    console.error(`❌ Failed to update reservation metadata for ${params.reservation_id}:`, updateError);
    throw new Error(`Failed to update reservation metadata: ${updateError.message}`);
  }
  
  console.log(`✅ Marked ${params.timeWindowHours}h reminder as sent for reservation ${params.reservation_id}`);
}
