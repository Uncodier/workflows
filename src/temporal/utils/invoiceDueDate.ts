const DAY_MS = 86400000;

/** Calendar dates carry no timezone; reject rollover dates rather than normalizing them. */
export function invoiceDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid invoice due date');
  }
  return value;
}

/** Preserve the configured net-terms offset from one billing cycle to the next. */
export function advanceSubscriptionDueDate(dueDate: string, currentBilling: string, nextBilling: string): string {
  const due = Date.parse(`${invoiceDate(dueDate)}T00:00:00Z`);
  const current = new Date(currentBilling);
  const next = new Date(nextBilling);
  if (!Number.isFinite(current.getTime()) || !Number.isFinite(next.getTime())) {
    throw new Error('Invalid subscription billing date');
  }
  const day = (date: Date) => Date.parse(`${date.toISOString().slice(0, 10)}T00:00:00Z`);
  return invoiceDate(new Date(due + Math.round((day(next) - day(current)) / DAY_MS) * DAY_MS).toISOString().slice(0, 10));
}