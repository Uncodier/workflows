import { getSupabaseService } from '../services/supabaseService';

const MAX_BACKFILL_CYCLES = 12;

/** Count billing-cycle renewal dates that have passed but were never credited. */
export function countMissedRenewalCycles(
  cycleStartDate: Date,
  lastRenewalDate: Date | null,
  today: Date = new Date()
): number {
  const startDay = cycleStartDate.getUTCDate();
  const reference = lastRenewalDate ?? cycleStartDate;

  let year = reference.getUTCFullYear();
  let month = reference.getUTCMonth() + 1;
  if (month > 11) {
    month = 0;
    year += 1;
  }

  let count = 0;

  while (count < MAX_BACKFILL_CYCLES) {
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const renewalDay = Math.min(startDay, lastDayOfMonth);
    const renewalDate = new Date(Date.UTC(year, month, renewalDay));

    if (renewalDate > today) break;
    if (!lastRenewalDate || renewalDate > lastRenewalDate) {
      count++;
    }

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return count;
}

export async function fetchSitesDueForCreditRenewalActivity(): Promise<any[]> {
  console.log('🔍 Checking for sites due for credit renewal...');

  const supabaseService = getSupabaseService();
  const billings = await supabaseService.fetchActiveBillings();

  const today = new Date();
  const todayDay = today.getUTCDate();
  const lastDayOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
  ).getUTCDate();

  const dueSites = [];

  for (const billing of billings) {
    const dateToUse = billing.subscription_start_date || billing.created_at;

    if (!dateToUse) continue;

    const startDate = new Date(dateToUse);

    const startedToday =
      startDate.getUTCFullYear() === today.getUTCFullYear() &&
      startDate.getUTCMonth() === today.getUTCMonth() &&
      startDate.getUTCDate() === today.getUTCDate();

    if (startedToday) continue;

    const startDay = startDate.getUTCDate();

    const isExactMatch = todayDay === startDay;
    const isEndOfMonthCatchup = todayDay === lastDayOfMonth && startDay > lastDayOfMonth;

    let isDue = isExactMatch || isEndOfMonthCatchup;

    const lastRenewal = await supabaseService.fetchLastCreditRenewalPayment(billing.site_id);

    if (lastRenewal) {
      const lastRenewalDate = new Date(lastRenewal.created_at);
      const daysSinceLastRenewal =
        (today.getTime() - lastRenewalDate.getTime()) / (1000 * 60 * 60 * 24);

      if (isDue) {
        if (daysSinceLastRenewal < 20) {
          isDue = false;
        }
      } else if (daysSinceLastRenewal >= 31) {
        isDue = true;
      }
    } else {
      const daysSinceStart = (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceStart >= 31 && !isDue) {
        isDue = true;
      }
    }

    if (isDue) {
      dueSites.push(billing);
    }
  }

  console.log(`✅ Found ${dueSites.length} sites due for credit renewal today`);
  return dueSites;
}

