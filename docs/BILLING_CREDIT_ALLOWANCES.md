# Billing credit allowances

## Ownership and flow

`dailyCreditRenewalWorkflow` orchestrates initialization and renewal; it does not
calculate or write balances. SQL migrations and the financial transaction logic
are owned by the API repository, not Workflows.

1. `fetchSitesNeedingInitializationActivity()` discovers site IDs using
   `fetch_sites_needing_billing_initialization`.
2. `initializeSiteCreditsActivity(siteId)` calls `initialize_site_billing`.
   API setup, market-fit fallback, and Workflows must share this transaction.
3. `fetchSitesDueForCreditRenewalActivity()` discovers billing candidates. Its
   legacy name does not mean that Workflows decides whether a period is due.
   It pages all billing states: a terminal `subscription_status` can coexist
   with an inactive billing status. Archived / inactive eligibility is DB-owned.
4. `renewSiteCreditsActivity(siteId, ...legacyHints)` calls
   `renew_site_plan_credits`. The database decides due dates, subscription
   ownership, allowance, and idempotency under a lock. Queued plan/balance/Stripe
   hints must never determine a financial write.

Both activities fail closed on RPC errors, unsuccessful results, or malformed
results. There is no fallback to direct balance updates or separate payment
inserts. Deleting a site, overlapping runs, and Temporal retries must be handled
by the database contract rather than client-side read/write sequences.

## Coordinated RPC contract

Service-role-only RPCs, each receiving only `{ p_site_id: siteId }` and returning
a JSON object:

| RPC | Outcomes | Required fields |
| --- | --- | --- |
| `initialize_site_billing` | `initialized`, `already_initialized` | `success`, `outcome`, `credits_granted`, `billing_id`, `credits_available` |
| `renew_site_plan_credits` | `reset`, `not_due`, `stale_period`, `stripe_managed`, `inactive` | `success`, `outcome`, `credits_granted`, `credits_available` |

Initialization grants one current-month Toolbox credit for a genuinely new
billing account, with no signup bonus. Existing
billing is **never topped up** merely because its initial payment marker is
missing. This closes the third signup issuer in Workflows as well as the API /
market-fit race. Atomic marker and billing creation belong to the RPC.

Monthly renewal replaces remaining **plan** credits with the current allowance,
never adds allowance to the previous month's unused plan credits. Current
allowances are Toolbox / commission 1, engine 20, foundry 100, enterprise 500,
plus 5 per addon on paid plans only. `starter` aliases engine, `startup` aliases
foundry, and `free` aliases Toolbox. This supersedes the old worker's enterprise 1000 and free 20
policy. The database is authoritative for aliases and addons.
Cancellation downgrades to Toolbox and clears paid addons in the DB transaction;
canceled records with a retained Stripe subscription ID must still reach the RPC.
Active Stripe-managed subscriptions remain invoice-owned.
Verified Stripe renewal uses the exact live paid invoice period in the API
settlement RPC; Workflows cannot supply invoice periods or refill that bucket.

Protected balances are `purchased_credits_available`, unclassified
`legacy_credits_available`, and withdrawable `account_balance`.
`credits_available` remains an aggregate of plan + purchased + legacy credits.
Only the plan bucket and monthly usage/period metadata may be reset by renewal.

## Schedule, periods, and retries

The existing `daily-credit-renewal` schedule runs every 1440 minutes with up to
60 seconds of jitter and a 12-hour catchup window. It is an interval from schedule
creation, **not** a fixed UTC-midnight cron. No schedule mutation is needed for
this change.
Consequently reconciliation occurs on the first successful daily run after a
UTC month boundary, not necessarily at 00:00 UTC. The DB period must not drift
to the processing timestamp.

Non-Stripe periods are UTC calendar months (first day at 00:00 UTC to the first
day of the next month), not subscription anniversary dates. Initial signup uses
the same one-credit allowance as monthly Toolbox renewal. Terminal statuses include
`canceled`, `cancelled`, and `incomplete_expired`. Scheduled cancellation is
still paid until terminal status; downgrades use canonical `commission`.

Period start/end are database-owned. Retrying within an already-covered period
returns `not_due`; concurrent clients must not replenish credits spent after the
first reset. `stale_period` is also a no-op and cannot overwrite a later persisted
period. A delayed run restores only the current period's allowance, not a
sum of historical missed months. Stripe invoice period idempotency and terminal
cancellation guards must be enforced by the same financial model in API SQL.

The old 20/31-day heuristics based on `payments.created_at` and historical
12-cycle backfill are not financial authority. The backfill CLI must perform at
most one current-period reconciliation per site and count only real `reset`
outcomes, not no-ops.
It defaults to dry-run, requires explicit `--apply` for writes, and `--dry-run`
takes precedence over `--apply`. Importing the reconciliation helper does not
load `.env.local` or connect to services.

## Rollout and offline verification

Install and verify the coordinated API migrations before deploying this worker.
The forward `20261007003000_remove_signup_credit_bonus.sql` migration removes
future welcome grants without changing existing balances. Market-fit's independent
authorized billing initialization is the primary creation path; optional setup
and this daily worker are idempotent retries, not prerequisites for initial credit.
Do not silently revert to legacy writers if an RPC is unavailable. Existing
workflow/activity names and positional parameters are retained for queued
Temporal histories; result consumers must recognize no-op outcomes.
Initialization for a deleted/missing site and renewal with missing billing
return unsuccessful RPC results; these fail closed and count as activity errors,
not financial grants.

All regression tests use mocked Supabase / Temporal boundaries. Do not run the
backfill CLI, schedule creation scripts, or a worker against production as a
test. Workflows does not contain or apply SQL migrations for this change.

Focused verification:

```sh
npm test -- --runInBand tests/billing-renewal.test.ts tests/billing-rpc-contract.test.ts tests/daily-credit-renewal-workflow.test.ts
npx tsc --noEmit --incremental false
npx tsc --project worker.tsconfig.json --noEmit --incremental false
```

These regressions verify boundary contracts, paginated discovery above 1000
rows, no legacy writes on failure, once-per-site reconciliation, and compatible
recorded activity result shapes. Database concurrency and balance conservation
must additionally pass the SQL regression suite in the API repository.