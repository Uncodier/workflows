-- Minimal isolated Postgres schema for executing the health migration and
-- tests/channel-health-integration.sql. NEVER apply to a real Supabase DB.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$$;
ALTER ROLE service_role NOSUPERUSER BYPASSRLS;
CREATE SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE public.sites (id uuid PRIMARY KEY);
CREATE TABLE public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
  channels jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  channel text
);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  custom_data jsonb DEFAULT '{}'::jsonb
);
-- Stands in for the existing non-transactional outbound HTTP trigger.
CREATE FUNCTION public.health_test_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END;
$$;
CREATE TRIGGER messages_webhooks AFTER INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.health_test_webhook();

INSERT INTO public.sites(id) VALUES ('f2717820-91c1-400c-bad1-42c737629acd');
INSERT INTO public.settings(site_id) VALUES ('f2717820-91c1-400c-bad1-42c737629acd');
GRANT USAGE ON SCHEMA public, extensions TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;