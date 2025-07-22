-- Migration: Create null_companies table
-- Description: Table to store companies that have been added to the null/blacklist
-- due to all their leads having failed communication attempts

CREATE TABLE public.null_companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  company_id uuid,
  city text NOT NULL,
  site_id uuid NOT NULL,
  reason text NOT NULL,
  failed_contact jsonb DEFAULT '{}'::jsonb,
  total_leads_invalidated integer DEFAULT 0,
  original_lead_id uuid,
  last_invalidation_lead_id uuid,
  invalidated_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT null_companies_pkey PRIMARY KEY (id),
  CONSTRAINT null_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT null_companies_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT null_companies_original_lead_id_fkey FOREIGN KEY (original_lead_id) REFERENCES public.leads(id),
  CONSTRAINT null_companies_last_invalidation_lead_id_fkey FOREIGN KEY (last_invalidation_lead_id) REFERENCES public.leads(id),
  CONSTRAINT null_companies_invalidated_by_user_id_fkey FOREIGN KEY (invalidated_by_user_id) REFERENCES auth.users(id)
);

-- Add indexes for performance
CREATE INDEX idx_null_companies_company_name ON public.null_companies(company_name);
CREATE INDEX idx_null_companies_city ON public.null_companies(city);
CREATE INDEX idx_null_companies_site_id ON public.null_companies(site_id);
CREATE INDEX idx_null_companies_company_id ON public.null_companies(company_id);
CREATE INDEX idx_null_companies_created_at ON public.null_companies(created_at);

-- Add unique constraint to prevent duplicate entries for same company in same city for same site
CREATE UNIQUE INDEX idx_null_companies_unique_company_city_site 
ON public.null_companies(company_name, city, site_id);

-- Add comments
COMMENT ON TABLE public.null_companies IS 'Companies that have been invalidated due to failed communication with all their leads';
COMMENT ON COLUMN public.null_companies.company_name IS 'Name of the company that was invalidated';
COMMENT ON COLUMN public.null_companies.company_id IS 'Reference to companies table if available';
COMMENT ON COLUMN public.null_companies.city IS 'City where the company is located (normalized to lowercase)';
COMMENT ON COLUMN public.null_companies.site_id IS 'Site that invalidated this company';
COMMENT ON COLUMN public.null_companies.reason IS 'Reason for invalidation (e.g., whatsapp_failed, email_failed)';
COMMENT ON COLUMN public.null_companies.failed_contact IS 'JSON object with failed contact information (telephone, email)';
COMMENT ON COLUMN public.null_companies.total_leads_invalidated IS 'Total number of leads invalidated for this company';
COMMENT ON COLUMN public.null_companies.original_lead_id IS 'ID of the first lead that triggered the company invalidation';
COMMENT ON COLUMN public.null_companies.last_invalidation_lead_id IS 'ID of the most recent lead that caused an update to this record';
COMMENT ON COLUMN public.null_companies.invalidated_by_user_id IS 'User who triggered the invalidation workflow'; 