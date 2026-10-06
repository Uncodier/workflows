# Subscription invoice renewals

`process-subscriptions-schedule` runs `processSubscriptionsWorkflow` daily.
It fetches active subscriptions with a due `next_billing_date`, resolves customer
contacts in a batch, and processes each subscription independently.

## Activities and data flow

1. `fetchDueSubscriptionsActivity()` returns subscription snapshots.
2. `fetchSubscriptionContactsActivity(subscriptions)` resolves notification
   recipients; failure falls back to per-subscription contact lookup.
3. `processSubscriptionRenewalActivity(subscription)`:
   - Resolves the responsible user from `leads.assignee_id`, scoped to the
     subscription's site. If unassigned or absent, uses `sites.user_id`.
     Lookup errors and missing responsible users fail before any financial write.
     The customer's `buyer_user_id` is not the invoice's responsible user.
   - Creates a pending `sales` invoice with `user_id`, `lead_id`,
     `subscription_id`, buyer/owner references, and renewal-cycle metadata.
   - Creates its pending `sale_orders` record with the same responsible user,
     a stable order number, catalog item, amount, and public access token.
   - Copies an optional `due_date` into the invoice and advances it together with
     `next_billing_date`, preserving the UTC calendar-day payment-term offset.
   - Advances `next_billing_date` only after both records exist. Monthly dates
     use UTC and clamp to the last valid day of the next month.
   - Returns `{ sale_id, amount, currency, next_billing_date,
     public_access_token }` for the notification activity.
4. `notifySubscriptionRenewalActivity({ sub, renewalData, contact })` sends the
   existing renewal notification. No payment is captured by this workflow.

## Retry safety

The sale and order primary keys are deterministic UUIDs derived from the site,
subscription, canonical UTC billing timestamp, and record type. Existing records
are read and reused. A concurrent insert conflict is recovered by reading the
winning record, not by overwriting financial state. This also handles responses
lost after a committed insert. Financial due dates require the forward-only
migration documented in `DUE_INVOICES.md`; invoice idempotency needs no separate
migration.

The order number is derived from the sale UUID. Public tokens are random and
persisted once; retries reuse the stored token. A failure creating the order or
advancing the billing date does not create another invoice on retry.

This mechanism applies to records created by the corrected generator; it does
not automatically reconcile older randomly keyed/manual invoices. Notifications
retain the existing delivery/retry behavior and are not guaranteed exactly once.

## Workflow failures and deployment

The `subscription-renewals-report-failures-v1` Temporal patch preserves historical
executions. New executions continue through all subscriptions, then raise a
non-retryable `SUBSCRIPTION_RENEWALS_FAILED` application failure with the
`{ processed, errors }` summary when any subscription fails. An empty or fully
successful batch returns the existing summary.

Deploy the updated worker before reprocessing overdue subscriptions. Do not
manually create another invoice for a cycle already processed by the generator.
Changes to existing invoices, production backfills, and deployment are separate
operations; the regression suite performs no production writes or email sends.

## Validation

```sh
npm test -- --runInBand tests/subscription-renewal.test.ts tests/process-subscriptions-workflow.test.ts
node node_modules/typescript/bin/tsc --project worker.tsconfig.json --noEmit
```