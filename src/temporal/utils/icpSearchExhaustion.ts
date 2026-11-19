/** Membership ACKs count toward the ledger, not toward the size of a role search.
 * A zero total is the legacy 'unknown until fetched' sentinel. */
export function accountedSearchTargets(total: number | null | undefined, processed: number, selected: number): boolean {
  return total != null && total > 0 && processed - selected >= total;
}