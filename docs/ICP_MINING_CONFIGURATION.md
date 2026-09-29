# ICP mining configuration

## Site settings

AI Activities stores the following object in `settings.activities`:

```json
{
  "icp_lead_generation": {
    "status": "active",
    "target_leads": 150,
    "research_enabled": false,
    "all_lists": true,
    "list_ids": []
  }
}
```

- ICP mining is always enabled. Historical `inactive`, `default`, or missing status
  no longer blocks new executions. Outreach and channel-health checks still apply
  to messaging workflows, not to mining.
- `target_leads` is an integer from 1 to 3000: the target number of successfully
  enriched/saved lead matches per execution, **not** scanned candidates, and not a
  guarantee that enough matching contacts are available. An existing lead can be
  enriched instead of creating a duplicate.
- `research_enabled` requests additional lead deep research after enrichment. It
  defaults to false and does not enable outreach or send messages.
- `all_lists` defaults to true, making all current and future pending/resumable
  mining lists eligible. To restrict mining, set it to false and use `list_ids`:
  up to 1,000 UUIDs selected from this site's `icp_mining` records.
  An explicit empty selection means no work, **not** all lists. The saved subset
  is retained when switching back to all lists but ignored until all lists is off.
- Selected IDs are filtered by site and `pending`/`running` status before the
  database limit. Deleted, completed, failed or cross-site lists are never mined
  and do not cause fallback to other lists. Direct-ID executions also respect the
  saved selection and pending/running status. An execution already running keeps
  its settings snapshot; the next execution reads any new selection.
- The frontend loads choices through its authenticated
  `/api/settings/icp-mining-lists` route. It validates site membership before a
  site-scoped, server-only read, including lists without role-query segments that
  the legacy browser SELECT policy can omit. No RLS policy changes are required.
- Parameters are fetched when mining executes, so edits apply even to a previously
  scheduled timer. Explicit workflow `targetLeadsWithEmail` / `researchEnabled`
  options override saved values. Invalid controls or failed reads stop execution
  rather than silently spending against fallback settings.
- Existing cadence/business-hours handling remains unchanged. Always enabled does
  not mean continually running or immediate processing at request creation. A run
  selects one queued request; no queued request means no provider calls.

## Pagination and persistence

Finder pages contain 10 candidates; the safety cap remains 300 pages per run.
Processing stops at the target, even inside a page. `current_page_offset` stores
the next candidate within `current_page`. A null offset identifies historical
whole-page cursors. Progress counts are cumulative; workflow results report only
the current run. Unknown totals are learned on the first normal page, without a
second enrichment pass just to hydrate the total. New executions persist the exact
provider page before enrichment and checkpoint each finished candidate. Partial
pages resume from this snapshot, not a new provider response with potentially
different ordering.

The owner run ID and sequential checkpoint version fence all progress updates.
An active Temporal run cannot be replaced by another caller. Recovery from an
interrupted run checks its exact Temporal workflow/run status and takes over with
a database compare-and-swap; missing/unavailable Temporal history fails closed.
There is no clock-based lease that could expire while paid work is still running.
Repeated checkpoints are idempotent and older owners cannot regress counters or
release/complete a newer execution. Legacy direct progress writers are rejected
after a request enters this protocol.

Failed fetches, enrichment/persistence outages and requested research failures
retain the unfinished candidate/cursor and leave the request pending for a later
execution. A definitive no-match is distinct from a retryable failure. A saved
lead survives failed research and is reused on retry; mining does not rely on
Follow Up being enabled to retry its requested research. Provider person, role and
organization data flow into enrichment instead of being reduced to an ID and name.
Schema-compatible fields are mapped to person, lead and company columns; full
provider documents are retained in `persons.raw_result` and lead Finder metadata.
Sparse refreshes must not erase previously populated fields or unrelated research
metadata.

Deep research uses the same `leadResearchWorkflow` as Follow Up. A persisted
`metadata.deep_research` state distinguishes running, failed and completed attempts.
Finder metadata and imported notes alone do not satisfy research validation. Full
research output, including extra company fields, is retained in
`metadata.deep_research_result`; fallback/error envelopes and empty templates are
not successful research. Follow Up recognizes completed mining research and skips
both redundant lead research and redundant company website research.

Research requires a completed analysis command and substantive returned evidence;
HTTP 200, timeout envelopes, copied input templates and generated timestamps are
not completion. Optional email generation or segmentation errors do not invalidate
successfully persisted research. Model output cannot change relationship IDs or
system research/verification metadata. Company writes use the relationship captured
before research, and supported legal/financial/company fields remain structured.

Raw invalid/unverified contact data remains available in the provider snapshot,
but it does not stop the validated-contact cascade. Known-invalid contacts are not
promoted to lead primaries. Unverified emails use the existing validation activity,
and malformed/explicitly invalid phones are excluded from usable contacts. A
provider/validation outage is not a definitive no-match.

## Deployment

1. Drain old mining/research executions before rollout (old histories retain their
   recorded code paths). Apply `supabase/migrations/20260929220000_icp_mining_page_offset.sql`
   followed by `supabase/migrations/20260929230000_icp_mining_execution_checkpoints.sql`.
   The latter adds run ownership, checkpoint version, page snapshot, and service-only
   claim/checkpoint RPCs plus a guard against legacy unfenced progress writes.
2. Deploy the Workflows worker with the new configuration activity and workflow
   branches, then the frontend changes in the `market-fit` repository.
3. New histories use `icp-mining-configurable-independent-v1` and
   `icp-page-configurable-independent-v1`. The old branches remain for replay of
   pre-change histories; do not remove these patches while those histories exist.
   Research uses `lead-research-persist-completion-v1` and
   `lead-research-shared-completion-v1` for its corresponding new command paths.
   Research validation/identity repairs use `lead-research-identity-completion-v2`
   and `deep-research-validated-analysis-v1`. Old pending company-save payloads with
   no trusted pre-research company snapshot fail closed and require a new run.
   The list filter uses `icp-mining-list-selection-v1` to keep historical query
   commands unchanged. `icp-mining-owned-checkpoints-v1` enables the new ownership
   protocol; its page/enrichment children use explicit versioned input fields.
   List preferences themselves still use existing JSON settings.
4. No site data backfill, production restart, or request creation is performed by
   this code change. Existing pending requests can be picked up by normal scheduling.

## Verification

Run the `icp-mining-*.test.ts` suites, channel-health boundary tests, outreach
regressions, provider-data tests and research-state tests with Jest. The SQL fixture
`tests/icp-mining-page-offset.sql` validates the migration in an isolated PostgreSQL
database and rolls back all fixture changes. Do not run it on a real application DB.
`tests/icp-execution-checkpoints.sql` validates claim contention, repeated writes,
stale owner rejection, monotonic progress, snapshot retention and RPC permissions.

No live provider calls, production Temporal replay or live RLS policy test are
required by these unit suites. They mock service boundaries; validate the deployed
workflow with a deliberately selected existing request after rollout. No historical
failed/completed records are backfilled or restarted by this change; review them
explicitly before any recovery. A busy request returns without provider calls.