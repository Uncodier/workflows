CREATE INDEX IF NOT EXISTS content_outstand_tags_idx
  ON public.content USING gin (tags)
  WHERE tags IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_outstand_hash_idx
  ON public.content (
    site_id,
    (metadata->>'source_content_hash'),
    created_at
  )
  WHERE metadata ? 'source_content_hash';

CREATE INDEX IF NOT EXISTS content_social_analytics_due_idx
  ON public.content (site_id, published_at)
  WHERE tags IS NOT NULL
    AND (status = 'published' OR published_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS content_performance_site_post_fetch_idx
  ON public.content_performance (site_id, outstand_post_id, fetched_at);

CREATE INDEX IF NOT EXISTS synced_objects_processing_expiry_idx
  ON public.synced_objects (site_id, object_type, external_id, claim_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS settings_email_enabled_idx
  ON public.settings (site_id)
  WHERE channels->'email'->>'enabled' = 'true';