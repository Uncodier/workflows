-- Isolated helper scaffolding only. The real ownership and membership migrations
-- are applied after this fixture, not replaced with membership table stubs.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
ALTER TABLE public.sites ADD COLUMN user_id uuid;
CREATE TABLE public.site_ownership(site_id uuid, user_id uuid);
CREATE TABLE public.site_members(id uuid, site_id uuid, user_id uuid, status text, licensed boolean,
  restrict_to_assigned_only boolean DEFAULT false);
CREATE FUNCTION public.site_member_has_effective_license(p uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT licensed FROM public.site_members WHERE id=p
$$;
CREATE FUNCTION public.user_can(p_site uuid, p_operation text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM public.sites WHERE id=p_site AND user_id=auth.uid())
    OR EXISTS(SELECT 1 FROM public.site_members WHERE site_id=p_site AND user_id=auth.uid()
      AND status='active' AND public.site_member_has_effective_license(id))
$$;
CREATE FUNCTION public.current_user_has_site_location_restrictions(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.current_user_has_location_restrictions() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.persons(id uuid PRIMARY KEY, external_person_id bigint, external_role_id bigint);
CREATE TABLE public.segments(id uuid PRIMARY KEY, site_id uuid REFERENCES public.sites(id));
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid, user_id uuid, person_id uuid REFERENCES public.persons(id),
  segment_id uuid REFERENCES public.segments(id), metadata jsonb, name text,email text,phone text,personal_email text,company_id uuid,
  status text,origin text,position text,address jsonb,company jsonb,social_networks jsonb, UNIQUE(site_id,name,email));