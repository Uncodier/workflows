# Automatic outreach configuration

Cold Outreach and Follow Up use independent configuration objects under
`settings.activities.leads_initial_cold_outreach` and
`settings.activities.leads_follow_up`.

## Configuration

Each object contains:

| Field | Meaning |
| --- | --- |
| `status` | Only `active` enables automation. Missing, `default`, and `inactive` are inactive. |
| `channel_accounts` | Channel-keyed map of selected account IDs. Supports every connected site agent channel, including email, WhatsApp, SMS, Telegram, Messenger, Instagram, voice and custom provider channels. Empty selection disables that channel. |
| `all_segments` | Explicitly target all site leads regardless of segment. Defaults to false. |
| `segment_ids` | Selected site-owned segment IDs, matched against `leads.segment_id`. Empty targets no leads unless `all_segments` is true. |
| `daily_message_limit` | Integer 1–10,000, initially 30. Per site/activity/local day across all channels and accounts combined, including voice call attempts, not per workflow run. |
| `max_unanswered_messages` | Integer 1–100, initially 3. Confirmed outbound messages across channels since the last genuine inbound reply, after which no further attempt is allowed. |
| `weekdays` | Follow Up weekdays: Sunday=0 through Saturday=6; initial selection `[2,3,4]`. An empty selection disables follow-up execution. |

Zavu accounts use the ID from `channels.connections`; a selected account must belong
to the current site, match the channel, and be connected. Direct email accounts use
`email` (SMTP) or `agent_email` (AgentMail). The direct WhatsApp account uses
`whatsapp`. Unsupported accounts must not be silently substituted.

Audio is a message format on supported messaging channels, not a separate account.
Voice uses the existing tracked-call service and requires the lead's explicit voice
consent; a valid phone alone does not authorize a call. SMS uses a valid E.164 phone.
Telegram, Messenger, Instagram and custom channels require an explicit channel
identity from the site-owned lead/conversation. A social profile URL, public comment
identity, or unrelated phone number is not a valid direct-message recipient.

Accounts and segments must be configured explicitly. Changing defaults does not
rewrite live site settings, enable an activity, or migrate an existing sender.
Even an explicitly active historical activity without selections cannot send until
the selections are configured. Email aliases are not independent connected accounts.

## Execution and delivery

- Cold Outreach targets contacts who have **never** written or replied. It includes
  new and previously contacted leads, but does not automatically reactivate `cold` leads.
- Follow Up targets contacts with at least one genuine inbound message. A reply
  resets the unanswered counter; drafts, failed sends, and queued messages do not count.
- Once the unanswered cap is reached, the next eligible selection pass marks the
  lead `cold` after the reply waiting period (existing defaults: 48 hours for cold
  outreach, 7 days for follow-up). Pending work cannot send past the cap. Ambiguous
  dispatches require reconciliation and do not count as confirmed sends.

- Cold Outreach (`dailyProspectionWorkflow`) and Follow Up
  (`leadQualificationWorkflow`) read the current configuration before selecting leads.
- Segments are applied in lead queries before pagination. The single-lead workflow
  rechecks eligibility before paid verification/research and content generation.
- Channel reachability is checked against the selected accounts. A Telegram-only or
  SMS-only contact is not rejected for missing email/WhatsApp, and a failed email
  does not invalidate an otherwise reachable contact on another selected channel.
- Generated messages retain `custom_data.outreach_activity`, so both activities keep
  separate budgets even though they share `leadFollowUpWorkflow`.
- Follow-up day selection applies to execution and actual delivery, not just when a
  draft was created. Days and budgets use the site business-hours timezone.
  The timezone is `business_hours[0].timezone` (or object `timezone`), with the existing
  `America/Mexico_City` fallback. Invalid timezones block execution.
- Approved automatic messages use the API `sendOutreachMessage` tool, which reloads
  the message and site settings and enforces the account/audience/day/budget policy.
- Selected Zavu email connections are used directly; an email account such as
  `hi@makinari.email` is not ignored in favor of the site's legacy SMTP account.
- Multiple selected accounts are assigned deterministically per lead. Follow-ups
  prefer the previous confirmed sender when that account is still selected.
- Direct WhatsApp outside the reply window needs an exact approved template for
  the selected account. Without it, the message is deferred, not sent via another account.
- A policy or daily-limit deferral preserves the message for a later eligible run.
  Deferred messages do not invalidate a lead and do not fall back to unselected accounts.
- Durable delivery metadata and an atomic permit protect against duplicate sends.
  Ambiguous provider results require reconciliation instead of an automatic resend.

Historical messages carrying automatic follow-up metadata also go through the new
delivery policy. Historical messages without enough provenance to distinguish cold
outreach are treated conservatively as Follow Up; unrelated support messages keep
their existing delivery path.

## Rollout

Deploy the compatible API before the Workflows worker and UI. The new delivery path
fails closed if the API tool is unavailable; it must not revert to a legacy sender.
The API requires the existing Redis service (`REDIS_CACHE_URL` or `REDIS_URL`) for
atomic daily limits and message/lead locks. Redis unavailability defers delivery.
Temporal patch markers preserve the command history of existing workflow runs.
No workflow start, live configuration update, test email, or remote migration is
needed to validate the unit tests.