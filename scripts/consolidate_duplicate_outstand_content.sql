-- Consolidate same-site copies of the same logical Outstand post.
-- Execute this file as one statement. It preserves the earliest canonical row,
-- merges tags and references, then removes duplicate content rows.
DO $$
DECLARE
  duplicate_row record;
  merged_tags text[];
  consolidated_count integer := 0;
BEGIN
  FOR duplicate_row IN
    WITH normalized AS (
      SELECT
        content.*,
        coalesce(
          nullif(btrim(replace(content.text, E'\r\n', E'\n')), ''),
          nullif(btrim(replace(content.description, E'\r\n', E'\n')), ''),
          ''
        ) AS body,
        EXISTS (
          SELECT 1
          FROM unnest(coalesce(content.tags, ARRAY[]::text[])) AS tag
          WHERE tag = 'outstand_only'
             OR tag LIKE 'outstand_id_%'
        ) AS has_outstand_evidence
      FROM public.content
    ),
    eligible AS (
      SELECT *
      FROM normalized
      WHERE length(body) >= 20
        AND (type = 'social_post' OR has_outstand_evidence)
    ),
    ranked AS (
      SELECT
        eligible.*,
        first_value(id) OVER (
          PARTITION BY site_id, body
          ORDER BY has_outstand_evidence DESC, created_at, id
        ) AS canonical_id,
        row_number() OVER (
          PARTITION BY site_id, body
          ORDER BY has_outstand_evidence DESC, created_at, id
        ) AS copy_number,
        count(*) OVER (
          PARTITION BY site_id, body
        ) AS copies,
        max(has_outstand_evidence::integer) OVER (
          PARTITION BY site_id, body
        ) AS group_has_outstand_evidence
      FROM eligible
    )
    SELECT
      id AS duplicate_id,
      canonical_id,
      site_id,
      body,
      tags
    FROM ranked
    WHERE copies > 1
      AND copy_number > 1
      AND group_has_outstand_evidence = 1
    ORDER BY site_id, body, copy_number
  LOOP
    SELECT array_agg(DISTINCT tag ORDER BY tag)
    INTO merged_tags
    FROM (
      SELECT unnest(coalesce(canonical.tags, ARRAY[]::text[])) AS tag
      FROM public.content canonical
      WHERE canonical.id = duplicate_row.canonical_id
      UNION ALL
      SELECT unnest(coalesce(duplicate.tags, ARRAY[]::text[])) AS tag
      FROM public.content duplicate
      WHERE duplicate.id = duplicate_row.duplicate_id
    ) combined_tags;

    UPDATE public.content
    SET tags = coalesce(merged_tags, ARRAY[]::text[])
    WHERE id = duplicate_row.canonical_id;

    DELETE FROM public.content_assets duplicate_asset
    USING public.content_assets canonical_asset
    WHERE duplicate_asset.content_id = duplicate_row.duplicate_id
      AND canonical_asset.content_id = duplicate_row.canonical_id
      AND canonical_asset.asset_id = duplicate_asset.asset_id;

    UPDATE public.content_assets
    SET content_id = duplicate_row.canonical_id
    WHERE content_id = duplicate_row.duplicate_id;

    UPDATE public.content_performance
    SET content_id = duplicate_row.canonical_id
    WHERE content_id = duplicate_row.duplicate_id;

    UPDATE public.messages
    SET custom_data = jsonb_set(
      coalesce(custom_data, '{}'::jsonb),
      '{content_id}',
      to_jsonb(duplicate_row.canonical_id::text),
      true
    )
    WHERE custom_data->>'content_id' = duplicate_row.duplicate_id::text;

    UPDATE public.conversations
    SET custom_data = jsonb_set(
      coalesce(custom_data, '{}'::jsonb),
      '{content_id}',
      to_jsonb(duplicate_row.canonical_id::text),
      true
    )
    WHERE custom_data->>'content_id' = duplicate_row.duplicate_id::text;

    DELETE FROM public.content
    WHERE id = duplicate_row.duplicate_id;

    consolidated_count := consolidated_count + 1;
    RAISE NOTICE 'Consolidated duplicate content % into %',
      duplicate_row.duplicate_id,
      duplicate_row.canonical_id;
  END LOOP;

  RAISE NOTICE 'Consolidated % duplicate Outstand content rows',
    consolidated_count;
END $$;
