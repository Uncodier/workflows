# Conversation FIFO and task linkage

## Acceptance and execution

The API submits scoped customer-support requests to `conversationIngressWorkflow`
using `signalWithStart`. The coordinator's signal history is the durable acceptance
order. It starts one per-message workflow, awaits its full result (including the
awaited delivery workflow), then starts the next. A newer message never replaces,
supersedes, or cancels an older message. Different conversations run independently.

Scope is site plus conversation ID. Zavu inbound requests use their verified routing
tuple (channel, connection, business sender, customer sender) because CRM conversation
resolution happens inside the support API. Queue workflow IDs hash that tuple so
recipient identifiers do not appear in workflow IDs.

This is FIFO by durable ingress acceptance, not a promise to reconstruct upstream
provider ordering if concurrent webhooks arrive out of order. Provider event time
alone is not an ordered delivery sequence.

Direct/legacy starts entering `customerSupportMessageWorkflow` use a patch-gated
fallback coordinator, `conversationTurnQueueWorkflow`, before agent/tools execution.
It grants the exact workflow run and waits for terminal state. It never releases an
expiring lease while a slow run is still active. History rollover preserves active
ownership. Requests without a safe scope retain the existing unscoped behavior.

## Cancellation and failure

Explicitly cancel the per-message workflow to cancel a queued/active request. A
settled child failure/cancellation allows ingress to advance; an inability to start
or establish execution identity fails closed. New incoming requests do not cancel
anything. Delivery children of patched scoped support runs wait for cancellation
completion, preventing a canceled entry from abandoning a still-running send.

Do not terminate the coordinator to clear a conversation: termination bypasses
workflow cleanup, and abandoned children may still run. Inspect/cancel the relevant
per-message execution explicitly. A timeout/network uncertainty must not be treated
as permission to start another request.

## Rollout

1. Deploy the worker first with both new workflow exports and conversation-turn
   activities registered on the relevant queues (`default`, `high`, etc.).
2. Deploy the API's ingress dispatch and trusted task conversation linkage.
3. Check queued messages, per-message execution order, task IDs, and delivery receipts.

No database migration is required for FIFO or task linkage. Existing running histories
remain on their legacy branch through `conversation-turn-fifo-v1`; they are not
automatically canceled or transferred. Drain/observe legacy in-flight work during
rollout to avoid overlap. Existing duplicate tasks are not automatically merged.

Asynchronous API acceptance returns the per-message `workflowId` and `running`
status immediately, without a `runId` until the queued child actually starts.
Synchronous callers wait for child startup and then await its run-bound result.
The startup wait is bounded to five minutes; a timeout does not cancel or remove
the accepted request. Recover/inspect it by its workflow ID rather than creating
a replacement with a new identity.

Task creation obtains conversation association from trusted command metadata where
available and verifies site/lead linkage. Conversation identity must not depend on
the model remembering to supply a field or embedding an ID in prose.

## Validation

Offline Jest tests cover admission order, slow-first/fast-second execution, retry
deduplication, scope isolation, cancellation/terminal-state checks, history rollover,
and trusted task association. Worker TypeScript compilation and Temporal workflow
bundling must pass before deployment. No production workflow is started by tests.