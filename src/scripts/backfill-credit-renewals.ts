#!/usr/bin/env npx tsx
/**
 * Backfill missed monthly credit renewals for active billing accounts.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-credit-renewals.ts --dry-run
 *   npx tsx src/scripts/backfill-credit-renewals.ts --site-id <uuid>
 *   npx tsx src/scripts/backfill-credit-renewals.ts
 */

import { config } from 'dotenv';
import { getSupabaseService } from '../temporal/services/supabaseService';
import {
  countMissedRenewalCycles,
  renewSiteCreditsActivity,
  MAX_BACKFILL_CYCLES
} from '../temporal/activities/billingActivities';

config({ path: '.env.local' });

function ensureSupabaseUrl(): void {
  if (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!key) return;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()) as {
      ref?: string;
    };
    if (payload.ref) {
      process.env.SUPABASE_URL = `https://${payload.ref}.supabase.co`;
    }
  } catch {
    // ignore
  }
}

ensureSupabaseUrl();

interface BackfillTarget {
  siteId: string;
  siteName: string;
  plan: string;
  creditsAvailable: number;
  missedCycles: number;
  stripeSubscriptionId?: string;
}

function parseArgs(): { dryRun: boolean; siteId?: string } {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    siteId: args.includes('--site-id')
      ? args[args.indexOf('--site-id') + 1]
      : undefined
  };
}

async function findBackfillTargets(siteIdFilter?: string): Promise<BackfillTarget[]> {
  const supabase = getSupabaseService();
  const billings = await supabase.fetchActiveBillings();
  const sites = await supabase.fetchSites();
  const siteNames = new Map(sites.map((s: { id: string; name?: string }) => [s.id, s.name]));
  const targets: BackfillTarget[] = [];

  for (const billing of billings) {
    if (siteIdFilter && billing.site_id !== siteIdFilter) continue;

    const cycleStart = billing.subscription_start_date || billing.created_at;
    if (!cycleStart) continue;

    const lastRenewal = await supabase.fetchLastCreditRenewalPayment(billing.site_id);
    const lastRenewalDate = lastRenewal ? new Date(lastRenewal.created_at) : null;
    const missedCycles = countMissedRenewalCycles(
      new Date(cycleStart),
      lastRenewalDate
    );

    if (missedCycles === 0) continue;

    targets.push({
      siteId: billing.site_id,
      siteName: siteNames.get(billing.site_id) ?? billing.site_id,
      plan: billing.plan ?? 'free',
      creditsAvailable: billing.credits_available ?? 0,
      missedCycles,
      stripeSubscriptionId: billing.stripe_subscription_id ?? undefined
    });
  }

  return targets.sort((a, b) => b.missedCycles - a.missedCycles);
}

async function main() {
  const { dryRun, siteId } = parseArgs();

  console.log('🔄 Credit renewal backfill');
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (siteId) console.log(`   Site filter: ${siteId}`);
  console.log(`   Max cycles per site: ${MAX_BACKFILL_CYCLES}`);
  console.log('');

  const targets = await findBackfillTargets(siteId);

  if (targets.length === 0) {
    console.log('✅ No sites need backfill.');
    return;
  }

  console.log(`Found ${targets.length} site(s) with missed renewals:\n`);
  for (const t of targets) {
    console.log(
      `  - ${t.siteName} (${t.siteId}) | plan=${t.plan} | credits=${t.creditsAvailable} | missed=${t.missedCycles}`
    );
  }
  console.log('');

  if (dryRun) {
    console.log('Dry run complete. Re-run without --dry-run to apply.');
    return;
  }

  let renewed = 0;
  let errors = 0;

  for (const target of targets) {
    console.log(`\n📦 ${target.siteName} — applying ${target.missedCycles} renewal(s)...`);

    let currentCredits = target.creditsAvailable;

    for (let cycle = 0; cycle < target.missedCycles; cycle++) {
      try {
        const result = await renewSiteCreditsActivity(
          target.siteId,
          target.plan,
          currentCredits,
          target.stripeSubscriptionId,
          { note: `Backfill credit renewal (${cycle + 1}/${target.missedCycles})` }
        );
        currentCredits = result.newCredits;
        renewed++;
        console.log(
          `   ✅ Cycle ${cycle + 1}: ${result.oldCredits} -> ${result.newCredits}`
        );
      } catch (err) {
        errors++;
        console.error(`   ❌ Cycle ${cycle + 1} failed:`, err);
        break;
      }
    }
  }

  console.log('\n========================================');
  console.log(`✅ Renewals applied: ${renewed}`);
  console.log(`❌ Errors: ${errors}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
