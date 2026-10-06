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
- `target_leads` is an integer from 1 to 3000: with the five-minute dispatcher it is
  a **shared daily UTC target per site**, not a fresh allowance on every tick.
  It counts successfully enriched/saved lead matches, **not** scanned candidates, and is not a
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
- With the dispatcher enabled, mining uses the fair load-aware turns described below.
  The legacy fallback (dispatcher explicitly disabled) runs once daily per site, with deterministic per-site slots distributed
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

### Five-minute fair dispatcher

`icpDispatcherWorkflow` has its own native Temporal schedule `icp-dispatcher` every
five minutes, 15-second jitter, overlap `SKIP`. It only admits work and does not
rerun Standup, outreach, reports or the central daily engine. It starts at most the
available capacity as `icpMiningSliceWorkflow` executions on the normal queue.

Defaults live in service-only `icp_dispatch_config`:

| Control | Default | Meaning |
| --- | ---: | --- |
| `enabled` | true | New coordinator owns ICP scheduling |
| `max_concurrency` | 3 | Global outstanding reservations, including uncertain/blocked work |
| `slice_candidates` | 10 | Maximum candidates in one turn, at most one provider page |
| `daily_candidate_limit` | 3000 | Absolute per-site daily candidate reservation cap |

The effective candidate cap is `min(daily_candidate_limit, target_leads * 10)`.
For Makinari's target 150, that is at most 150 successful matches and 1,500 reserved
candidate attempts per UTC day, shared across all lists/turns. These are **work
budgets, not currency/credit guarantees**: provider and site credit checks remain
in effect. Each turn consumes its full reserved candidate allowance even on a
partial result/error, conservatively bounding repeated paid attempts. Unused match
allowance is released only after acknowledged settlement. Reservations spanning
midnight remain charged to their original UTC admission day; no concurrent new-day
turn may start for the same site.

Selection filters archived sites, saved list selection, pending/running lists,
active sites, quotas and cooldowns. It favors least-recently-served sites, then
unfinished page snapshots, lower fulfilled-target ratio and remaining required
work, with stable ID ties. Within each site, lists rotate
by least-recently-served first; unfinished snapshots break age ties, so a repeatedly
blocked partial page cannot permanently starve the site's other selected lists.
It reads all orchestration rows in bounded pages instead
of silently omitting sites past a database row limit. SQL revalidates settings,
selection, capacity and budgets atomically at reservation; a stale selection cannot
overspend or admit an unselected list.

Only one outstanding turn is allowed per site. Reserve/start retries reuse the
same Temporal workflow ID; an ambiguous start never releases its reservation.
The existing execution checkpoint RPC is fenced by the reserved candidate/match
amounts before any progress write. A normal result releases ownership, settles
actual found matches from database counters, then permits the next turn after at
least five minutes. Repeated failures back off exponentially to six hours; missing
credits, ambiguous company identities and unknown provider submissions start at
six hours. Settlement publishes the authoritative earliest next eligible time to
`cron_status.next_run`; that is an eligibility time, not guaranteed admission.

**Crash safety:** thrown child/checkpoint failures retain the reservation and
ownership. No timed lease steals it. These require explicit reconciliation after
checking the exact workflow **and descendants** have ended; this release does not
automatically reset them. A blocked site occupies global capacity intentionally
until its paid-work state is known. No child workflow is started again with a new
ID merely to recover an uncertain dispatch.

**Rollout order:** drain/review old live mining executions; apply
`supabase/migrations/20261002010000_icp_dispatcher.sql`; deploy the worker and register
the new native schedule through the existing schedule bootstrap. If
`INITIALIZE_TEMPORAL_SCHEDULES=false`, schedule registration must be done separately.
Do not delete/recreate unrelated schedules. Missing migration/config fails closed.
There is no historical daily-usage backfill: activate at a fresh UTC budget boundary
or account for prior same-day mining before release. No production changes are
performed by these source changes.

Verification: `npm test -- --runInBand` includes dispatcher ranking/activity,
slice, schedule, and offline Temporal replay regressions. The isolated SQL suite
`tests/icp-dispatcher-sql.test.ts` uses the already-installed sibling
`API/node_modules/@electric-sql/pglite` dependency; a standalone Workflows checkout
must provide that fixture dependency to run this suite. It validates real SQL
quotas, ACLs and locking contracts, but does not replace a multi-session production
load test. It never connects to Supabase or a provider.

The daily scheduling activity becomes a no-op while the dispatcher is enabled.
Fresh legacy daily/manual mining workflows use patch
`icp-dispatcher-replaces-daily-v1` to return without creating a second budget.
Already-recorded histories keep their old command sequence, hence the drain step.
Manual full-target mining is not an escape hatch while the coordinator is enabled.

### Legacy distributed scheduling rollout (dispatcher disabled)

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

### Provider-only contacts in new ICP executions

New ICP enrichment executions accept Finder and IcyPeas email results without
revalidating them through Reoon. This includes work/personal emails and cached
provider contacts returned by Finder preparation. Format checks, case-insensitive
deduplication and rejection of explicitly invalid/undeliverable contacts still
apply; a provider response is not permission to revive a known-invalid address.

Previously verified lead primaries remain eligible. A legacy lead email with no
provider contact evidence or prior verification is not assumed to be a provider
result; enrichment continues to the provider cascade rather than revalidating it.
The cascade stops at IcyPeas email discovery, Finder/Forager work emails,
personal emails and phone numbers, short-circuiting once a usable contact exists.
New ICP executions do **not** call the AI email-generation fallback. A phone-only
contact still creates/enriches a lead. If all provider lookups finish without a
usable contact, the person/provider responses are saved and enrichment returns
`success: true, outcome: 'no_match'`: the page checkpoints that candidate as
processed, without increasing found matches, and continues with the next one.
Pending IcyPeas searches, provider/credit failures and failed persistence are not
no-matches; they retain the existing retry/checkpoint safeguards.

The generator code and workflow registration remain available for other uses and
historical replays. Historical generation children only accept `validatedEmail`
confirmed through `validateEmailWorkflow`. Unvalidated `generatedEmails` are
never promoted, including guesses stored by a previous enrichment attempt.

The existing `emailVerified`, `validated_contacts` and result `validation_status`
fields represent acceptance by the contact policy, not proof of a new Reoon check
for provider emails. Full provider responses remain in `finder_contact_enrichment`.
This change does not disable validation globally or change outreach health gates.

The Temporal patch `icp-provider-email-trust-v1` preserves the Reoon activity
sequence for histories without that marker. Deploy the worker for new executions
to use provider trust. It does not reset pending-list cooldowns or replay completed
activities with new results. No database migration or automatic restart is required.

The Temporal patch `icp-provider-only-contacts-v1` removes the generation step from
new ICP enrichment runs while preserving the child-workflow commands in recorded
histories without the marker. Deploy the worker to activate it. Existing cooldowns
are not reset, completed candidates are not reprocessed, and already-started
historical generation workflows are not canceled by this source change. Non-ICP
enrichment and the shared email validator are unchanged.

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
- `FOUND`, `DEBITED`: return `results.emails` and retain certainty metadata. New
  ICP executions use the provider-email policy above, without another Reoon check.
  Histories predating that policy retain their recorded validation sequence.
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