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
- `template_required` cannot enter template creation for explicit audio. No text
  fallback is performed.
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