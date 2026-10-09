# Due invoice AI activity

`settings.activities.invoices_due` is explicit opt-in: absent, `default`, and
`inactive` settings never schedule or generate reminders. It is independent of
cold outreach and lead follow-up.

## Configuration

- `channel_accounts`: existing connected account IDs grouped by channel. No
  unselected account or provider fallback is allowed. Phone calls use `voice`.
- `cooldown_mode`: `progressive` by default for new invoice settings (1, 1, 3,
  7, then 14 days after successive confirmed reminders of the same invoice) or
  `fixed` using `repeat_interval_days` (integer 1–365, default 3). Existing
  invoice settings with `repeat_interval_days` and no mode remain fixed.
- `daily_message_limit`: shared per-site activity delivery budget, default 30.
- `weekdays`: selected local weekdays, default Monday through Friday.
- `start_time_mode` / `start_time`: existing activity opening/custom-time rules.

Invoice recipients are customers of the unpaid invoice, not the unassigned/new
lead prospecting audience. Assigned customers are not automatically excluded.
Recipient opt-outs and tenant boundaries still apply.
The current transport requires the invoice to reference a tenant-scoped lead.
Buyer-profile-only invoices are safely skipped as `unsupported_recipient`; no
cross-tenant profile email is used as a fallback.

## Financial dates

`sales.due_date`, `subscriptions.due_date`, and `purchases.due_date` (Bills) are
nullable database calendar dates (`YYYY-MM-DD`). There is no automatic historical
backfill. A null date does not make an invoice eligible for reminders.

A subscription's due date belongs to its upcoming `next_billing_date`. Renewals
copy it to the pending sale, then advance both dates in the same subscription
update after the invoice and order are persisted. The due date keeps its UTC
calendar-day offset from the billing date, including month-end-clamped cycles.
Existing idempotent invoice/order IDs and retry protections remain unchanged.

## Workflow

The defined `process-due-invoices-schedule` polls hourly with `SKIP` overlap once
registered through the existing schedule-management process.
`processDueInvoicesWorkflow`:

1. Reads fresh activity settings for nonarchived sites; only active opt-ins enter.
2. Rechecks configuration on each page and selects tenant-scoped pending sales
   with a positive `amount_due` and `due_date <=` the site's current local date.
3. Uses `(due_date, id)` keyset pagination, so an invoice waiting for its next
   reminder does not starve later records.
4. Calls `POST /api/agents/sales/dueInvoices` with `site_id`, `sale_id`, a stable
   invoice/local-day `reminder_key`, and `outreach_activity: invoices_due`.
5. The API rechecks the current financial record, activity/account configuration,
   recipient eligibility and persisted per-invoice repeat claim before generation.
   Managed delivery rechecks invoice state before sending queued messages.

Ambiguous contact calls are not automatically retried by the workflow. Failures
are accumulated while later invoices continue, then reported as a nonretryable
`DUE_INVOICE_REMINDERS_FAILED` failure with the summary.

## Rollout

Apply `20261008230000_invoice_reminder_cooldown.sql` once before deploying the
new API. It adds an atomic claim for progressive/fixed reminders without changing
the existing claim or old invoice receipts. Keep both repository copies identical.

Apply the forward-only financial-date and invoice-reminder migrations through
the canonical migration process before deploying callers that select the new
columns:

- `/Users/prado/Desktop/Proyectos/Uncodie/Code/market-fit/supabase/migrations/20261006210000_financial_due_dates.sql`
- `20261006230000_invoice_reminder_ledger.sql`, mirrored by the API/frontend
  migration repositories for local verification. Apply this shared migration
  version only once to the target database, not once per repository.

Deploy the API/worker/frontend together and register the new Temporal
schedule using the existing schedule-management process. Existing schedules do
not acquire new entries merely from a worker deployment.

This change does not apply remote migrations, create live schedules, enable any
tenant activity, send real messages, or deploy. Bills receive a due date but do
not initiate customer collection reminders.

## Local validation

```sh
npm test -- --runInBand tests/due-invoice-configuration.test.ts tests/due-invoice-activities.test.ts tests/process-due-invoices-workflow.test.ts tests/subscription-renewal.test.ts tests/process-subscriptions-workflow.test.ts
node node_modules/typescript/bin/tsc --project worker.tsconfig.json --noEmit
```