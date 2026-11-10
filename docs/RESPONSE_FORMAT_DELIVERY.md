# Optional outbound response format

`sendWhatsappFromAgent` and `sendChannelMessageFromAgentWorkflow` accept optional
`response_format: 'text' | 'audio'`. Omission keeps legacy delivery and retries;
it is not converted to explicit text. Audio synthesis/cache/provider dispatch
belong to the HTTP API, not Temporal.

## Customer-support contract

The support API's existing response data must contain:

```json
{
  "response_format": "audio",
  "conversation_id": "<saved conversation UUID>",
  "messages": {
    "assistant": {
      "message_id": "<saved assistant message UUID>",
      "content": "The original assistant response",
      "response_format": "audio"
    }
  }
}
```

Either top-level `response_format` or `messages.assistant.response_format` is
accepted (top-level takes precedence). Explicit inbound selection takes precedence
over the generated selection. Persist `messages.custom_data.response_format` on
the assistant record so approval delivers the chosen format. Missing selection
retains legacy behavior. Existing `site_id`/`lead_id` fields remain unchanged.

Audio requires the saved assistant `message_id` and `conversation_id`; do not use
the inbound provider message ID. Content is not replaced with a fallback.

## Retry and replay boundaries

- `customer-support-response-format-v1` gates propagation from support results.
- `approved-message-response-format-v1` gates approval metadata propagation.
- Explicit send inputs use the new audio branch only when requested; old inputs
  retain their original activity options/arguments.
- Explicit audio uses one activity attempt. Timeout/uncertain send failures are
  nonretryable at workflow level too. Reconcile durable API delivery state before
  manual retry; this is deliberately more conservative than legacy text retries.
- `template_required` cannot enter template creation for explicit audio. Temporal
  performs no text fallback; the API-owned WhatsApp channel exception is below.
- Generic delivery status and destructive cleanup activities preserve audio
  metadata/receipts (`custom_data.audio_delivery`) owned by HTTP handlers.
- The approval recovery job may recover stale sending claims. HTTP handlers must
  retain their durable send claim and suppress redispatch for the same message.
- Exact-connection/outreach approval APIs read stored metadata themselves and
  must honor/reject audio rather than silently delivering text.
- Messenger audio approval uses the channel child even with `connection_id`,
  under the approval format patch. The channel HTTP handler must resolve the
  saved message's connection authoritatively; text/legacy exact routing is unchanged.

No build or deployment is required to run focused Jest tests using
`/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand`.

## WhatsApp channel audio: durable template approval

Only `channel: whatsapp` with explicit `response_format: audio` uses this new
path; the legacy Twilio WhatsApp workflow, text and omitted preferences do not
change. The API owns template creation, submission, approval, dispatch and the
durable receipt. Temporal never creates a template or sends additional audio.

- `channel-audio-template-polling-v1` gates the channel workflow's polling.
- `approved-audio-template-polling-v1` gates exact queued WhatsApp audio sends,
  their one-attempt activity options and their pending accounting. Old histories
  retain their original exact activity arguments and retry policy.
- A successful API `template_pending` response must identify the same local
  `message_id`, a `template_id`, `delivery_format: template` and
  `requested_response_format: audio`. This is NOT `template_required`.
- Before the repair patch, poll the same endpoint with the same saved message ID after durable sleeps of
  1 minute, 30 minutes, 1 hour, 6 hours, 8 hours and 9 hours (six polls, seven
  calls maximum). The initial cadence is preserved, then extended to 24h31m
  to reach the API's 24-hour approval deadline instead of stranding slow approvals.
  Each call has one activity attempt. Only confirmed pending authorizes a poll;
  timeouts, rejected/unknown receipts and malformed responses stop immediately.
- Exhaustion returns `success: false`, `status: template_pending`,
  `template_pending: true`, `polling_exhausted: true`. Exact approval aggregates
  this separately as `pending`, not sent, failed or deferred. No status update,
  task completion, cleanup or generic mark-failure call is made while pending.
- Final API `status: sent` forwards delivery metadata and provider ID. The saved
  receipt remains API-owned; rejection/uncertainty must not be reset into a new
  send by generic retry/recovery or mark-failure endpoints. Operators reconcile
  exhausted or uncertain receipts with the API using the same saved ID.

## Poll recovery and deadline repair

`template-poll-read-reconciliation-v1` preserves the previous polling history
(including all six original timers); new executions wait 1 minute, 30 minutes,
then hourly, reaching 24h31m. API polling must check provider approval **before**
applying the 24-hour timeout. No provider send activity gets automatic retries.

After an **already-pending** send poll fails, keep the previous saved receipt and
reconcile with `GET /api/agents/tools/templateDeliveryStatus` using `site_id`,
`conversation_id`, `message_id` query parameters. `apiService.request` uses the
same base and `x-api-key` as `apiService.get`, with a 15-second HTTP timeout.
The read activity has four attempts maximum, 30-second attempt timeout and a
3-minute total deadline. Transient HTTP/network failures are safe to retry only
on this read, never by blindly repeating send. Initial send uncertainty retains
the existing nonretryable behavior.

Agreed main API GET contract (no database writes or provider sends):
- `success:true`, `recovery_action:'resume'|'complete'|'stop'`.
- `local_message_id` correlates the saved message; `template_id` must match the
  prior pending receipt. `message_id` is local on resume/stop, provider on complete.
- `template_state` (or `template_delivery.state`) explicitly identifies durable
  state. Resume is allowed **only** for pending/ready; complete only for
  accepted/sent/delivered/read with a provider receipt; rejected/failed and
  dispatching/unknown/submitting stop. Failed delivery takes precedence.
- Carry `delivery_format`, `requested_response_format`, `delivery_status`, and
  template metadata. Wire `status:'sent'` and legacy template state `sent` mean
  **acceptance**, not delivery confirmation. `delivery_status` (accepted/queued,
  sent, delivered, read, failed) distinguishes actual progress; main UI owns display.

After finite read unavailability or final pending exhaustion, the workflow calls
the separately coordinated idempotent control action:
`POST /api/agents/tools/templateDeliveryStatus` with saved identity, `template_id`
and `action:'mark_reconciliation_required'`. This is **not a send**: API CAS marks
pending/ready as needing reconciliation without modifying the receipt or
dispatching. Three attempts maximum / two-minute total deadline. If storage is
also unavailable, persistence cannot be guaranteed; output explicitly records
`reconciliation_persisted:false` rather than claiming it was saved.

Unconfirmed output is `success:false,status:'needs_reconciliation',
template_pending:false,needs_reconciliation:true`, retaining prior receipt IDs.
Exact approval counts it as failed, with a `needs_reconciliation` metadata array,
never active pending/deferred/sent; no cleanup/reset/task completion follows.
Explicit stop also never sends again. Offline Core replay covers both pre-polling
and prior-polling-patch histories, including their original timer schedule.