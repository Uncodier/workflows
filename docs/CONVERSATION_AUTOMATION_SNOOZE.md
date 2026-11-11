# Conversation automation snooze

## Database/API contract

Deploy the API-owned migration **before** these workers:

- `conversations.automation_paused_until timestamptz`, nullable.
- `conversations.last_human_reply_at timestamptz`, nullable.
- `conversations.automation_snooze_hours numeric`, nullable; API/UI use **4 hours** when null.
- Persisted `messages.role`, `created_at`, `updated_at`, `custom_data`.
- Generated assistants should have `custom_data.automation_started_at` (server generation request start). Fallback is `created_at` for older messages.

The generation API may return `success: true` with data `{automation_paused:true, skipped:true, reason:'agent_snoozed', automation_paused_until: ISO|null, conversation_id, messages:{user:...}}`, without an assistant. Activities and support workflows treat this as a terminal success/skip, not empty-response failure. Null allows an already-suppressed inbound retry after manual resume or zero-hour intervention. Missing assistant without this explicit contract still fails validation.

Outbound APIs may return successful data with `skipped:true`, `delivered:false`, and `reason:'agent_snoozed'|'stale_automatic_reply'`. This is propagated before template receipt validation and does not mark messages/tasks delivered.

## Enforcement

`checkConversationAutomationActivity` is registered as an activity and also called inside send activities immediately before each HTTP attempt. It reads persisted message identity/role and site-scoped conversation state. Only assistant automation is blocked; a saved `team_member` message is always allowed by snooze policy. Caller-supplied role is never trusted.

An assistant is suppressed while paused, or when its generation start (fallback creation time) is at/before the latest human reply, even after snooze expiry. Suppression persists `custom_data.status='skipped'`, `automation_skipped=true`, reason and timestamp, preserving other metadata with an `updated_at` CAS. This terminal marker prevents a scheduler from delivering the old reply later. The worker does not sleep until expiry or reschedule suppressed replies.

Covered dispatch activities: generic channel, email, WhatsApp, legacy WhatsApp response, WhatsApp template, exact queued, outreach, voice placement. Approved sends have an additional preflight before spawning children. Template polls/retries recheck on each attempt. Existing template approval waits remain; a skip stops them, rather than scheduling a snooze-expiry timer.

New email/WhatsApp workflow histories preserve saved message identities under Temporal patch `conversation-automation-snooze-v1`; old histories replay with their original activity arguments. Activity-side checks still protect old histories where identity exists. Support scheduling preserves skipped reason/status.

## Boundaries

- A worker DB read and provider HTTP call are not atomic. API shared send services, direct tool routes, and API-internal template workers must repeat the guard immediately before provider dispatch. Already accepted provider sends cannot be recalled.
- Calls without both message and conversation identity cannot be scoped (billing/newsletter-style calls remain outside this feature). Conversation-only legacy FromAgent calls are considered automatic and honor active snooze, but cannot prove stale generation or a human role. Human sends must pass the persisted `team_member` message ID.
- Old generation rows without `automation_started_at` cannot prove a human reply occurred during generation if `created_at` is later; the API timestamp closes this gap for new rows.
- Fire-and-forget approved child counts still mean *child started*, not provider delivery. A child can later skip after the parent's preflight; its result/DB marker records suppression, but the already-returned parent count cannot reflect that later event.
- Database read/migration/CAS failures fail closed (no HTTP send), using existing activity retries. Human permission means bypassing snooze, not bypassing tenant verification or database availability.
- This worker neither sets snooze durations nor updates `last_human_reply_at`; authenticated human-intervention/API/UI paths own those writes.

## Offline verification

`tests/automation-snooze-activity.test.ts` exercises persisted role/tenant/CAS policy, generation timestamp races, expiry and all dispatch entry points without a live DB/provider. `tests/automation-snooze-workflows.test.ts` covers generation branches, skip propagation, approved sends, template loops, and identity forwarding. Existing provider suites mock the separate DB guard. Temporal Core replay is covered by `tests/template-delivery-replay.test.ts`.

The installed Next package in this repository does not contain `node_modules/next/dist/docs/`; this change touches no Next app/router code.