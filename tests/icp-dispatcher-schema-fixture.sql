-- Isolated PostgreSQL/PGlite only. No application imports or remote credentials.
CREATE ROLE anon;
CREATE ROLE authenticated;
-- Deliberately no BYPASSRLS: exercise service policies as well as ACL grants.
CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.sites (id uuid PRIMARY KEY, archived_at timestamptz);
CREATE TABLE public.settings (site_id uuid PRIMARY KEY REFERENCES public.sites(id), activities jsonb);
CREATE TABLE public.icp_mining (
  id uuid PRIMARY KEY, site_id uuid REFERENCES public.sites(id), role_query_id uuid,
  name text, status text NOT NULL DEFAULT 'pending', total_targets integer DEFAULT 0,
  processed_targets integer DEFAULT 0, found_matches integer DEFAULT 0,
  current_page integer DEFAULT 0, current_page_offset integer DEFAULT 0,
  started_at timestamptz, finished_at timestamptz, last_progress_at timestamptz,
  created_at timestamptz DEFAULT now(), last_error text, errors jsonb DEFAULT '[]',
  icp_criteria jsonb, future_audit_column jsonb
);
CREATE FUNCTION pg_temp.test_uuid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
INSERT INTO public.sites (id) SELECT pg_temp.test_uuid(n) FROM generate_series(1, 12) AS n;
INSERT INTO public.settings (site_id, activities) SELECT id, '{}' FROM public.sites;
INSERT INTO public.icp_mining (id, site_id, role_query_id, name, total_targets)
  SELECT pg_temp.test_uuid(100 + n), pg_temp.test_uuid(n), pg_temp.test_uuid(500 + n), 'list-' || n, 1000
  FROM generate_series(1, 12) AS n;
INSERT INTO public.icp_mining (id, site_id, total_targets) VALUES (pg_temp.test_uuid(201), pg_temp.test_uuid(1), 1000);