#!/usr/bin/env npx tsx
/**
 * Reconcile ONLY the current UTC-calendar plan-credit period per site.
 * Defaults to dry-run. No historical allowance accumulation.
 * Usage: npx tsx src/scripts/backfill-credit-renewals.ts [--site-id <uuid>] [--apply]
 * See docs/BILLING_CREDIT_ALLOWANCES.md. Never execute against production as a test.
 */
import { config } from 'dotenv';
import {
  fetchSitesDueForCreditRenewalActivity,
  renewSiteCreditsActivity,
} from '../temporal/activities/billingActivities';
import type { PlanCreditRenewalResult } from '../temporal/services/supabase-impl/billing';

export async function reconcileCurrentCreditPeriods(
  siteIds: readonly string[],
  renew: (siteId: string) => Promise<PlanCreditRenewalResult> = renewSiteCreditsActivity
): Promise<{ reset: number; skipped: number; errors: number }> {
  const counts = { reset: 0, skipped: 0, errors: 0 };
  for (const siteId of new Set(siteIds.filter(Boolean))) {
    try {
      const result = await renew(siteId);
      if (result.outcome === 'reset') counts.reset++;
      else counts.skipped++;
      console.log(`${siteId}: ${result.outcome} (available=${result.credits_available})`);
    } catch (error) {
      counts.errors++;
      console.error(`Current-period reconciliation failed for ${siteId}:`, error);
    }
  }
  return counts;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowed = new Set(['--apply', '--dry-run', '--site-id']);
  let siteId: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) throw new Error(`Unknown argument: ${args[index]}`);
    if (args[index] === '--site-id') {
      siteId = args[++index];
      if (!siteId || siteId.startsWith('--')) throw new Error('--site-id requires a value');
    }
  }
  const apply = args.includes('--apply') && !args.includes('--dry-run');
  config({ path: '.env.local' });
  const billings = await fetchSitesDueForCreditRenewalActivity();
  const siteIds = billings.map((row) => row.site_id as string)
    .filter((id) => !siteId || id === siteId);
  console.log(`Current-period reconciliation: ${apply ? 'APPLY' : 'DRY RUN'}; ${siteIds.length} candidates`);
  if (!apply) {
    console.log('Candidate eligibility is DB-owned. No writes performed. Explicit --apply is required.');
    return;
  }
  const counts = await reconcileCurrentCreditPeriods(siteIds);
  console.log(counts);
  if (counts.errors > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Credit reconciliation failed:', error);
    process.exitCode = 1;
  });
}