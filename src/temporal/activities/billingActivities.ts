import { getSupabaseService } from '../services/supabaseService';

export async function fetchSitesDueForCreditRenewalActivity(): Promise<any[]> {
  console.log('🔍 Checking for sites due for credit renewal...');
  
  const supabaseService = getSupabaseService();
  const billings = await supabaseService.fetchActiveBillings();
  
  const today = new Date();
  const todayDay = today.getUTCDate();
  // Get the last day of the current UTC month
  const lastDayOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  
  const dueSites = billings.filter(billing => {
    if (!billing.subscription_start_date) return false;
    
    const startDate = new Date(billing.subscription_start_date);
    const startDay = startDate.getUTCDate();
    
    // Check if today is the renewal day
    // 1. Exact match: today is the same day of month as start date
    // 2. End of month handling: if start day is 31st, and today is 30th (and it's the last day of month), renew.
    
    const isExactMatch = todayDay === startDay;
    const isEndOfMonthCatchup = todayDay === lastDayOfMonth && startDay > lastDayOfMonth;
    
    return isExactMatch || isEndOfMonthCatchup;
  });
  
  console.log(`✅ Found ${dueSites.length} sites due for credit renewal today`);
  return dueSites;
}

export async function renewSiteCreditsActivity(
  siteId: string, 
  plan: string, 
  currentCredits: number
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
    console.log(`✅ Credits updated for site ${siteId}: ${currentCredits} -> ${newCredits}`);
    return { success: true, newCredits, oldCredits: currentCredits };
  } catch (error) {
    console.error(`❌ Failed to update credits for site ${siteId}:`, error);
    throw error;
  }
}
