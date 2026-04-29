import { getSupabaseService } from '../services/supabaseService';

export async function fetchSitesDueForCreditRenewalActivity(): Promise<any[]> {
  console.log('🔍 Checking for sites due for credit renewal...');
  
  const supabaseService = getSupabaseService();
  const billings = await supabaseService.fetchActiveBillings();
  
  const today = new Date();
  const todayDay = today.getUTCDate();
  // Get the last day of the current UTC month
  const lastDayOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  
  const dueSites = [];

  for (const billing of billings) {
    // Si no tiene subscription_start_date, usamos created_at como fallback
    const dateToUse = billing.subscription_start_date || billing.created_at;
    
    if (!dateToUse) continue;
    
    const startDate = new Date(dateToUse);

    // Exclude records created today — they were just initialized and should not be renewed yet.
    const startedToday =
      startDate.getUTCFullYear() === today.getUTCFullYear() &&
      startDate.getUTCMonth() === today.getUTCMonth() &&
      startDate.getUTCDate() === today.getUTCDate();

    if (startedToday) continue;

    const startDay = startDate.getUTCDate();
    
    // Check if today is the renewal day:
    // 1. Exact match: today is the same day of month as start date.
    // 2. End-of-month catch-up: start day is 31st but current month ends on the 30th (or earlier).
    const isExactMatch = todayDay === startDay;
    const isEndOfMonthCatchup = todayDay === lastDayOfMonth && startDay > lastDayOfMonth;
    
    let isDue = isExactMatch || isEndOfMonthCatchup;

    // Check last payment to see if it missed a renewal or if it's already renewed
    const lastPayment = await supabaseService.fetchLastCreditRenewalPayment(billing.site_id, billing.stripe_subscription_id);
    
    if (lastPayment) {
      const lastPaymentDate = new Date(lastPayment.created_at);
      const daysSinceLastPayment = (today.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (isDue) {
        // If it's the exact day, but we already paid recently (e.g. within the last 20 days), skip it.
        if (daysSinceLastPayment < 20) {
          isDue = false;
        }
      } else {
        // If it's NOT the exact day, but it's been >= 31 days since the last renewal, it's overdue.
        if (daysSinceLastPayment >= 31) {
          isDue = true;
        }
      }
    } else {
      // No last payment found.
      // If it's been more than 31 days since start date, it's overdue.
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
  stripeSubscriptionId?: string
): Promise<{ success: boolean; newCredits: number; oldCredits: number }> {
  console.log(`🔄 Renewing credits for site ${siteId} (Plan: ${plan}, Current: ${currentCredits})`);
  
  const supabaseService = getSupabaseService();
  
  let newCredits = currentCredits;
  
  // Normalize plan name to lowercase for comparison
  const normalizedPlan = (plan || 'free').toLowerCase();
  
  if (normalizedPlan === 'startup') {
    // Startup: Add 100, accumulate
    newCredits = currentCredits + 100;
  } else if (normalizedPlan === 'enterprise') {
    // Enterprise: Add 1000, accumulate
    newCredits = currentCredits + 1000;
  } else if (normalizedPlan === 'free' || normalizedPlan === 'commission') {
    // Free/Commission: Cap at 20.
    // Logic: "Add 30" but "Cap at 20".
    // If we add 30 to any non-negative number, it's >= 30.
    // So min(20, current + 30) is always 20.
    // Effectively, this resets to 20.
    newCredits = 20;
  } else {
    // Default/Other Paid: Add 30, accumulate
    newCredits = currentCredits + 30;
  }
  
  try {
    await supabaseService.updateSiteCredits(siteId, newCredits);
    
    // Create a payment record for the renewal (empty invoice)
    const addedCredits = newCredits - currentCredits > 0 ? newCredits - currentCredits : 0;
    
    // Check if there's a recent stripe payment we should link to instead of creating a new one
    let shouldCreateNewPayment = true;
    if (stripeSubscriptionId) {
      const lastPayment = await supabaseService.fetchLastCreditRenewalPayment(siteId, stripeSubscriptionId);
      if (lastPayment) {
        const lastPaymentDate = new Date(lastPayment.created_at);
        const today = new Date();
        const daysSinceLastPayment = (today.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24);
        
        // If there's a stripe payment from the last 5 days, just update it with the credits
        // instead of creating a new empty invoice
        if (daysSinceLastPayment <= 5 && lastPayment.payment_method !== 'credit_renewal') {
          shouldCreateNewPayment = false;
          // We could update the existing payment here if needed, but since credits are tracked
          // in the billing table, just linking it conceptually is fine.
          console.log(`🔗 Linked credit renewal to recent Stripe payment ${lastPayment.id}`);
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
          note: 'Monthly credit renewal',
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
    // 1. Fetch existing billing record if any
    let existingBilling = null;
    existingBilling = await supabaseService.fetchBillingForSite(siteId);

    const plan = existingBilling?.plan || 'free';
    const normalizedPlan = plan.toLowerCase();

    // Calculate initial credits based on real plan
    let initialCredits = 30; // Default for free/unknown
    if (normalizedPlan === 'startup') initialCredits = 100;
    else if (normalizedPlan === 'enterprise') initialCredits = 1000;
    else if (normalizedPlan === 'commission') initialCredits = 20;

    if (!existingBilling) {
      // Create new billing record
      const billingRecord = await supabaseService.createBillingRecord({
        site_id: siteId,
        plan: 'free', // A truly new site starts free
        credits_available: initialCredits,
        status: 'active'
      });
      
      if (!billingRecord) {
        console.log(`⚠️ Billing record creation skipped for site ${siteId} (likely deleted).`);
        return;
      }
      
      console.log(`✅ Created billing record for site ${siteId} with ${initialCredits} credits.`);
    } else {
      // User already has a billing record (e.g., from Stripe payment) but missing initial credits.
      // This is the fallback emergency assignment.
      const currentCredits = existingBilling.credits_available || 0;
      const newCredits = currentCredits + initialCredits;
      
      await supabaseService.updateSiteCredits(siteId, newCredits);
      console.log(`✅ Added ${initialCredits} emergency initial credits to existing billing for site ${siteId}. Balance: ${currentCredits} -> ${newCredits}`);
    }

    // 2. Record Payment
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