export async function renewSiteCreditsActivity(
  siteId: string,
  plan: string,
  currentCredits: number,
  stripeSubscriptionId?: string,
  options?: { note?: string }
): Promise<{ success: boolean; newCredits: number; oldCredits: number }> {
  console.log(`🔄 Renewing credits for site ${siteId} (Plan: ${plan}, Current: ${currentCredits})`);

  const supabaseService = getSupabaseService();

  let newCredits = currentCredits;

  const normalizedPlan = (plan || 'free').toLowerCase();

  if (normalizedPlan === 'startup') {
    newCredits = currentCredits + 100;
  } else if (normalizedPlan === 'enterprise') {
    newCredits = currentCredits + 1000;
  } else if (normalizedPlan === 'free' || normalizedPlan === 'commission') {
    newCredits = 20;
  } else {
    newCredits = currentCredits + 30;
  }

  try {
    await supabaseService.updateSiteCredits(siteId, newCredits);

    const addedCredits = Math.round(newCredits - currentCredits > 0 ? newCredits - currentCredits : 0);

    let shouldCreateNewPayment = true;
    if (stripeSubscriptionId) {
      const lastStripePayment = await supabaseService.fetchLastStripeSubscriptionPayment(
        siteId,
        stripeSubscriptionId
      );
      if (lastStripePayment) {
        const lastPaymentDate = new Date(lastStripePayment.created_at);
        const today = new Date();
        const daysSinceLastPayment =
          (today.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceLastPayment <= 5) {
          shouldCreateNewPayment = false;
          console.log(`🔗 Linked credit renewal to recent Stripe payment ${lastStripePayment.id}`);
        }
      }
    }

    if (shouldCreateNewPayment) {
      await supabaseService.createPaymentRecord({
        site_id: siteId,
        amount: 0,
        credits: addedCredits,
        payment_method: 'credit_renewal',
        status: 'completed',
        transaction_type: 'credit',
        details: {
          note: options?.note ?? 'Monthly credit renewal',
          plan: normalizedPlan,
          stripe_subscription_id: stripeSubscriptionId || null
        }
      });
    }

    console.log(`✅ Credits updated for site ${siteId}: ${currentCredits} -> ${newCredits}`);
    return { success: true, newCredits, oldCredits: currentCredits };
  } catch (error) {
    console.error(`❌ Failed to update credits for site ${siteId}:`, error);
    throw error;
  }
}

export async function fetchSitesNeedingInitializationActivity(): Promise<string[]> {
  console.log('🔍 Checking for sites needing billing initialization...');
  const supabaseService = getSupabaseService();
  return await supabaseService.fetchSitesWithoutBilling();
}

export async function initializeSiteCreditsActivity(siteId: string): Promise<void> {
  console.log(`✨ Initializing credits for site ${siteId}...`);
  const supabaseService = getSupabaseService();

  try {
    let existingBilling = null;
    existingBilling = await supabaseService.fetchBillingForSite(siteId);

    const plan = existingBilling?.plan || 'free';
    const normalizedPlan = plan.toLowerCase();

    let initialCredits = 30;
    if (normalizedPlan === 'startup') initialCredits = 100;
    else if (normalizedPlan === 'enterprise') initialCredits = 1000;
    else if (normalizedPlan === 'commission') initialCredits = 20;

    if (!existingBilling) {
      const billingRecord = await supabaseService.createBillingRecord({
        site_id: siteId,
        plan: 'free',
        credits_available: initialCredits,
        status: 'active'
      });

      if (!billingRecord) {
        console.log(`⚠️ Billing record creation skipped for site ${siteId} (likely deleted).`);
        return;
      }

      console.log(`✅ Created billing record for site ${siteId} with ${initialCredits} credits.`);
    } else {
      const currentCredits = existingBilling.credits_available || 0;
      const newCredits = currentCredits + initialCredits;

      await supabaseService.updateSiteCredits(siteId, newCredits);
      console.log(
        `✅ Added ${initialCredits} emergency initial credits to existing billing for site ${siteId}. Balance: ${currentCredits} -> ${newCredits}`
      );
    }

    const paymentRecord = await supabaseService.createPaymentRecord({
      site_id: siteId,
      amount: 0,
      credits: initialCredits,
      payment_method: 'initial_credit',
      status: 'completed',
      transaction_type: 'credit',
      details: { note: 'Initial signup credits (fallback or new)' }
    });

    if (!paymentRecord) {
      console.log(`⚠️ Payment record creation skipped for site ${siteId} (likely deleted).`);
      return;
    }

    console.log(`✅ Site ${siteId} initialized with ${initialCredits} credits.`);
  } catch (error) {
    console.error(`❌ Failed to initialize credits for site ${siteId}:`, error);
    throw error;
  }
}

export { MAX_BACKFILL_CYCLES };
