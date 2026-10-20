# Catalog indexing

`catalogIndexWorkflow` orchestrates the API's transactional catalog-index outbox.
The database is the source of truth: claim leases, embeddings, retries, stale
version checks and compare-and-swap completion all stay in the API/database.
Neither catalog documents nor vectors pass through workflow arguments or results.

## Input and flow

```ts
{ site_id?: string; backfill?: boolean; after_id?: string }
```

IDs must be UUIDs. `backfill` defaults to `false`; `after_id` requires
`backfill: true`. `site_id` scopes backfill only; draining is global.

1. With backfill enabled, call `backfillCatalogIndexActivity` serially with
   `{site_id?, after_id?, limit: 100}`. Advance only after a confirmed page.
2. On the last page, switch permanently to drain mode (drop the cursor).
3. Call `processCatalogIndexActivity` serially with `{limit: 8}` until the API
   reports no immediately available work. No parallel activity fan-out.
4. A failed job batch or a no-progress batch ends the run as `deferred`, even if
   the server reports `remaining: true`. Database retry delays are respected by
   the next periodic dispatch, not an in-workflow polling loop.
5. Sleep one durable second between successful pages/batches. After at most 25
   activity calls, use `continueAsNew` with only the scope, current phase and
   last confirmed cursor. Final workflow counters describe the current run,
   not all preceding continued runs.

Workflow output uses `{success, data, error}`; `data.state` is `idle` or
`deferred`. Deferred job failures are reported in counters, not raw error text.
Transport/activity failures exhaust bounded retries and fail the workflow rather
than masquerading as an empty queue. Temporal replay resumes pending activities
after worker restarts. For a terminal backfill failure, reset the failed run or
restart with `backfill: true` and the last confirmed `after_id` from its history;
repeating a page is safe because enqueueing is idempotent. An empty/default
scheduled drain never restarts the backfill scan.

## Activity contracts and durability

| API POST | Request | Whitelisted activity result |
| --- | --- | --- |
| `/api/catalog/index/backfill` | `{site_id?, after_id?, limit:100}` | `{success:true, processed, next_cursor, has_more}` |
| `/api/catalog/index/process` | `{limit:8}` | `{success:true, processed, failed, stale, refreshed?, remaining}` |

`stale` defaults to zero if omitted by an older API. Results are validated and
rebuilt field-by-field; unknown fields, vectors, documents and upstream error
bodies are never returned in activity results/failures. A non-advancing cursor
is a non-retryable contract failure.
`refreshed` is optional for rolling compatibility and bounded to 100. It reports
durable lexical refresh progress, including unchanged documents, so the workflow
continues a relationship backlog even when no embedding was generated. A genuinely
blocked/no-progress refresh batch yields to the next cron tick instead of spinning.

Activities use the existing `apiService` service-authentication convention:
worker `API_BASE_URL` and `API_KEY`, transmitted as `x-api-key`. The key must be
an API-recognized **service credential**, not a user/browser/site key. Do not put
credentials into workflow input. HTTP requests time out at 210 seconds,
activities at 240 seconds, and total scheduling/retries at 15 minutes. Temporal
retries at most three attempts with 10-second initial/60-second maximum backoff.
HTTP 408/409/425/429, 5xx and transport failures are retryable; other 4xx and
invalid contract/input failures are not. No nested HTTP retry loop is added.

## Registration and recurring dispatch

The activities are exported and included in `activities/index.ts`'s worker
bundle. The workflow is exported from `workflows/index.ts`, its client bundle,
and **`workflows/worker-workflows.ts`**, which the actual production worker loads.
Task queue is the existing `WORKFLOW_TASK_QUEUE || 'default'`; no new queue or
worker process is needed.

The companion API owns actual recurring dispatch integration:

- `GET /api/cron/catalog-index`, authenticated by `CRON_SECRET`, enabled through
  `CATALOG_INDEXING_ENABLED`, dispatched every minute by its Vercel configuration.
- It starts `catalogIndexWorkflow` with `{backfill:true}`, workflow ID
  `catalog-index-backfill:all`, conflict policy `USE_EXISTING` and reuse policy
  `ALLOW_DUPLICATE` (no overlapping periodic global backfill executions).
  Each new run scans the catalog before draining; unchanged indexed documents
  reuse embeddings, but scans can revive exhausted jobs. Monitor persistent
  failures and provider cost. The workflow itself still accepts explicit drain-only
  runs with `backfill:false`.
- Service-only `POST /api/catalog/index/start` starts an optional site/global
  backfill with IDs `catalog-index-backfill:<site|all>` and the same queue.

Operational activation requires deploying the coordinated API and updated worker,
configuring service authentication and matching Temporal namespace/queue, then
enabling the API indexing flag/cron. Database migrations/outbox writers must be
present first. Monitor failed workflow runs and deferred/failed job counters;
the outbox is retained across dispatch failures and later ticks recover eligible
work, including expired leases and delayed retries. No Temporal schedule should
also be created for this drain. These are activation instructions only: this
change does not connect to Temporal, create remote schedules or deploy anything.

## Offline verification

Run `npm test -- --runInBand tests/catalog-index-activities.test.ts
tests/catalog-index-workflow.test.ts tests/catalog-index-registration.test.ts`.
Tests mock configuration, HTTP and Temporal commands; they do not read dotenv,
contact any API/Temporal server, or create schedules. Auth values are generated
at runtime with `node:crypto` on reserved `.test` hosts.