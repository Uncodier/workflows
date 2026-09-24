-- Remove imported social posts copied from the canonical Makinari site into
-- unrelated sites. Match stable Outstand IDs first and exact normalized text
-- only as a fallback. This is one atomic, idempotent statement.
WITH
params AS (
  SELECT '9be0a6a2-5567-41bf-ad06-cb4014f0faf2'::uuid AS owner_site_id
),
canonical_content AS MATERIALIZED (
  SELECT
    c.id,
    coalesce(
      nullif(btrim(replace(c.text, E'\r\n', E'\n')), ''),
      nullif(btrim(replace(c.description, E'\r\n', E'\n')), ''),
      ''
    ) AS body
  FROM public.content c
  CROSS JOIN params
  WHERE c.site_id = params.owner_site_id
    AND EXISTS (
      SELECT 1
      FROM unnest(coalesce(c.tags, ARRAY[]::text[])) AS tag
      WHERE tag = 'outstand_only'
         OR tag LIKE 'outstand_id_%'
    )
),
canonical_outstand_ids AS MATERIALIZED (
  SELECT DISTINCT substring(tag FROM '^outstand_id_(.+)$') AS outstand_post_id
  FROM public.content c
  CROSS JOIN params
  CROSS JOIN LATERAL unnest(coalesce(c.tags, ARRAY[]::text[])) AS tag
  WHERE c.site_id = params.owner_site_id
    AND tag LIKE 'outstand_id_%'
),
targets AS MATERIALIZED (
  SELECT DISTINCT
    c.id AS content_id,
    c.site_id,
    coalesce(matched_id.outstand_post_id, any_id.outstand_post_id) AS outstand_post_id,
    CASE
      WHEN matched_id.outstand_post_id IS NOT NULL THEN 'outstand_id'
      ELSE 'exact_text'
    END AS match_reason
  FROM public.content c
  CROSS JOIN params
  LEFT JOIN LATERAL (
    SELECT substring(tag FROM '^outstand_id_(.+)$') AS outstand_post_id
    FROM unnest(coalesce(c.tags, ARRAY[]::text[])) AS tag
    WHERE tag LIKE 'outstand_id_%'
      AND substring(tag FROM '^outstand_id_(.+)$') IN (
        SELECT outstand_post_id
        FROM canonical_outstand_ids
      )
    LIMIT 1
  ) AS matched_id ON true
  LEFT JOIN LATERAL (
    SELECT substring(tag FROM '^outstand_id_(.+)$') AS outstand_post_id
    FROM unnest(coalesce(c.tags, ARRAY[]::text[])) AS tag
    WHERE tag LIKE 'outstand_id_%'
    LIMIT 1
  ) AS any_id ON true
  WHERE c.site_id <> params.owner_site_id
    AND c.type = 'social_post'
    AND (
      matched_id.outstand_post_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM canonical_content owner
        WHERE length(owner.body) >= 20
          AND owner.body = coalesce(
            nullif(btrim(replace(c.text, E'\r\n', E'\n')), ''),
            nullif(btrim(replace(c.description, E'\r\n', E'\n')), ''),
            ''
          )
      )
    )
),
target_summary AS MATERIALIZED (
  SELECT
    count(*) AS row_count,
    count(*) FILTER (WHERE match_reason = 'outstand_id') AS matched_by_outstand_id,
    count(*) FILTER (WHERE match_reason = 'exact_text') AS matched_by_exact_text
  FROM targets
),
deleted_performance AS (
  DELETE FROM public.content_performance cp
  USING targets target
  WHERE cp.site_id = target.site_id
    AND (
      cp.content_id = target.content_id
      OR (
        target.outstand_post_id IS NOT NULL
        AND cp.outstand_post_id = target.outstand_post_id
      )
    )
  RETURNING cp.id
),
deleted_sync_claims AS (
  DELETE FROM public.synced_objects synced
  WHERE EXISTS (
      SELECT 1
      FROM targets target
      WHERE target.site_id = synced.site_id
        AND (
          (
            synced.object_type = 'social_post'
            AND target.outstand_post_id IS NOT NULL
            AND synced.external_id = 'outstand:' || target.outstand_post_id
          )
          OR (
            synced.object_type = 'social_comment'
            AND target.outstand_post_id IS NOT NULL
            AND synced.metadata->>'outstand_post_id' = target.outstand_post_id
          )
        )
    )
  RETURNING synced.id
),
deleted_content AS (
  DELETE FROM public.content content
  USING targets target
  WHERE content.id = target.content_id
  RETURNING content.id
)
SELECT
  target_summary.row_count AS matched_content,
  target_summary.matched_by_outstand_id,
  target_summary.matched_by_exact_text,
  CASE
    WHEN target_summary.row_count = 0 THEN 'already_clean'
    ELSE 'cleaned'
  END AS cleanup_status,
  (SELECT count(*) FROM deleted_performance) AS deleted_performance,
  (SELECT count(*) FROM deleted_sync_claims) AS deleted_sync_claims,
  (SELECT count(*) FROM deleted_content) AS deleted_content
FROM target_summary;
