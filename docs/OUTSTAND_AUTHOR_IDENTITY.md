# Outstand post and comment identities

## Ingestion

New `pollSocialCommentsWorkflow` runs use the
`poll-social-comments-author-identity-v2` Temporal patch. Histories without this
marker retain the original activity arguments and author mapping. Do not remove
the earlier mappings while those histories remain replayable.

- Read canonical `data`, not the deprecated network-specific `replies` envelope.
- Prefer nonblank `author_name`, `author_username`, and explicit author IDs.
  Facebook/Instagram raw `platform_specific.from` is also supported.
- A readable textual `author` is a display name. On Instagram, Threads, X and
  Bluesky it may also be a handle; on Facebook it is **not** a username.
- Numeric author IDs, URNs, URLs and placeholders are not handles. Explicit
  provider usernames may be numeric. A handle is not fabricated into a stable
  provider author ID.
- `publisher_username` and `publisher_account_id` identify the account publishing
  the post. `author_username` and `social_handle` identify the commenter.
  `account_username` retains its existing support-message meaning for backwards
  compatibility; do not use it as the publisher in this payload.
- Pass the owned publishing account's username when reading its comments.
- Imported content retains owned publishing accounts in
  `metadata.outstand_social_accounts`; the normal content upsert also enriches
  existing content without duplicating posts.

## LinkedIn: resolve on read, not in durable history

Outstand's `resolve_author_names=true` option resolves a commenter's URN to a
name/username/profile when visibility permits. The provider restricts caching
member profile data to at most 24 hours:
https://www.outstand.so/docs/get-post-repliescomments

Temporal activity results and child-workflow arguments are durable. Merely
adding `expires_at` to a profile does **not** expire it from history, logs, leads
or messages. Therefore the ingestion activity explicitly requests
`resolve_author_names=false` and whitelists comment data before returning to
Temporal. Resolved profile fields, including copies in raw payloads and nested
replies, are not returned. Author IDs and comment IDs remain available.
This activity-boundary protection also applies to legacy three-argument calls
that execute after the update, without rewriting any existing history. Provider
error bodies are excluded from LinkedIn activity failures as well.

LinkedIn messages carry `author_identity_status: "resolve_on_read"`. For display,
use the API GET comments endpoint with `resolve_author_names=true`, selecting
the original `outstand_post_id`, network and owned publishing account. Match
using the stored platform comment ID. The API responds with `private, no-store`;
it does not cache or persist the resolved profile. A consumer must not copy the
response into a durable workflow, lead or message. Unresolvable profiles remain
unknown. Ingestion alone does not make a UI backed exclusively by `leads.name`
display LinkedIn profile names; that UI must use the on-demand read.

## Rollout and limitations

The API's new-comment contract looks up leads by site/network and
`metadata.social_author_id`, plus `metadata.social_account_id` for scoped IDs.
LinkedIn person/organization URNs are scoped by site/network. If a stable ID is
absent or not yet linked, the author's handle can match a compatible lead;
known conflicting IDs/accounts are not merged. The publisher is never a fallback
author. Identity metadata is included in the initial lead INSERT, and database
lookup errors stop processing with HTTP 503 rather than becoming a lookup miss.
Only names still matching this integration's generated-name marker can be
refreshed; unmarked or manually edited names are preserved. No unique database
constraint is added here, so concurrent first-seen comments can still race to
create a lead; this change ensures sequential identity reuse, not global atomic
uniqueness. Display-name-only authors cannot safely be deduplicated by name.

Deploy the API comments option and the Temporal worker together (API first).
No live workflow was started or reset, and no database backfill was performed
while developing this change. Completed comment claims remain completed; this
does not re-submit historical comments to customer support or create replies.
Legacy generic lead names require a separate targeted enrichment, not replay
of support messages. Existing LinkedIn profile data in old history is not
retroactively removed by this patch.

Offline checks include author mapping, activity response sanitization, owned
publisher metadata, and actual Temporal replay of pre/post-patch histories.