import { isRecord } from './finderData';

/** Membership IDs are provider strings, including UUID-shaped and zero-padded
 * IDs. Only canonical, in-range decimals belong in the legacy BIGINT column. */
export function selectedIdentityColumn(id: string): 'external_person_id' | 'finder_selected_person_id' {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id)) {
    throw new Error('Invalid selected Finder person ID');
  }
  return /^(0|[1-9]\d*)$/.test(id) && (id.length < 19 || (id.length === 19 && id <= '9223372036854775807'))
    ? 'external_person_id' : 'finder_selected_person_id';
}

/** A role wrapper's outer id is not a person identity. Never trust a number
 * whose exact digits may already have been lost in JSON decoding. */
export function matchesSelectedPerson(document: unknown, personId: string): boolean {
  if (!isRecord(document)) return false;
  const person = 'person' in document ? document.person : document;
  if (!isRecord(person)) return false;
  const id = person.id ?? person.external_person_id ?? person.person_id;
  return (typeof id === 'string' || Number.isSafeInteger(id)) && String(id) === personId;
}

/** Roles/organizations still use BIGINT columns. Never alias a noncanonical ID
 * to another role by coercing its digits (or send opaque text to a BIGINT filter). */
export function selectedRelatedId(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' && !Number.isSafeInteger(value)) throw new Error('Invalid selected Finder role or organization ID');
  const text = String(value);
  if (selectedIdentityColumn(text) !== 'external_person_id') throw new Error('Unsupported selected Finder role or organization ID');
  return text;
}

/** Evidence for a durable, unlinked selected-member review, never a matched lead. */
export interface SelectedIdentityReview {
  siteId: string;
  providerId: string;
  reason: 'conflicting_lead_identity';
}
