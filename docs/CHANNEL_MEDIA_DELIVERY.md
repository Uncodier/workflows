# Channel media delivery deployment

For immediate Zavu replies, deploy the API's saved-turn destination checks before
the `zavu-saved-channel-reply-v1` worker patch. New executions carry the provider
event as a constraint and name the delivery child by the saved assistant reply,
not by an event ID shared across accounts. The responder comes from generation,
not a role-based input. No child starts without saved reply and conversation IDs.
The version marker preserves the existing commands on replay; it does not add a
second sender or change the widget. See the [API delivery contract](../../API/docs/CHANNEL_MESSAGE_ADMISSION.md#reply-on-the-original-connection).

The worker now forwards the API's canonical outbound media contract:
`message_type` (`image`, `video`, `audio`, `document`), `media_url`, and optional
`mime_type`. Empty saved text is valid when the assistant reply includes media.
Inbound user attachments are not reused as outgoing assistant attachments.

Customer-support output is read from the assistant fields or assistant
`custom_data`, then forwarded unchanged to the WhatsApp/channel send activities.
Approval and automation-snooze guards remain in place. Approved media uses exact
delivery, whose API reloads the current saved message, metadata and destination.
The WhatsApp child also reloads saved content and media before dispatch.

Existing-media mutations use one activity attempt. Timeouts or unknown outcomes
are terminal pending manual reconciliation; they must not produce text fallback,
text-template substitution, receipt cleanup, or another automatic send attempt.
The API validates public HTTPS/DNS and actual channel capabilities.

## Deploy both services

This is implemented code, not an absent forwarding feature. The API **and** the
Temporal worker must be deployed to activate it. No deployment flags were changed.
New histories record these Temporal patches:

- `customer-support-outbound-media-v1`
- `send-channel-outbound-media-v1`
- `send-whatsapp-outbound-media-v1`
- `send-email-outbound-media-v1`
- `approved-message-outbound-media-v1`
- `approved-outstand-media-delivery-v1`

Old histories retain their prior command paths when a patch is absent. Do not
reset or blindly retry an uncertain media send after deploying; reconcile its
provider receipt first. No live provider writes are required by the offline tests.

Email assistant media is forwarded to `sendEmail` without a generic acknowledgment
fallback. Managed outreach media still uses the central outreach policy/lease API;
it never bypasses that boundary via exact or default delivery.

Approved Instagram media without a stored Zavu `connection_id` uses one scoped
generic DM activity. The API must reload the saved assistant/media and verify an
Outstand DM conversation for that identity; it cannot guess a default account or
reinterpret a comment. Async Outstand acceptance remains pending until its webhook,
without worker sent-status or task-completion writes. Legacy WhatsApp/email media
without a Zavu connection uses its current configured adapter once, with the saved
identity/media validated by the API. There is no template or alternate-provider
fallback. Other approved non-outreach media without an exact stored account remains
refused by exact delivery: save the account before approval rather than guessing.