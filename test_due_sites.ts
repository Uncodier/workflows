import { config } from 'dotenv';
import { fetchSitesDueForCreditRenewalActivity } from './src/temporal/activities/billingActivities';

config({ path: '.env.local' });

function ensureSupabaseUrl(): void {
  if (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!key) return;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()) as { ref?: string };
    if (payload.ref) {
      process.env.SUPABASE_URL = `https://${payload.ref}.supabase.co`;
    }
  } catch {}
}

ensureSupabaseUrl();

async function main() {
  console.log('Testing fetchSitesDueForCreditRenewalActivity()...');
  try {
    const dueSites = await fetchSitesDueForCreditRenewalActivity();
    console.log(`\nFound ${dueSites.length} sites due for credit renewal TODAY.`);
    
    for (const site of dueSites) {
      console.log(`- Site ${site.site_id} (Plan: ${site.plan}, Started: ${site.subscription_start_date || site.created_at})`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main().catch(console.error);