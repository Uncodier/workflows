/**
 * Role selection utilities for person/organization enrichment.
 * When a person has multiple roles (e.g. Y Combinator Alumni + Nowports President),
 * we need to pick the correct one for domain lookup, IcyPeas, and API params.
 */

export interface RoleForSelection {
  id?: number | string;
  is_current?: boolean;
  start_date?: string;
  organization?: { id?: number | string; name?: string; domain?: string; website?: string };
  organization_name?: string;
  [key: string]: unknown;
}

/**
 * Selects the role for company/organization enrichment.
 * Priority:
 * 1. company_name: if provided, find role whose organization matches (case-insensitive)
 * 2. external_role_id: if provided, find role by id
 * 3. fallback: most recent start_date among is_current roles, or first role
 */
export function selectRoleForEnrichment(
  roles: RoleForSelection[],
  options?: {
    company_name?: string | null;
    external_role_id?: number | string | null;
  }
): RoleForSelection | undefined {
  if (!roles?.length) return undefined;

  const companyName = options?.company_name?.trim();
  const externalRoleId = options?.external_role_id;

  // 1. Match by company_name (from caller context - e.g. lead generation with specific company)
  if (companyName) {
    const normalized = companyName.toLowerCase();
    const match = roles.find((r) => {
      const orgName = (r.organization?.name ?? r.organization_name ?? '').trim().toLowerCase();
      return orgName === normalized || orgName.includes(normalized) || normalized.includes(orgName);
    });
    if (match) return match;
  }

  // 2. Match by external_role_id
  if (externalRoleId != null && externalRoleId !== '') {
    const idStr = String(externalRoleId);
    const match = roles.find((r) => r.id != null && String(r.id) === idStr);
    if (match) return match;
  }

  // 3. Fallback: most recent start_date among is_current, or first role
  const currentRoles = roles.filter((r) => r.is_current === true);
  const candidates = currentRoles.length > 0 ? currentRoles : roles;
  if (candidates.length === 0) return undefined;

  return candidates.reduce<RoleForSelection>((best, r) => {
    const bestDate = best?.start_date ? new Date(best.start_date).getTime() : 0;
    const rDate = r?.start_date ? new Date(r.start_date).getTime() : 0;
    return rDate >= bestDate ? r : best;
  }, candidates[0]);
}
