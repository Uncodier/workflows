/** Data reconciliation cannot improve with time. Do not classify provider
 * submission uncertainty or database/credit failures as organization reviews. */
export function isIcpOrganizationIdentityError(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[_-]+/g, ' ');
  return /\bambiguous\s*(?:org|organization|organisation)\b/.test(normalized)
    || /\b(?:organization|organisation|org)\b.*\bambiguous\b/.test(normalized)
    || /\bcannot resolve organization identity\b/.test(normalized);
}

export interface IcpOrganizationReview {
  id: string;
  site_id: string;
  organization: Record<string, any>;
  selected: boolean;
  status: 'pending';
  error: string;
}