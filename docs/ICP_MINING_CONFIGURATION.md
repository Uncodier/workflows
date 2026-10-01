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
  scheduled timer: `target_leads`, `research_enabled`, `all_lists` and `list_ids`
  are read directly from the database after the delay, without a worker-side cache.
  Scheduled runs ignore stale `targetLeadsWithEmail` / `researchEnabled` arguments;
  only direct manual executions can intentionally override these two saved values.
  List selection always comes from settings, including for manual executions.
  Invalid controls or failed reads stop execution rather than silently spending
  against fallback settings. Saving settings does not restart an already-failed run
  or change the snapshot of a run that has already started mining.
- Mining runs once daily per site, with deterministic per-site slots distributed
  over all 24 hours (UTC). It no longer runs 30 minutes after lead generation and
  does not depend on business hours, weekends, Standup or outreach activation.
  Stable slots avoid moving pending work on scheduler retries; timer IDs contain
  the site and UTC execution date, not a configurable clock time. Temporal rejects
  duplicate running/successful timers, and duplicate scheduling does not overwrite
  their current cron status. Each scheduler pass covers the next two daily slots
  (up to 48 hours ahead), so normal jitter in the central daily scheduler cannot
  leave the next day unplanned. This remains one execution per site per UTC day,
  not two executions per day. Only the nearest newly created timer can publish
  `SCHEDULED`, using a conditional write that preserves newer execution status.
  Always enabled does not mean continually running or
  immediate processing at request creation. A run selects one queued request; no
  queued request means no provider calls.

### Distributed scheduling rollout

`scheduleIcpMiningWorkflowsActivity` is registered with the worker and invoked by
the prioritization engine independently of the business-hours decision. The
`icp-mining-distributed-scheduling-v1` Temporal patch keeps the additional activity
out of historical command sequences. Local lead generation no longer creates an
ICP timer. Deploy the updated worker before relying on the new daily scheduling;
no new native Temporal schedule or database migration is required.

Previously created fixed-time timers are not changed or cancelled by this code.
Drain or explicitly reconcile them when rolling out to avoid a transition day with
both an old local-date timer and a new UTC-date timer. Existing ICP ownership and
checkpoints still guard concurrent work on the same request. No live timers or
production data are modified by this repository change.

### API admission limits and retries

The API has a separate `service-expensive` budget for verified internal service
credentials: **600 requests/minute**, configurable with
`SERVICE_EXPENSIVE_REQUESTS_PER_MINUTE`. This is shared by all internal workers,
not 600 per site or pod. It still consumes the shared expensive API global budget
(2,000/minute by default) and the service-key budget (5,000/minute). Public/ordinary
API credentials retain their existing limits; sending `x-api-key-data` cannot opt
into the service budget. Deploy the corresponding API middleware change as well
as the Workflows worker; changing only the worker does not raise admission capacity.

ICP role search, contact lookup (details/work emails/personal emails/phones) and
lead email generation retry **pre-handler** HTTP 429 `RATE_LIMITED` responses in
the same activity. The API client waits for the later of `Retry-After` (seconds or
HTTP date) and `error.retry_after`, plus 250–1,000 ms jitter. Missing/invalid hints
use 60 seconds. There are at most three retries, and their waits count against the
original request timeout (five minutes by default). A longer cooldown is not
shortened to squeeze in a request. Exhausted retries retain the existing pending
checkpoint and error behavior.

Only the rejected HTTP operation is repeated: earlier lookups, completed candidates,
page snapshots and credit-bearing accepted operations are not replayed by this
retry loop. It adds no workflow commands or Temporal patch/migration requirement.
Provider 429s, HTTP 402, 5xx, network failures and unknown error envelopes are **not**
automatically replayed. Finder handlers currently debit credits before the upstream
call; safely retrying provider failures requires separate idempotent billing work.
The new IcyPeas `/resolve` endpoint below is an exception: its durable submission
record makes repeating that resolver safe after transport/read failures. It still
never blindly repeats the underlying provider submission.
This change does not restart previously finished failed executions or reconcile
old timers.

