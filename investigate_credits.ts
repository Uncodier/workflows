import { config } from 'dotenv';
import { getSupabaseService } from './src/temporal/services/supabaseService';
import { countMissedRenewalCycles } from './src/temporal/activities/billingActivities';

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
  const supabase = getSupabaseService();
  const billings = await supabase.fetchActiveBillings();
  const sites = await supabase.fetchSites();
  const siteNames = new Map(sites.map((s: any) => [s.id, s.name]));

  let zeroCreditsCount = 0;
  let missedRenewalsCount = 0;
  let emptyAndMissed = 0;
  let emptyButRenewedRecently = 0;

  console.log(`Total active billings: ${billings.length}`);

  for (const billing of billings) {
    const cycleStart = billing.subscription_start_date || billing.created_at;
    const lastRenewal = await supabase.fetchLastCreditRenewalPayment(billing.site_id);
    const lastRenewalDate = lastRenewal ? new Date(lastRenewal.created_at) : null;
    
    let missedCycles = 0;
    if (cycleStart) {
       missedCycles = countMissedRenewalCycles(new Date(cycleStart), lastRenewalDate);
    }

    const credits = billing.credits_available ?? 0;
    const isZero = credits < 1; // Less than 1 credit

    if (isZero) zeroCreditsCount++;
    if (missedCycles > 0) missedRenewalsCount++;

    if (isZero && missedCycles > 0) {
      emptyAndMissed++;
    }

    if (isZero && missedCycles === 0) {
      emptyButRenewedRecently++;
      console.log(`Site ${siteNames.get(billing.site_id) || billing.site_id} is out of credits but hasn't missed renewals. (Plan: ${billing.plan}, Last renewal: ${lastRenewalDate})`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Sites with < 1 credit: ${zeroCreditsCount}`);
  console.log(`Sites that missed renewals: ${missedRenewalsCount}`);
  console.log(`Sites with < 1 credit AND missed renewals: ${emptyAndMissed}`);
  console.log(`Sites with < 1 credit BUT up to date on renewals (consumed them): ${emptyButRenewedRecently}`);
}

main().catch(console.error);
