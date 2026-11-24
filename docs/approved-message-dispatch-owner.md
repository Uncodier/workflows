# Rollout gate: direct chat interventions

`accepted` is approval state, not a delivery instruction. A message with
`custom_data.dispatch_owner = 'chat_intervention'` belongs to the direct API
path, regardless of role, channel or `command_status`. Keep the marker through
retries and receipt updates. Missing/null markers and other owners remain
eligible under the existing scheduled approval and deferral rules. Do not
backfill by guessing from role or status.

**Before enabling the API writer:**

1. Apply only the reviewed forward migration in the canonical DB repo:
   `makinari-db-scheme/supabase/migrations/20261124130000_approved_message_dispatch_owner.sql`.
   Verify both public claim RPCs refuse a marked row and the reset RPC skips
   marked `sending` rows even at limit 1. It changes the private implementations,
   not the public location-checked wrappers or their grants. If the definition
   preflight fails, stop and review that schema. Never replay the historical
   Workflows `20260924160400_atomic_message_claims.sql` over the wrappers.
2. Build workers **from updated source**, including any compiled `dist` entry
   points. Replace/drain old activity and workflow pollers and finish in-flight
   pre-upgrade approval runs before emitting marked rows. The DB change alone
   cannot protect legacy code that writes directly to the table, marks invalid
   rows during enrichment, or sends before claiming. The checked-in old
   `dist/temporal/activities/messageActivities.js` is one such implementation.
3. Verify moderation readers/writers are compatible, then enable API creation
   or retry of marked rows. If rolling back, disable that producer first; keep
   worker and DB exclusions while marked records remain. Never switch their
   ownership to the schedule to recover an uncertain delivery.

The queue filters on the server before its limit and rechecks at invalid-row
updates and atomic claims. A Temporal patch filters marked activity results
before any approval-path effects. Failure cleanup must not sweep messages based
on an earlier empty snapshot: the conditional parent delete relies on the
canonical message-count/parent-lock triggers (`20261120232100_messages_lock_order.sql`).

**Other consumers:** The legacy automation/snooze guard may write `skipped` for
an assistant. It is *not* an ownership check: the API also starts direct delivery
using shared sender activities. Keep the ownership check at approval admission,
not inside shared send/receipt activities. The accepted-status indexes (including
`idx_messages_conversation_moderation`) are not dispatchers. Outside Workflows,
the conversation-list moderation flags and bulk reject handler also read accepted
rows; check their own proposal exclusions, including a marker/role collision.