# Durable social comment synchronization

> This document describes the earlier network-only durable-sync rollout.
> New runs use [account-scoped comment ingestion](SOCIAL_COMMENT_GROUPING.md),
> including prospective activation cutoffs instead of historical first-sync
> backfill, explicit account selectors, and separate boundary/success keys.

## Behavior

The `pollSocialCommentsWorkflow` now tracks the last successful comment sync
per site, Outstand post and network. The first sync is immediately due, even
for historical imports. Later syncs run five minutes after the last success
for posts up to one day old, six hours for posts up to seven days old, and
24 hours for posts up to thirty days old. Older posts receive one initial
sync, but no ongoing refresh. Posts without a valid publication date use a
six-hour interval after the initial sync.

Missing a clock window no longer defers a sync until the following midnight.
Provider errors, degraded responses, malformed payloads, failed child starts,
incomplete claims and missing persisted comments do not advance the checkpoint.
Other posts continue processing, but the run reports a terminal partial failure
so the next scheduled execution can retry posts that remain due. Genuine empty
responses do advance the checkpoint.

Comment identity uses the provider's normalized author fields. The publishing
account is not the commenter. Tenant/account ownership checks and per-comment
claims remain in place. Child workflows retain `require_approval: true`: this
change does not enable automatic replies to imported comments.

The parent waits for newly started ingestion children, then verifies completed
claims and persisted inbound comment messages before advancing the checkpoint.
The child also verifies persistence before marking its claim completed. A
customer-support response with `success: true` but `skip_database: true` is not
proof that ingestion succeeded.

On a retry, a site-scoped persisted comment is reused without invoking
customer support again. This recovers saved comments after a lost API response
without generating another reply draft. It verifies ingestion, not whether the
original support attempt successfully generated a draft.

## Rollout (requires explicit approval)

1. Apply `supabase/migrations/20260929010000_social_comment_sync_state.sql` to the
   database containing the tenant `sites` table. The new table is service-only;
   browser clients have no grants. If the worker uses a non-public tenant
   schema, adapt and review the migration for that schema before deploying.
2. Deploy the API's Outstand comment error handling and the Workflows worker.
   Deploy the dashboard commenter metadata and empty/error-state changes too.
3. Allow the existing five-minute schedule to run. There is no need to clear
   import ledgers, reimport posts, reset comment claims or manually send replies.
4. Verify `social_comment_sync_state.last_success_at`, site-scoped comment
   messages, and Temporal execution outcomes. A reported metric count is not
   evidence that authors were imported.

The first run after rollout will attempt a one-time comment sync for all owned
supported posts without a checkpoint, including historical posts. This may
increase provider reads and customer-support processing, and can create pending
reply drafts requiring approval. It does not initiate an additional historical
post import beyond the existing import policy.

Existing Temporal histories retain their former command sequence through the
`poll-social-comments-durable-sync-v1` and
`ingest-social-comment-confirm-persistence-v1` patch markers. Do not remove these
markers while pre-patch histories can still replay. Failed legacy claims marked
completed without a message require explicit review; the new verifier refuses
to certify them as successfully synchronized.

## Validation

```bash
npm test -- --runInBand tests/social-comment-*.test.ts tests/outstand-workflow-versioning.test.ts tests/outstand-workflow-replay.test.ts tests/outstand-poll-helpers.test.ts
```

Tests mock database and HTTP boundaries; the replay suite uses the real Temporal
replay engine without connecting to a server. No validation command should start
the production schedule, import provider posts, or send customer messages.

`tests/social-comment-sync.sql` is an executable migration fixture for a disposable
local PostgreSQL database only. It creates test roles and a minimal `sites` table,
loads the migration, and checks tenant-scoped idempotent upserts, foreign keys,
canonical network constraints, RLS/grants, and site-deletion cascades. It was
validated against an isolated PostgreSQL 17 cluster; never run the fixture against
an application database.