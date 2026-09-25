CREATE OR REPLACE FUNCTION public.fetch_social_posts_due_for_analytics(
  p_site_ids uuid[],
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  site_id uuid,
  post_id text,
  content_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH social_content AS (
    SELECT
      content.site_id,
      content.id,
      content.published_at,
      outstand_post.post_id
    FROM public.content AS content
    CROSS JOIN LATERAL (
      SELECT substring(tag.value FROM '^outstand_id_(.+)$') AS post_id
      FROM unnest(content.tags) WITH ORDINALITY AS tag(value, position)
      WHERE tag.value LIKE 'outstand_id_%'
      ORDER BY tag.position
      LIMIT 1
    ) AS outstand_post
    WHERE content.site_id = ANY(p_site_ids)
      AND (content.status = 'published' OR content.published_at IS NOT NULL)
  ),
  due AS (
    SELECT
      social_content.site_id,
      social_content.post_id,
      coalesce(
        performance.content_id::text,
        social_content.id::text
      ) AS content_id,
      performance.fetched_at,
      social_content.published_at
    FROM social_content
    LEFT JOIN public.content_performance AS performance
      ON performance.site_id = social_content.site_id
      AND performance.outstand_post_id = social_content.post_id
    WHERE
      (
        social_content.published_at IS NULL
        AND (
          performance.fetched_at IS NULL
          OR performance.fetched_at <= now() - interval '6 hours'
        )
      )
      OR (
        social_content.published_at IS NOT NULL
        AND social_content.published_at >= now() - interval '1 day'
        AND (
          performance.fetched_at IS NULL
          OR performance.fetched_at <= now() - interval '6 hours'
        )
      )
      OR (
        social_content.published_at < now() - interval '1 day'
        AND social_content.published_at >= now() - interval '7 days'
        AND (
          performance.fetched_at IS NULL
          OR performance.fetched_at <= now() - interval '12 hours'
        )
      )
      OR (
        social_content.published_at < now() - interval '7 days'
        AND social_content.published_at >= now() - interval '30 days'
        AND (
          performance.fetched_at IS NULL
          OR performance.fetched_at <= now() - interval '24 hours'
        )
      )
  )
  SELECT DISTINCT ON (due.site_id, due.post_id)
    due.site_id,
    due.post_id,
    due.content_id
  FROM due
  ORDER BY due.site_id, due.post_id, due.fetched_at NULLS FIRST
  LIMIT greatest(1, least(coalesce(p_limit, 1000), 5000));
$$;

REVOKE ALL ON FUNCTION public.fetch_social_posts_due_for_analytics(uuid[], integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_social_posts_due_for_analytics(uuid[], integer)
  TO service_role;
