# Selected Finder membership consumption

Apply the API membership migration `20261117220000` followed by the Workflows
migrations `20261117221000`, `20261117221100`, `20261117221200`, and
`20261119220000_finder_selected_identity_and_recovery.sql` before admitting
selected-only lists or enabling the updated worker. These are additive, forward-only
migrations; no existing list is restarted, cursor reset, or provider search backfilled.

`icp_criteria.source = 'selected_people'` means selected-only, including an empty
queue. It never invokes role search. Other lists consume a bounded pending-member
phase before the next search page. Both dispatcher slices and owned manual/daily
runs support this path. The `icp-selected-members-v1` patch preserves historical
Temporal commands. Keep historical patches while their histories remain replayable.

Members are read in BIGINT `ordinal` order (serialized as text). Before enrichment,
the worker verifies the persisted `created_by` is the site owner/co-owner or an
active member with an effective license. Revoked creators fail closed; selections
are not silently reassigned to the site owner. Real person documents come from
persisted Finder evidence or the existing details endpoint with identity validation,
then go through `enrichLeadWorkflow` with validated contacts and optional real
research. New leads belong to the selected member creator. Reuse changes only
Finder metadata and, if supplied, the same-site segment. It does not change the
existing owner, person, name or contact fields. No role-search, fake contacts, outreach, or new credit bypass
is introduced.

Each terminal match/no-match/durable identity-review acknowledgement atomically
records member completion and invokes the existing owned checkpoint RPC (including
the shared dispatch candidate/match budget guard). Failed provider, credit, research,
or unconfirmed checkpoint work leaves membership pending. Lost activity ACKs repeat
the same owner/version operation without counting twice. Later executions reuse the
existing person/lead enrichment persistence rather than buying fake replacement data.

`processed_targets` remains the aggregate accounting counter used by reservations
and settlement. `selected_processed_targets` isolates its membership component;
search exhaustion calculations subtract it. Search pages, offsets and snapshots
are unchanged by membership ACKs. `search_exhausted` records provider exhaustion
independently of later appends. Selected-only `total_targets` stays API-controlled:
worker membership checkpoints send no total and cannot overwrite a concurrent append.
Finalization locks the parent and checks pending membership after checkpoint release,
so an append racing exhaustion cannot be overwritten as completed.

Reopening a search-based list consumes appended members first. A known positive
search total already covered by `processed_targets - selected_processed_targets`
does not trigger another page, even if the old list has no exhaustion marker.
An unknown total still requires provider exhaustion. The selected-only path never
uses those counters to infer membership completion or reset its cursor.

## Recovery from an earlier page-search run

For a fixed list, dispatch eligibility uses pending `icp_mining_people` rows, not
`total_targets - processed_targets`. A historical scan with 130 processed and
129 saved members can therefore resume under normal quotas. Only member ACKs
link leads; do not attach historical scan results, reset counters, clear snapshots
or start a second run. When the last pending member is acknowledged, the normal
finalizer marks the list completed independently of the historical scan counter.

Deploy the matching Finder API guard **before** rolling the worker. Both reject
the internal `__selected_people_only__` role query rather than stripping its
metadata and retrying a broad search. The API guard also protects against older
workers during rollout and runs before credit deduction or provider calls.
New owned page workflows also verify the stored role query before reusing cached
candidates (`icp-verify-cached-role-query-v1`). They do not refetch a legitimate
provider page. Drain old in-flight page work before admitting selected lists;
guards cannot retract work that was already scheduled. Keep replay patches. Verify the worker
image includes the membership activities, dispatcher and workflow, and verify
the first authorized slice ACKs only its saved ordinals without role search.
Historical lead or credit reconciliation is a separate operation.

## Offline validation

The November 19 correction is a local forward migration, not an incident backfill.
It preserves the existing BIGINT person IDs; noncanonical IDs such as `0042`
and `provider:42` have a separate exact text identity. Lead insert, metadata reuse
and final member confirmation verify the provider identity through the actual
linked person and site. A contact-key collision is not a match. No migration
reattributes the earlier scan's leads or reimburses its billed operations.

The selected lookup owns the cache check and the one details request on a cold
profile. Preparation consumes that verified profile rather than buying it again.
New histories do not automatically retry a potentially billed details activity
on an ambiguous response. No such guarantee is made for already scheduled legacy work.

Preflight settlement is valid only before paid work: the reservation, workflow,
run, initial version and baseline counters must still match. It releases the
claim and settles the reservation in one transaction without changing search
position. An ambiguous member confirmation has a different recovery path:
the worker replays only the exact confirmation, including its post-state. The
database returns a matching committed receipt or applies the original write to
its exact predecessor. Conflicting or unknown ownership must not trigger release
or re-enrichment. Inspect durable receipts before manual cancellation/takeover.

Run the isolated worker regressions and type check from Workflows:

```sh
npm test -- --runInBand --testPathPattern='tests/(icp-|icypeas-icp|finder-|spendable-credits|channel-health-workflow-boundary)'
npm exec -- tsc --project worker.tsconfig.json --noEmit
```

Use npm/Jest with the committed dependencies. `tests/icp-selected-people.test.ts`
checks real workflow wiring through mocked service boundaries, attribution, retries,
research and no selected-only search fallback. `tests/icp-selected-people-sql.test.ts`
uses the already-installed sibling API PGlite, without application credentials,
to exercise actual migration/RPC semantics, budget settlement, exact ACK replay,
cursor preservation, append finalization and revoked licenses. Its isolated
130/129 regression drains the 129 saved members across 13 reservations without
rewinding page 13, counting historical matches again, or linking the unrelated lead. Existing offline
Temporal replay suites exercise pre-membership histories. Worker typecheck:
`node node_modules/typescript/bin/tsc --project worker.tsconfig.json --noEmit`.

No provider calls, schedule operations, remote migrations, deployments, dependencies,
or production build are required for these checks. Live/provider acceptance remains
a separately approved rollout step.