Forager's [published OpenAPI specification](https://docs.forager.ai/_bundle/openapi.yaml)
and [work-email lookup contract](https://docs.forager.ai/openapi/people/datastorage_person_contacts_lookup_work_emails_create.md)
(checked 2026-10-01) accept a scalar `person_id` or `linkedin_public_identifier` for
work emails, personal emails and phone numbers, not a batch of people. No compatible
bulk contacts endpoint is documented, so this change does not invent one or launch
parallel billable lookups. Existing page snapshots and short-circuiting after a
usable contact remain intact. The 600/minute budget is **our API's admission limit**,
not a claim about Forager's account quota; verify provider capacity before raising it
further. Provider billing is separately documented in
[Forager API Credit Pricing](https://docs.forager.ai/api-overview/credit-pricing).

### IcyPeas asynchronous email discovery

IcyPeas is the first email-discovery provider in the contact cascade. Its
`/email-search` response accepts a job (`item._id`), **not** an email. The worker
now calls the tenant-scoped API `/api/integrations/icypeas/email-search/resolve`.
That endpoint durably records the search before submission, saves the returned
provider ID, and subsequently reads `/bulk-single-searchs/read` for that ID.
Repeating the same normalized name/domain/site input resumes the existing job,
including after an activity failure or a later mining execution. It never starts
another provider search just because polling was interrupted.

- `NONE`, `SCHEDULED`, `IN_PROGRESS`: keep waiting, never report an empty success.
- `FOUND`, `DEBITED`: return `results.emails`, retain certainty metadata and run
  the normal contact validation before saving a lead. Certainty is not a bypass.
- `NOT_FOUND`, `DEBITED_NOT_FOUND`: confirmed no-match; allow the Finder fallback.
- `BAD_INPUT`, `INSUFFICIENT_FUNDS`, `ABORTED`, malformed/unknown responses: expose
  an error, not no-match. An ambiguous initial submission remains fail-closed for
  manual reconciliation, rather than risking a second paid search.

Each activity polls no faster than every 15 seconds (longer server hints win),
stops before four minutes, and is cancellation-aware. Still-pending ICP candidates
remain at their existing checkpoint without purchasing fallback searches. The API
enforces shared admission at 5 submissions/second and 15 result reads/minute,
leaving fixed-window burst headroom below the documented 10/second and 30 reads/minute;
the middleware's 600/minute service quota is a
separate ceiling, not permission to exceed IcyPeas's provider limits.

**Rollout:** apply the API repository migration
`supabase/migrations/20261002000000_icypeas_email_searches.sql`, deploy that API,
then deploy the worker. The table is service-role-only with RLS. The Temporal
patch `icypeas-durable-email-search-v1` adds `site_id` to new enrichment activity
inputs while preserving recorded histories. Already-recorded successful empty
results cannot be changed by replay; legacy pending activity inputs without a
site fail closed and require a fresh workflow execution. No old search IDs can
be recovered automatically from the former activity, which discarded them.

IcyPeas [does support bulk search](https://api-doc.icypeas.com/find-emails/bulk-search)
(up to 5,000 rows), unlike the documented Forager contact endpoints. This repair
deliberately preserves the existing per-candidate spend/target boundary instead
of pre-enriching entire pages. Bulk orchestration needs a separate durable
page-to-job mapping and budget-aware selection; it is not enabled by this change.
Contracts: [read results](https://api-doc.icypeas.com/fetch-results/search-item),
[statuses](https://api-doc.icypeas.com/how-works/search_statuses),
[rate limits](https://api-doc.icypeas.com/how-works/rate_limits).

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

The runtime-settings/status and compact-payload repair requires a worker rollout
only (and the scheduler deployment for its explicit timer ID). It adds no schema
migration or frontend dependency. The migrations below are prerequisites from the
earlier ownership/cursor rollout, not additional repair migrations.

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
   `icp-mining-runtime-settings-status-v1` ensures scheduled executions read saved
   controls instead of old argument overrides, and records terminal cron status.
   Existing histories without this marker keep their recorded command sequence.
4. No site data backfill, production restart, or request creation is performed by
   this code change. Existing pending requests can be picked up by normal scheduling.

## Activity payloads and execution visibility

Mining list reads transfer only orchestration fields, not the accumulated `errors`,
`last_error` or other historical/diagnostic data. Claim responses also exclude that
history, while retaining the active page snapshot and checkpoint needed for exact
resume. Audit history remains in the database; it is not deleted to fit Temporal's
message size limits.

Scheduled runs save `RUNNING` before loading settings, then `COMPLETED` or `FAILED`,
including early exits, activity exceptions and cancellations (recorded as failed
with their cancellation reason, without swallowing cancellation). `workflow_id` is the
real Temporal execution ID, and `schedule_id` identifies the timer/native schedule
instead of the shared synthetic `icp-mining-batch` ID. Error summaries are bounded
and include nested activity causes. ICP is included in both the documented cron
allowlist and the worker's fallback when the documentation is not packaged.
Direct manual runs retain the existing `manual-execution` exclusion from cron status.
Forced termination and run timeouts cannot execute workflow cleanup; these still
require the existing stuck-status reconciliation.

## Verification

Run the `icp-mining-*.test.ts` suites, channel-health boundary tests, outreach
regressions, provider-data tests and research-state tests with Jest. The SQL fixture
`tests/icp-mining-page-offset.sql` validates the migration in an isolated PostgreSQL
database and rolls back all fixture changes. Do not run it on a real application DB.
`tests/icp-execution-checkpoints.sql` validates claim contention, repeated writes,
stale owner rejection, monotonic progress, snapshot retention and RPC permissions.
`icp-mining-replay.test.ts` uses synthetic histories with the real offline Temporal
replay engine to validate old/new command sequences and reject an incompatible
terminal-status command. `icp-mining-runtime.test.ts` checks settings edits during
the timer delay; payload regressions use audit histories larger than 8.6 MB.

No live provider calls, production Temporal replay or live RLS policy test are
required by these unit suites. They mock service boundaries; validate the deployed
workflow with a deliberately selected existing request after rollout. No historical
failed/completed records are backfilled or restarted by this change; review them
explicitly before any recovery. A busy request returns without provider calls.