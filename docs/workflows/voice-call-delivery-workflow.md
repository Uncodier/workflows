# Voice Call Delivery Workflow

## Purpose

`sendApprovedMessagesWorkflow` dispatches approved outbound messages. Voice
agent calls use `sendVoiceCallFromAgentWorkflow` and are protected by a
database-enforced limit of five active calls per Zavu sender.

## Flow

1. Load approved messages and claim each message as `sending`.
2. Resolve numbered merge placeholders before dispatching SMS, Telegram, or
   Voice content. WhatsApp keeps its abstract template body and variables.
3. Start at most five Voice child workflows at a time and wait for each child
   to finish its placement attempt before starting another batch.
4. The Voice activity calls the internal `placeVoiceCall` API.
5. The API atomically claims provider capacity in
   `voice_call_deliveries`. A capacity response is safe to retry because no
   provider request was made.
6. Ambiguous provider outcomes are terminal and remain
   `placement_unknown`; they are never automatically retried.
7. Zavu webhooks advance the durable delivery record and preserve fields
   received from earlier lifecycle events.

## Activity Parameters

`placeVoiceCallFromAgentActivity` receives the recipient, personalized
greeting, site, message, conversation, lead, optional audience, language, and
maximum duration. It returns the provider call ID, delivery ID, and initial
status.

The activity retries only explicit capacity rejections. Validation failures and
ambiguous placement outcomes are non-retryable.
