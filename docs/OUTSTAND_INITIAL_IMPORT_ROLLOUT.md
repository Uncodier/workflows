# One-time Outstand historical import, per account

For comment ingestion after posts have been imported, see
[Durable social comment synchronization](SOCIAL_COMMENT_SYNC.md). Post imports
and comment sync checkpoints are independent and must not reset each other.

The `poll-social-comments-schedule` (configured every five minutes in Temporal)
will start **at most one historical import per supported connected account**
after this change is deployed. The request sets `limit: 100`, without a date
lower bound; which posts are selected is up to Outstand, so old posts may be
included. Outstand bills one `social_posts` unit per successfully imported
post. This may incur charges for **each existing and future** connected account.
The original request described “current month or last 100”; this implementation
chooses the latter. Importing a new post later directly on the social platform
is not a repeated historical import. X timelines are unsupported by Outstand;
Outstand rejects personal LinkedIn timeline imports, which remain terminal if
attempted. The poll can store posts from other supported networks without
calling their unsupported comments endpoints.

## Deployment (not executed here)

1. Apply `supabase/migrations/20260929000000_outstand_initial_import_per_account.sql`
   to the project containing the tenant `settings` table, **before** deploying
   the API or worker. It creates a service-only `outstand_initial_imports` ledger
   keyed by provider account ID, and RPCs to atomically claim the import and
   record its status on `settings.social_media` under `initialImport`.
2. Deploy API and Workflows together. Deploy market-fit to preserve the flag in
   the social settings form and clear the display flag on a new account ID.
   The server-side ledger prevents a repeat import after a stale settings save;
   a later cron cycle restores the missing display flag from the ledger.
3. Verify the Temporal schedule is active, worker output, provider jobs,
   `content`, and `content_performance`. Select a dashboard range containing the
   posts' original publication dates.

The API and cron share the atomic claim before any billable POST. If an HTTP
response is lost, the claim remains `unknown` and **neither** retries
automatically. Existing Outstand jobs are recorded without starting another.
Partial/failed jobs are terminal for this one-time policy; manual review is
required before any further paid attempt. The workflow validates site ownership
and provider account identity; investigate the `…336` / `…337` distinction if
Pigs' first job finishes without media.

Inspect `settings.social_media[*].initialImport` for the display state and
`outstand_initial_imports` for the durable state. Never clear the ledger as a
routine retry. The migration alone creates no billable work: **the first cron
cycle after deploying the new worker can start imports on all eligible accounts.**