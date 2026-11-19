// The membership RPC uses an internal role-query row, not provider search filters.
export function isSelectedListQuery(query: unknown): boolean {
  if (!query || typeof query !== 'object') return false;
  const fields = query as Record<string, unknown>;
  return fields.person_id === '__selected_people_only__' || fields.source === 'selected_people'
    || 'selected_request_id' in fields || 'selected_actor_id' in fields;
}

export const SELECTED_LIST_SEARCH_ERROR = 'Selected lists must be processed from saved membership.';