// Only these read/enrichment operations may retry a rejection from our admission
// middleware. Never replay arbitrary POSTs (messages, orders, workflow starts).
const ICP_ADMISSION_RETRY_PATHS = new Set([
  '/api/finder/person_role_search',
  '/api/finder/person_contacts_lookup/details',
  '/api/finder/person_contacts_lookup/work_emails',
  '/api/finder/person_contacts_lookup/personal_emails',
  '/api/finder/person_contacts_lookup/phone_numbers',
  '/api/agents/dataAnalyst/leadContactGeneration',
  '/api/integrations/icypeas/email-search/resolve',
]);

export function canRetryIcpAdmission(endpoint: string, method: string): boolean {
  return method === 'POST' && ICP_ADMISSION_RETRY_PATHS.has(endpoint);
}

/**
 * Recognize our pre-handler admission response, not a provider's HTTP 429.
 * Finder handlers currently deduct credits before contacting the provider, so
 * replaying an upstream rejection can charge twice. Unknown responses fail closed.
 */
export function admissionRetryAfterMs(
  status: number,
  errorText: string,
  retryAfter: string | null,
  now = Date.now(),
): number | undefined {
  if (status !== 429) return undefined;
  let body: any;
  try { body = JSON.parse(errorText); } catch { return undefined; }
  if (body?.success !== false || body?.error?.code !== 'RATE_LIMITED'
    || body.debug !== undefined || body.upstream !== undefined) return undefined;

  const delays: number[] = [];
  if (retryAfter?.trim()) {
    const value = retryAfter.trim();
    if (/^\d+(?:\.\d+)?$/.test(value)) delays.push(Number(value) * 1000);
    else if (!/^[+-]?\d/.test(value)) {
      const date = Date.parse(value);
      if (Number.isFinite(date)) delays.push(Math.max(0, date - now));
    }
  }
  const seconds = body.error.retry_after;
  if ((typeof seconds === 'number' || typeof seconds === 'string')
    && /^\d+(?:\.\d+)?$/.test(String(seconds))) delays.push(Number(seconds) * 1000);
  // Never retry earlier than either server hint. Bad/missing hints use one minute.
  const validDelays = delays.filter(Number.isFinite);
  return validDelays.length ? Math.max(1000, ...validDelays) : 60_000;
}