# Outstand Instagram sync: Pigs — 2026-09-28

## Observations (read-only checks)

- Site `fadd3df5-97a5-4c25-a7af-bdc26570bcd8`, Instagram account `Lm3jV`
  (`pigs.cly`), linked on 2026-09-22. The Outstand social-accounts endpoint
  reports it active and bound to this tenant.
- `GET /v1/social-accounts/Lm3jV/health` reports `healthy: true`. This proves
  that the identity token works; it does **not** prove that posts were imported.
- `GET /v1/social-accounts/Lm3jV/metrics` reports `posts_count: 6`,
  `platform_specific.account_type: MEDIA_CREATOR` and 30-day engagement metrics.
  The connection's `accountType: personal` is not reliable evidence that Meta
  considers this a personal (non-professional) account.
- The connected account's `network_unique_id` ends in `...336`, whereas the
  provider's identity and metrics `id` end in `...337`. Do not assume these
  are equivalent Meta identifiers; inspect the provider's import job outcome
  before assuming the mismatch is harmless or repairing any binding.
- `GET /v1/posts?tenant_id=<site>&social_account_id=Lm3jV&limit=100` returns
  `200`, `pagination.total: 0`. The unfiltered organization list has 21 posts,
  none belonging to this account. This is not a page-size or account filter
  issue: the account's Instagram media are not in the Outstand post catalog.
- `GET /v1/social-accounts/Lm3jV/imports` returns an empty list. There is no
  evidence of a previously started historical import. The site's `content`,
  `content_performance`, and `outstand_historical_import%` rows are also empty.
- The worker's hourly RPC `fetch_social_posts_due_for_analytics` returns 404
  because the function is not deployed in the production database.

## Failure chain and fixes in source

1. The old worker called `/api/integrations/outstand/accounts`, a route absent
   from API. The correct account route is `/social-accounts`. Provider post
   listing by tenant does **not** fetch pre-existing Instagram media; Outstand
   has a separate asynchronous import endpoint.
2. Outstand's import `POST /v1/social-accounts/{id}/imports` returns HTTP 202,
   `status: queued`, not a completed import. Prior code marked the site complete
   as soon as the job was queued. Each successfully imported post consumes one
   billable `social_posts` unit; importing must not be done automatically.
3. `ApiService` wraps a provider posts envelope without a top-level `data`
   field in `response.data`. The worker must read `response.data.posts` and
   preserve `pagination.total`; otherwise it can silently see zero posts or
   stop after the first page.
4. The comments poll's 30-day cutoff previously ran **before** content
   persistence. Initial sync of old posts now saves content, while comment
   ingestion still respects the age/cadence limit. Captionless posts receive
   a stable per-post identity rather than being dropped.
5. The analytics workflow reads only persisted content, then looks up Outstand
   post analytics. A missing RPC previously stopped it. A bounded fallback
   handles the absent function; the forward SQL migration also allows an
   initial snapshot for posts older than 30 days. These are not a substitute
   for importing posts into Outstand first.
6. The frontend dashboard queries only `content_performance` and filters by
   the content's `published_at` within the selected date range. Even imported
   old posts will not appear in a more recent date range. Account-level
   engagement from `/social-accounts/{id}/metrics` is a different data source.

## Safe operational sequence (not executed)

1. Deploy API, worker, and the forward SQL migration. Check that the API's
   site-authenticated GET for `/social-accounts/Lm3jV/imports` returns `[]`.
2. Confirm the account and decide how many posts may be billed. The API's POST
   requires `{ "confirm": true, "limit": 6 }` (or another number from 1 to 100).
   It rejects duplicate jobs and never runs from the scheduled worker. **No
   import has been started by this diagnosis.**
3. Check the returned job ID through the authorized GET job list or the
   provider's `GET /v1/social-accounts/{id}/imports/{importId}`. Record
   `status`, `imported`, `skipped`, `failed`, and `error`. `queued` and `running`
   are not successes. On `failed`, `partial`, or `completed` with zero posts,
   inspect the provider's error and the `...336`/`...337` identity distinction
   before retrying; retries may bill again.
4. Verify the tenant-filtered posts list contains six posts (or the provider's
   reported imported count). Then check `public.content` for this site and
   `outstand_id_%` tags. Finally check `public.content_performance` and select
   a dashboard date range that contains the posts' **publication dates**.

No direct Instagram access token is exposed in this document. Do not publish
provider tokens, access keys, full account payloads, or raw profile URLs with
signed query strings in incident reports.