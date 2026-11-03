# Azure workflow incident repair — 2026-11-03

## Evidence and fixes

- Azure Monitor workspace `uncodie-tmp-law`, AKS `uncodie-tmp-aks`, namespace
  `temporal-workers`: reviewed the 24-hour window ending around 19:20 UTC.
- Social polling: 288 distinct executions reported 13 post failures each.
  A read-only check in the deployed worker confirmed account-boundary rows exist
  but the SDK's unescaped `IN` builder returns zero matches for JSON scope keys.
  Explicit escaped PostgREST text filters returned the expected rows. The local
  text-filter fixes are included in the repair image; no boundary rows are reset.
- Invoice reminders: the client registry exported `processDueInvoicesWorkflow`,
  but the actual production entrypoint `worker-workflows.ts` did not. Added the
  export and a test requiring parity with client workflow-module exports.
- Archived-site analysis: preserve legacy activity results and close with a
  typed non-retryable failure; failure reporting cannot replace the original
  error. Scheduling excludes archived sites. These existing local fixes are
  included in the repair image.
- Assignment: one orphan `assignLeadsWorkflow` execution, started 2026-08-26,
  never completed a workflow task and had cancellation requested 2026-08-27.
  There is no current schedule or local implementation. Terminated this exact
  execution/run on 2026-11-03; no historical assignments were executed.
- Email: classify explicit authentication failures, SMTP configuration absence
  and recipient suppression as permanent. Do not classify generic
  `EMAIL_FETCH_ERROR`, timeouts, rate limits or arbitrary 5xx as authentication.
  Delivery-status authentication failures are reported as skipped; transient
  failures remain eligible for bounded Temporal activity retries.

## Validation

- Worker TypeScript compilation without emitting files: passed.
- Jest (final): 131 suites passed, 3 skipped; 2,097 tests passed, 25 skipped.
- Production workflow bundle successfully replayed a real Azure history from
  a currently blocked archived-site analysis. Replay does not execute activities.
- The resulting child failure exposed the same ordinary-error wrapping in
  `delayedExecutionWorkflow`. Fixed it to preserve Temporal failures/cancellation,
  added four tests, and successfully replayed a real Azure parent-timer history.
- `git diff --check`: passed.

## Deployment procedure

Build the staged source using the existing worker Dockerfile in ACR, with a
unique repair tag. Change only the image of existing worker deployments, keeping
replica counts, credentials, settings and queue assignments intact. Record the
previous image for rollback. Verify rollouts, boundary lookups and the next normal
polling execution; do not trigger additional provider sends to test email errors.

The first repair image `repair-20261103T192541Z` rolled out successfully to all
six existing deployments (nine pods). Production activity lookups now return the
expected account boundaries. The 19:30 social poll no longer reported boundary
errors; four posts instead encountered upstream LinkedIn/Outstand 5xx responses.
These are provider failures, not a persisted-boundary regression.

Final image `repair-final-20261103T193144Z` (ACR run `cjs`) also includes the
parent-timer failure fix. All six deployments successfully rolled out; all nine
pods were Ready with zero restarts. The short post-final-rollout log window showed
no missing-workflow exports, boundary-persistence errors or ordinary-error timer
wrapping. At the last check, two old archived-site analyses and the sampled parent
timer were still Running awaiting Temporal retries; do not claim all historical
executions have closed. The 19:35 social poll was still Running, so full polling
success after the final rollout has not been established.

The old invoice execution had never scheduled an activity and remained stuck in
its initial workflow task after deployment. Reset only this execution at event 4
to recover it with the fixed bundle; replacement run
`3296d774-84f8-423f-99ce-371133f8e8b7` completed successfully. Its schedule had
previously skipped 668 attempts due to overlap. No batch reset was performed.

## Follow-up: HTTP activity deadlines

At 19:41 UTC, no archived-site analyses remained Running; the previously sampled
old parent also reached Failed. No further reset or termination was needed.

Found an HTTP/activity timeout mismatch in comment reads: `apiService.get`
defaulted to 300 seconds, whereas Temporal allowed 120 seconds. Changed the
activity to an explicit GET request with a 90-second timeout and the activity
cancellation signal. Preserve cancellation instead of converting it into a
LinkedIn provider failure. This changes activity implementation only, not the
workflow command sequence. Regression tests verify the timeout, cancellation,
and that a provider 502 remains a failed read rather than an empty success.

Validation: worker TypeScript passed; 132 Jest suites passed, 3 skipped;
2,100 tests passed, 25 skipped.

Deployed image `repair-http-20261103T194307Z` (ACR run `cjt`) to all six
deployments. All nine replacement pods were Ready with zero restarts. Verified
the compiled activity inside the new Azure pod contains the 90-second deadline
and cancellation signal. An old validation pod briefly failed readiness while
shutting down during rolling replacement; no new pod remained unhealthy.

Read-only probes from Azure for `XBzIl` (LinkedIn) and `49G0i` (Facebook) still
returned HTTP 502 with explicit Outstand upstream HTTP 500. The four affected
posts are not marked synchronized or disabled. Repairing the upstream Outstand
service is outside this worker's control; do not claim provider recovery.

## External configuration still required

No SMTP/IMAP passwords were changed. Invalid credentials must be replaced by
the account owner. AgentMail's bounced-recipient suppression must not be removed
without validating the recipient. Classification prevents useless retries within
an attempt; it does not make these accounts capable of sending/receiving, nor
does it disable subsequent scheduled executions.

The cloud build also reported 21 vulnerabilities after production dependency
pruning (8 moderate, 11 high, 2 critical). Dependency upgrades are outside this
focused incident patch and require a separate compatibility/security review.