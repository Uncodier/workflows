-- Run only in a disposable local PostgreSQL database. This fixture creates roles
-- and a sites table, then loads the forward-only migration relative to this file.
\set ON_ERROR_STOP on
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.sites (id uuid PRIMARY KEY);
\ir ../supabase/migrations/20260929010000_social_comment_sync_state.sql

INSERT INTO public.sites VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

SET ROLE service_role;
INSERT INTO public.social_comment_sync_state VALUES
  ('00000000-0000-4000-8000-000000000001', 'post-1', 'instagram', '2026-09-29T01:20:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'post-1', 'instagram', '2026-09-29T01:20:00Z');
INSERT INTO public.social_comment_sync_state VALUES
  ('00000000-0000-4000-8000-000000000001', 'post-1', 'instagram', '2026-09-30T01:20:00Z')
ON CONFLICT (site_id, outstand_post_id, network)
DO UPDATE SET last_success_at = EXCLUDED.last_success_at;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.social_comment_sync_state) <> 2 THEN
    RAISE EXCEPTION 'Checkpoint identity did not remain tenant-scoped and idempotent';
  END IF;
  IF (SELECT last_success_at FROM public.social_comment_sync_state
      WHERE site_id = '00000000-0000-4000-8000-000000000002') <> '2026-09-29T01:20:00Z' THEN
    RAISE EXCEPTION 'Updating one site changed another site';
  END IF;
  BEGIN
    INSERT INTO public.social_comment_sync_state VALUES
      ('00000000-0000-4000-8000-000000000001', 'post-1', 'twitter', now());
    RAISE EXCEPTION 'Noncanonical network was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.social_comment_sync_state VALUES
      ('00000000-0000-4000-8000-000000000003', 'post-1', 'instagram', now());
    RAISE EXCEPTION 'Missing site was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.social_comment_sync_state;
    RAISE EXCEPTION 'Service role received unwanted DELETE permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.social_comment_sync_state;
    RAISE EXCEPTION 'Authenticated browser role can read checkpoints';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.social_comment_sync_state VALUES
      ('00000000-0000-4000-8000-000000000001', 'post-2', 'instagram', now());
    RAISE EXCEPTION 'Authenticated browser role can write checkpoints';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
DECLARE
  privilege_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_comment_sync_state'::regclass) THEN
    RAISE EXCEPTION 'Row-level security is disabled';
  END IF;
  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.social_comment_sync_state', privilege_name)
      OR has_table_privilege('authenticated', 'public.social_comment_sync_state', privilege_name) THEN
      RAISE EXCEPTION 'Browser role received % permission', privilege_name;
    END IF;
  END LOOP;
END;
$$;
DELETE FROM public.sites WHERE id = '00000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.social_comment_sync_state) <> 1 THEN
    RAISE EXCEPTION 'Site deletion did not cascade only its own checkpoints';
  END IF;
END;
$$;