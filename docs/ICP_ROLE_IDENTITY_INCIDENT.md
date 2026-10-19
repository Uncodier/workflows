# ICP role identity repair — 2026-10-15 UTC

## Cause

Makinari list `989e9b63-5a85-4014-8b37-14da21759d77` stopped at page 7,
offset 0, 70 scanned candidates and 58 matches. Yamil Morales was stored under
two local person UUIDs for different roles. The existing lead was linked to the
older role, with a personal email and `email=''`. Local-person lookup missed it;
the work-email fallback and 23505 recovery excluded empty emails. Inserts hit
`leads_site_name_email_unique` and repeated failures imposed six-hour backoff.

Previous fixes `e77171c` and `05426aa` were deployed, not reverted. The latter's
regression assumed identical local person IDs and therefore missed the real case.

## Repair

- Resolve persisted stable provider person identity across role rows, with bounded
  canonical LinkedIn fallback, before ICP contact lookup and at lead persistence.
- Keep lead reads site-scoped; reject conflicting identity and multiple leads.
- Preserve original lead identity, company, contacts, commercial state and research.
- Recover concurrent empty-email unique conflicts through the same identity checks.
- Keep non-ICP lookup unchanged. Temporal patch `icp-role-identity-reuse-v1`
  protects the new ICP activity payload on historical replay.
- No database migration, lead deletion, cursor reset, quota override or provider
  resubmission was performed.

## Verification and deployment

- New isolated PostgreSQL suite: 26 cases, including the actual different-role
  UUID fixture, real unique constraints, cursor advancement, races and isolation.
- Full suite: 118 passed, 3 skipped; 1,915 tests passed, 25 skipped.
- Worker TypeScript check and Temporal replay tests passed.
- Read-only execution of the new resolver against production returned existing
  lead `7af35b3c-551d-46e6-a851-22511af91cf8` with its original role link.
- ACR run `cjq` built successfully using Node 20. Image:
  `uncodietmpacr.azurecr.io/temporal-worker:icp-role-identity-20261015030126`.
- Image digest:
  `sha256:3a06e56e33e022cc90c5ac016587847be480fff819ddb599eb684218fab9f681`.
- All six AKS worker deployments rolled out; nine replicas were ready. Source
  checksum in the deployed default worker matched the validated resolver.

## Pending operational validation

The last old-code turn at 02:45 UTC settled without progress. At 03:10 UTC the
list remained pending at 70/58 with zero outstanding reservations. Its stored
next eligibility is **2026-10-15 08:45:24 UTC**; eligibility does not guarantee
admission on that exact tick.

An atomic, guarded cooldown reset was attempted after confirming all mining
executions had ended and the new workers were ready. Supabase denied the write:
the available SQL connection is `supabase_read_only_user`. The transaction rolled
back; counters, eligibility and cron history were not modified. Do not bypass
that permission or launch an unreserved full-target mining workflow.

Confirm the next normal turn advances past page 7 offset 0, reuses the existing
lead, and does not repeat the unique error. An authorized operator can instead
review and clear only the stale site/list cooldown after rechecking ownership,
reservation state and exact error. Production cursor advancement has **not** been
observed in this session; do not mark that acceptance criterion complete yet.

The repair is present in the local working tree and deployed under the explicit
incident image tag. It has not been committed/pushed by this session; retain these
source changes in the next release so an older Git-based deploy does not remove it.