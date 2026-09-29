const invalidStatuses = new Set(['invalid', 'undeliverable', 'bounced', 'bounce', 'rejected', 'disabled', 'disposable']);
const validStatuses = new Set(['valid', 'validated', 'verified', 'deliverable']);
export const isEmailAddress = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const isPhoneNumber = (value: unknown): value is string => typeof value === 'string' && /^\+?[\d ()-]+$/.test(value)
  && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15;

export function usablePhoneNumbers(...lists: any[]): string[] {
  const rejected = new Set<string>();
  const values = new Map<string, string>();
  for (const list of lists) for (const item of Array.isArray(list) ? list : list ? [list] : []) {
    const phone = typeof item === 'string' ? item : item?.phone_number ?? item?.number;
    if (!isPhoneNumber(phone)) continue;
    const key = phone.replace(/\D/g, '');
    if ([item?.validation_status, item?.verification_status, item?.status].some(value => invalidStatuses.has(String(value).toLowerCase()))
      || item?.isValid === false) rejected.add(key);
    values.set(key, phone);
  }
  return [...values].filter(([key]) => !rejected.has(key)).map(([, value]) => value);
}

export function emailCandidates(...lists: any[]): Array<{ email: string; verified: boolean }> {
  const grouped = new Map<string, { email: string; verified: boolean; rejected: boolean }>();
  for (const list of lists) for (const item of Array.isArray(list) ? list : list ? [list] : []) {
    const email = typeof item === 'string' ? item : item?.email;
    if (!isEmailAddress(email)) continue;
    const key = email.toLowerCase();
    const record = grouped.get(key) || { email, verified: false, rejected: false };
    const statuses = [item?.validation_status, item?.verification_status, item?.status].filter(value => typeof value === 'string').map(value => value.toLowerCase());
    record.rejected ||= statuses.some(value => invalidStatuses.has(value)) || item?.deliverable === false || item?.isValid === false;
    record.verified ||= statuses.some(value => validStatuses.has(value)) || item?.verified === true || item?.validated === true;
    grouped.set(key, record);
  }
  return [...grouped.values()].filter(item => !item.rejected).map(({ email, verified }) => ({ email, verified }));
}

export function personContactDocuments(person: any): any[] {
  const raw = person.raw_result || {};
  const source = raw.finder_search_result || {};
  const details = raw.finder_details || {};
  return [person, raw, source.person, details.person || details, ...(Array.isArray(raw.roles) ? raw.roles : [])].filter(Boolean);
}