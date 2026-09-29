BEGIN;

-- No backfill: every post/network needs one verified ingestion, including
-- historical imports. Only a fully handled batch may advance this timestamp.
CREATE TABLE public.social_comment_sync_state (
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  outstand_post_id text NOT NULL CHECK (btrim(outstand_post_id) <> ''),
  network text NOT NULL CHECK (
    network <> '' AND network = lower(btrim(network)) AND network <> 'twitter'
  ),
  last_success_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, outstand_post_id, network)
);

ALTER TABLE public.social_comment_sync_state ENABLE ROW LEVEL SECURITY;
-- Reset service-role default privileges too: this table needs no DELETE,
-- TRUNCATE, REFERENCES, or TRIGGER grants. Site deletion uses the FK cascade.
REVOKE ALL ON TABLE public.social_comment_sync_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.social_comment_sync_state TO service_role;

COMMIT;