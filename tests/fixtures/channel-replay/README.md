# Channel delivery replay fixtures

These are invented Telegram histories, not sanitized customer histories. `old-pinned-support.json` (39 events) and `old-pinned-sender.json` (14 events) freeze the successful pinned path **before** `zavu-channel-delivery-outcome-v1`. Keep these histories immutable when workflow code changes; add a separate fixture for a new sequence. Both start with the workflow inputs and end with the service's terminal event. The other scenarios build synthetic service events independently of the production implementation, including terminal failures and timeouts.

`workflows.ts` exports the real support and sender entries. The support workflow has a synthetic conversation-ingress parent (so it must not enqueue a second turn). Replay checks guidance preparation and deadline cancellation, generation, and any child start/completion. Because parent replay consumes recorded child events, the tests separately replay each applicable sender history. The missing-status legacy child is intentionally injected into the parent only. The observer sees the actual outbound commands and terminal result; it never handles activities or changes a command. A deliberately wrong activity name must produce a Core nondeterminism error.

Run from `Workflows` with installed dependencies:

```sh
npm test -- --runInBand --detectOpenHandles --silent --runTestsByPath tests/channel-delivery-outcome-replay.test.ts tests/channel-delivery-activity-contract.test.ts
```

The second suite exercises the real generation/send activities and API client's JSON request/response handling against synthetic fetch responses, with the pre-dispatch DB guard replaced. It checks what crosses the HTTP boundary, not the API server, durable receipts, a provider or final delivery. No Temporal server, network, credentials or production build are required.
