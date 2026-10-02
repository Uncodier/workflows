# Account-scoped social comment ingestion and delivery

## Contract

New comment polls iterate every unambiguously owned published account, including
multiple accounts on the same network. Missing stable account IDs fail closed.
The comment GET request sends `tenant_id`, canonical `network` (`twitter` becomes
`x`), and `account_id`; a known publishing `username` is an additional consistency
check. The companion API must authorize that exact account/post/site and derive
a unique provider username, or reject the request. There is no default-account
fallback. Deploy the API account-selector guard before enabling this worker.

Each inbound customer-support payload retains `require_approval: true` and:

- `source: "comment"`, `channel`, `network`;
- `publisher_account_id`, optional `publisher_username`;
- literal `outstand_post_id`, `platform_post_id`, `platform_post_url`;
- stable `platform_comment_id`, original `parent_comment_id` / `root_comment_id`;
- optional provider `author_id`, safe author presentation fields and
  `author_identity_status` (LinkedIn remains `resolve_on_read`).

The publisher is never used as the author. Missing author IDs remain absent;
the API isolates those comments instead of inventing a participant group.
LinkedIn resolved profiles are still stripped at the activity boundary.

The companion API groups new comments by site + network + account + post +
author, and creates deterministic inbound IDs. Worker `origin_message_id`
remains the exact scoped claim ID for persistence verification. No old
conversation, message or pending proposal is moved or rewritten.

## Storage keys and rollout boundary (no new migration)

Claim IDs use the collision-safe JSON tuple:
`outstand-comment-claim:v2:[site,network,account,post]:commentId`.
The child workflow ID includes this complete claim key without punctuation
sanitization. An oversized workflow ID fails rather than truncating identity.
The provider IDs inside payloads and claim metadata remain literal.

The existing service-only `social_comment_sync_state` table holds **worker
storage keys**, not only literal provider post IDs, in `outstand_post_id`:

- `outstand-comment-sync:v2:[site,network,account,post]`: verified last success;
- `outstand-comment-boundary:v2:[site,network,account,post]`: immutable ingestion
  cutoff, **not evidence of successful synchronization**;
- `outstand-comment-account-boundary:v2:[site,network,account]`: immutable account
  activation cutoff reused for posts discovered later.

The table's existing site/post-key/network primary key makes initialization
insert-ignore race-safe. Boundary rows must never be sent to the API/provider,
counted as synchronized posts, or reset to request a replay. Existing literal
post-ID checkpoint rows are retained unchanged. No migration or backfill is
needed beyond the existing durable-sync table.

For a single unambiguous owned account on a network, an existing legacy post
checkpoint supplies the initial cutoff and cadence. With multiple accounts,
old checkpoint rows cannot prove which account was historically selected first;
the worker does **not** reconstruct ownership from current array order. Such
scopes use the account activation cutoff. Accounts with no legacy checkpoint do
the same. This is prospective ingestion, not historical backfill: comments
before the account's first observed poll can be intentionally excluded. Once
activated, future posts reuse that original cutoff, so comments written before
their discovery poll but after activation are included.

Only comments with a valid provider `created_at` on/after the immutable cutoff
are eligible. Missing/invalid timestamps surface a failed account sync and do
not advance success; they are not silently skipped. The cutoff does not move
with last success, allowing delayed provider comments to be recovered.

Eligible legacy claim IDs are reused only for the unambiguous single-account
case with matching post metadata, or with explicit persisted publisher/post
evidence. Suppression requires both completed claims and persisted inbound
messages. Failed/in-progress legacy claims surface an error for review rather
than generating a replacement proposal. Other accounts never inherit a legacy
claim solely because the provider comment ID matches.

## Approval and delivery

The API saves `reply_to_message_id` and `reply_to_comment_id` on each proposal.
Approval forwards the saved outgoing `message_id` and metadata to
`/api/agents/tools/sendChannelMessage`; it never selects the latest inbound
comment. A phone is not required. The API follows the saved source, validates
live ownership, and owns `comment_delivery_status` and the provider receipt.

New approval runs wait for the comment delivery child. Failure/uncertainty
retains the proposal for review, not generic failed-follow-up deletion. An
activity registry guard also protects comment conversations from cleanup
commands queued by older histories. Generic status updates and enrichment
failures do not overwrite comment metadata/receipts. Existing atomic generic
claim/reset RPCs change only their status field, leaving API receipts intact.

Legacy pending proposals lacking explicit saved targets fail closed at the API.
Repair requires a separately authorized explicit source selection; do not use
ingestion replay, chronological inference, or account guessing to repair them.
Direct-message workflows and non-comment dispatch decisions are unchanged.

## Temporal compatibility and offline checks

Keep these patches while older histories can replay:

- `poll-social-comments-owned-account-scope-v2` preserves the old network-only
  poll command sequence and activity arguments for existing histories;
- `send-approved-comment-exact-target-v1` preserves old approval commands while
  enabling outcome waiting and nondestructive failure handling for new comments.

No live workflow, provider call, database migration, deployment, production
build or backfill was run during implementation. Offline validation:

```sh
npm test -- --runInBand --forceExit tests/social-comment-*.test.ts tests/outstand-workflow-replay.test.ts tests/outstand-workflow-versioning.test.ts tests/outstand-poll-helpers.test.ts tests/outreach-approved-workflow.test.ts tests/update-message-status-command-status.test.ts
node node_modules/typescript/bin/tsc --project worker.tsconfig.json --noEmit
```

The focused suite covers multi-account identity, legacy cutoff/claim safety,
future-post discovery, exact saved approval targets, retained failed proposals,
unchanged DM dispatch, and real Temporal replay of old/new poll histories.
Database/HTTP boundaries are mocked; no runtime behavior is replaced by mocks.
`--forceExit` addresses the existing Temporal/Jest handle warning after tests
finish, not a failing assertion.