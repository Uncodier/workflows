/** Activity payloads are not database rows. Audit history (errors/last_error),
 * criteria and other unbounded JSON must stay in the database, not in Temporal.
 */
export interface IcpMiningWorkflowDto {
  id: string;
  site_id: string;
  role_query_id: string;
  name: string | null;
  status: string;
  total_targets: number | null;
  processed_targets: number | null;
  found_matches: number | null;
  current_page: number | null;
  current_page_offset: number | null;
  created_at: string;
}

export interface IcpPageSnapshot {
  page: number;
  candidates: any[];
  hasMore: boolean;
  total?: number;
}

export interface IcpMiningExecutionDto extends IcpMiningWorkflowDto {
  checkpoint_version: number;
  current_page_snapshot: IcpPageSnapshot | null;
}

export type IcpMiningClaimResult =
  | { acquired: true; reason?: string; icp: IcpMiningExecutionDto }
  | { acquired: false; reason?: string };

// Includes the cursor needed by older non-owned workflows, and created_at for
// globally ordering chunked selections. Neither listing nor by-ID consumers use
// snapshots: owned workflows get their authoritative state from the claim RPC.
// Keep a literal select string so the Supabase query parser can infer its result.
export const ICP_MINING_WORKFLOW_SELECT = 'id, site_id, role_query_id, name, status, total_targets, processed_targets, found_matches, current_page, current_page_offset, created_at';
const WORKFLOW_FIELDS = ICP_MINING_WORKFLOW_SELECT.split(', ');
const EXECUTION_FIELDS = [...WORKFLOW_FIELDS, 'checkpoint_version', 'current_page_snapshot'] as const;

function project<T>(row: Record<string, unknown>, fields: readonly string[]): T {
  const dto: Record<string, unknown> = {};
  for (const field of fields) {
    // Preserve null, zero and missing cursor values; never mutate the source row
    // or use a denylist that could expose future audit/JSON columns.
    if (Object.prototype.hasOwnProperty.call(row, field)) dto[field] = row[field];
  }
  return dto as T;
}

export function toIcpMiningWorkflowDto(row: Record<string, unknown>): IcpMiningWorkflowDto {
  return project<IcpMiningWorkflowDto>(row, WORKFLOW_FIELDS);
}

/** Apply even with the old RPC's to_jsonb(row) response, including same-run retries. */
export function toIcpMiningClaimResult(result: {
  acquired: boolean; reason?: string; icp?: Record<string, unknown> | null;
}): IcpMiningClaimResult {
  const reason = result.reason === undefined ? {} : { reason: result.reason };
  if (!result.acquired) return { acquired: false, ...reason };
  if (!result.icp || typeof result.icp !== 'object' || Array.isArray(result.icp)) {
    throw new Error('Mining claim returned no execution state');
  }
  return { acquired: true, ...reason, icp: project<IcpMiningExecutionDto>(result.icp, EXECUTION_FIELDS) };
}