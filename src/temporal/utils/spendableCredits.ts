import { sumCreditBalances } from './creditBalanceSum';

/** Read-only admission projection; the database owns renewal and actual debits. */
export const SPENDABLE_CREDIT_FIELDS = 'credits_available,account_balance,trial_credits_available,trial_started_at,trial_ends_at,trial_converted_at,plan_credits_available,plan_credit_period_start,plan_credit_period_end,paid_subscription_period_end';

interface SpendableCreditBalance {
  credits_available?: unknown;
  account_balance?: unknown;
  trial_credits_available?: unknown;
  trial_started_at?: unknown;
  trial_ends_at?: unknown;
  trial_converted_at?: unknown;
  plan_credits_available?: unknown;
  plan_credit_period_start?: unknown;
  plan_credit_period_end?: unknown;
  paid_subscription_period_end?: unknown;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function currentPeriod(start: unknown, end: unknown, now: number): boolean | null {
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  const from = Date.parse(start);
  const until = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) return null;
  return from <= now && now < until;
}

/** Null is unavailable. Do not coerce strings, missing fields or nonfinite values. */
export function spendableCredits(billing: SpendableCreditBalance | null | undefined, now = Date.now()): number | null {
  if (!billing || !finiteNumber(now) || !finiteNumber(billing.credits_available) || billing.credits_available < 0) return null;
  const wallet = billing.account_balance === null ? 0 : billing.account_balance;
  if (!finiteNumber(wallet)) return null;
  let regular = billing.credits_available;
  let classified = 0;
  let expired = 0;
  for (const [amount, start, end, converted, paidEnd] of [
    [billing.trial_credits_available, billing.trial_started_at, billing.trial_ends_at, billing.trial_converted_at, null],
    [billing.plan_credits_available, billing.plan_credit_period_start, billing.plan_credit_period_end, null, billing.paid_subscription_period_end],
  ]) {
    // Older projections can omit bucket metadata; never invent a credit grant.
    if (amount === undefined) continue;
    if (!finiteNumber(amount) || amount < 0) return null;
    classified = sumCreditBalances(classified, amount);
    if (!Number.isFinite(classified) || classified > billing.credits_available) return null;
    if (amount === 0) continue;
    let active = currentPeriod(start, end, now);
    if (active === null) return null;
    if (paidEnd != null) {
      if (typeof paidEnd !== 'string' || !Number.isFinite(Date.parse(paidEnd))) return null;
      active = active && now < Date.parse(paidEnd);
    }
    if (converted != null && (typeof converted !== 'string' || !Number.isFinite(Date.parse(converted)))) return null;
    if (!active || converted != null) expired = sumCreditBalances(expired, amount);
  }
  regular = sumCreditBalances(regular, -expired);
  // A negative wallet offsets the total; negative regular credits are invalid.
  const total = sumCreditBalances(regular, wallet);
  return Number.isFinite(regular) && regular >= 0 && Number.isFinite(total) ? total : null;
}