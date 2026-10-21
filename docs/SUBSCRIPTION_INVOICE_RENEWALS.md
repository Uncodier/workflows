# Subscription invoice renewals

`process-subscriptions-schedule` runs `processSubscriptionsWorkflow` daily.
It fetches active subscriptions with a due `next_billing_date`, resolves customer
contacts in a batch, and processes each subscription independently.

## Activities and data flow

1. `fetchDueSubscriptionsActivity()` returns subscription snapshots.
2. `fetchSubscriptionContactsActivity(subscriptions)` resolves notification
   recipients; failure falls back to per-subscription contact lookup.
3. `processSubscriptionRenewalActivity(subscription)`:
   - Checks for an existing invoice for the same site, subscription and billing
     period before resolving a responsible user or creating financial records.
     A manual/legacy invoice is reused without creating an order or changing its
     payment state. Its actual amount, currency and due date are returned.
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
   - Advances `next_billing_date` after both generated records exist, or after
     confirming a preexisting manual/legacy period invoice. Monthly dates
     use UTC and clamp to the last valid day of the next month.
   - Returns `{ sale_id, amount, currency, next_billing_date,
      public_access_token, existing_invoice? }` for the notification activity.
4. `notifySubscriptionRenewalActivity({ sub, renewalData, contact })` sends the
   existing renewal notification only for generated invoices. Reused manual or
   legacy invoices do not trigger a misleading new-invoice notification. No
   payment is captured by this workflow.

## Shared period identity and manual invoices

Invoice issue dates are not billing anchors. Both Market-fit manual invoice
actions and the worker write `sales.product_details` with:

- `subscription_id`: the linked subscription.
- `billing_cycle`: the canonical UTC billing timestamp.
- `billing_period_start`: the UTC `YYYY-MM-DD` billing anchor.
- `billing_period_end`: the next monthly anchor, exclusive (month-end clamped).

Market-fit's New invoice form allows the billing period to be selected separately
from the invoice date; by default it uses the subscription's next billing anchor.
Generate period invoice derives its metadata from the verified subscription.

The worker looks up `sales` using both `site_id` and `subscription_id`, preferring
explicit `billing_period_start`, then the legacy `billing_cycle` date. Only when
both metadata fields are missing does it use `sale_date >= period_start` and
`sale_date < period_end`. Explicit metadata for another period never falls back
to the issue date. All invoice statuses count, including paid, cancelled and
refunded invoices; replacement remains an explicit accounting operation.
Lookup errors fail closed and leave the billing schedule unchanged.

Legacy invoices without metadata can only be associated by their issue date.
Invoices issued outside their billing period require explicit period metadata;
the worker deliberately does not guess based on customer, amount or title.

## Retry safety

The sale and order primary keys are deterministic UUIDs derived from the site,
subscription, canonical UTC billing timestamp, and record type. Existing records
are read and reused. A concurrent insert conflict is recovered by reading the
winning record, not by overwriting financial state. This also handles responses
lost after a committed insert. Financial due dates require the forward-only
migration documented in `DUE_INVOICES.md`; invoice idempotency needs no separate
migration.

Market-fit's Generate period invoice uses the same sale UUID as the worker, so
concurrent uses converge through the primary key. If the manual action wins,
the worker returns that invoice without generating an order or notification.
The general New invoice form intentionally supports separate/replacement
invoices with random IDs: the preexisting-period lookup prevents later worker
duplicates, but it is not a database lock against a simultaneous arbitrary manual
insert. No new migration or existing financial-record rewrite is included.

The order number is derived from the sale UUID. Public tokens are random and
persisted once; retries reuse the stored token. A failure creating the order or
advancing the billing date does not create another invoice on retry.
Recovery validates the stored subscription/period and the order's invoice link.
A missing order uses the persisted invoice amount and currency, even if the
subscription terms changed after the invoice was committed.

Older randomly keyed/manual invoices are recognized by the period lookup; this
does not merge or delete duplicates that already exist. Notifications for generated
invoices retain the existing delivery/retry behavior and are not guaranteed exactly once.

## Workflow failures and deployment

The `subscription-renewals-report-failures-v1` Temporal patch preserves historical
executions. New executions continue through all subscriptions, then raise a
non-retryable `SUBSCRIPTION_RENEWALS_FAILED` application failure with the
`{ processed, errors }` summary when any subscription fails. An empty or fully
successful batch returns the existing summary.

The `subscription-renewals-existing-invoice-v1` patch skips scheduling the
notification for reused external invoices in new workflow histories. The
notification activity also guards this case when resuming older histories.

Deploy the updated worker and Market-fit metadata changes before reprocessing
overdue subscriptions. Use Generate period invoice for retry-safe manual issuance.
Changes to existing invoices, production backfills, and deployment are separate
operations; the regression suite performs no production writes or email sends.

## Validation

```sh
npm test -- --runInBand tests/subscription-renewal.test.ts tests/process-subscriptions-workflow.test.ts
node node_modules/typescript/bin/tsc --project worker.tsconfig.json --noEmit
```