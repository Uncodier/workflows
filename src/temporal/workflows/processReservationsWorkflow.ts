import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const {
  fetchUpcomingReservationsActivity,
  getReservationMembersActivity,
  translateAndFormatNotificationActivity,
  sendReservationNotificationActivity,
  markReservationReminderSentActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5m',
  retry: {
    initialInterval: '1m',
    maximumAttempts: 3
  }
});

export async function processReservationsWorkflow(): Promise<{ processed: number; errors: number }> {
  console.log('🔄 Starting processReservationsWorkflow (Cron)...');

  let totalProcessed = 0;
  let totalErrors = 0;

  for (const timeWindowHours of [24, 1]) {
    try {
      const reservations = await fetchUpcomingReservationsActivity({ timeWindowHours });
      
      for (const reservation of reservations) {
        try {
          const members = await getReservationMembersActivity(reservation);
          
          for (const member of members) {
            const { subject, message } = await translateAndFormatNotificationActivity({
              reservation,
              member,
              timeWindowHours
            });
            
            await sendReservationNotificationActivity({
              email: member.email,
              subject,
              message,
              site_id: reservation.site_id,
              lang: member.lang
            });
          }

          // Mark reminder as sent to avoid duplicates
          await markReservationReminderSentActivity({
            reservation_id: reservation.id,
            timeWindowHours
          });

          totalProcessed++;
        } catch (err) {
          console.error(`❌ Error processing reservation ${reservation.id}:`, err);
          totalErrors++;
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching reservations for ${timeWindowHours}h window:`, err);
      totalErrors++;
    }
  }

  console.log(`✅ ProcessReservationsWorkflow completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`);

  return { processed: totalProcessed, errors: totalErrors };
}
