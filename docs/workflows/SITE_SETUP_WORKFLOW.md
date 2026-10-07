# Minimum-data site setup

## Required input and trusted context

The authenticated API accepts a saved `site_id` UUID. It verifies the user and
owner/admin access before calling the atomic billing initializer and launching
`siteSetupWorkflow`. Company name, contact name, contact email and website URL
are not required client inputs. The worker reads the existing site and resolves
the persisted owner and company name instead of depending on stale request hints.
No new credit amount, paid entitlement or contact identity is invented.

`SiteSetupParams` keeps historical fields optional for existing internal callers.
Public API requests continue to supply only the authorized site and user identity,
setup type and validated options. The workflow does not look up an arbitrary
email from a client-provided user ID.

## Independent stages

1. **Agents:** create or reuse the configured agents using the current schema.
   The required fields are site, owner, name, type, status and prompt. Allowed
   stored types are `sales`, `support` and `marketing`; legacy basic defaults
   `customer_support` and `general` are not valid stored types. Agent failures
   preserve agents already created and do not block independent stages. Retries
   reuse existing rows and insert deterministic IDs without overwriting user
    customization. Exact deterministic IDs take precedence over matching role,
    then an unroled legacy name. A conflicting nonempty role never matches only
    a display name. Reuse is same-site/type, independent of historical creator,
    and each persisted ID is consumed at most once. Results separate counts.
2. **Segments:** run the existing segment workflow only with a configured site
   URL and usable user identity, unless lead setup is explicitly disabled. The
   pipeline owns provider and context defaults; setup no longer forces an
   ecommerce industry onto every project. Missing URL skips only this stage.
3. **Account manager:** no account-manager endpoint currently exists in the API
   repository. Its activity reports an explicit unavailable/skipped result,
   rather than making an inevitably failing request or fabricating an assignment.
4. **Follow-up:** only attempt email with an explicitly supplied valid recipient
   and an available real email integration. A missing recipient skips the stage;
   no placeholder address or claimed delivery is allowed. Delivery must have
    actual provider confirmation. Optional email failure does not undo agents.
    The dedicated `/api/site/setup/email` dispatcher atomically claims a durable
    operation and receipt before real delivery. The worker requires server-only
    `SETUP_EMAIL_SERVICE_API_KEY` matching the API internal service credential;
    missing configuration skips, never falls back to the unprotected email tool.
    The key hashes Temporal namespace/workflow/run/activity IDs, stable across
    retries. Sent receipts replay actual success without core/Redis; claimed or
    uncertain attempts return unconfirmed/skipped and never automatically resend.
    A crash between send and receipt requires manual provider reconciliation,
    not an exactly-once external delivery claim. Apply the API-owned forward
    `20261007004000_setup_email_delivery_receipts.sql` before API/worker rollout;
    see API `docs/SETUP_EMAIL_DELIVERY_RECEIPTS.md` for the operator RPC procedure.

A scoped site read doubles as the connectivity check. Initialization does not
require a preliminary global query for some other site to succeed.

## Results and failures

The historical result fields remain readable. New executions additionally return:

- `status`: `completed`, `partial` or `failed`.
- `steps`: `agents`, `segments`, `account_manager`, `follow_up_email`, each with
  `status` (`completed`, `partial`, `skipped`, `failed`) and an optional reason.
- `agents_existing`: agents reused without an insert.

Missing optional context gives a partial result rather than throwing. A failed
stage records its reason and allows other eligible stages to run. Missing or
mismatched site data is a hard failure. Temporal cancellation is propagated,
never treated as an optional error that would continue side effects.

`success` remains false for failed stages. When core agents are usable and only
optional data/integrations are missing, it can be true with `status: partial`.
Consumers must use stage outcomes, not equate an accepted workflow or successful
core initialization with a completed email, manager assignment or all stages.

## Queues, replay and rollout

The API and worker share `WORKFLOW_TASK_QUEUE`, defaulting to `default`. The old
API-only `site-setup-queue` fallback had no corresponding worker subscription in
the current configuration. An accepted Temporal start is not proof that a worker
polled that queue; verify actual pollers and deployed environment values before
claiming a live cause or completion.

The `site-setup-minimum-data-v1` Temporal patch routes new executions to the
minimum-data implementation. Retained pre-patch histories keep the original
command sequence in `siteSetupLegacyWorkflow.ts`. Do not remove the legacy branch
until affected histories leave retention. Existing activity names remain stable.
Tests cover both command branches, not a real production history replay.

Deploy the worker before the API/web consumers of the new result fields. Verify
queue configuration and polling. The API-owned
`20261007003000_remove_signup_credit_bonus.sql` forward migration is still a
separate prerequisite for the one-credit policy; setup never uses a direct balance
fallback. Local source changes do not apply migrations, deploy workers, replay
workflow starts or credit production sites.

## Offline verification

Use npm and synthetic Supabase/Temporal boundaries:

```sh
npm test -- --runInBand tests/site-setup-minimum-workflow.test.ts tests/site-setup-activities.test.ts
npm test -- --runInBand tests/billing-renewal.test.ts tests/billing-rpc-contract.test.ts tests/daily-credit-renewal-workflow.test.ts
npx tsc --noEmit --incremental false
npx tsc --project worker.tsconfig.json --noEmit --incremental false
```

The old `test-site-setup` CLI starts real workflows and is not an offline test.
Do not run it, a worker, or an authenticated integration against production for
validation. External email delivery and deployed Temporal polling still require
an explicitly approved environment and independent live verification.