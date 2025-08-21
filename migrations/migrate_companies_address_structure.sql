-- Migration script to update address structure in COMPANIES table
-- This script adds street, external_number, internal_number and removes address1
-- Run this in Supabase SQL Editor

-- =====================================================
-- COMPANIES TABLE MIGRATION
-- =====================================================

-- Optional: Check current state before migration
-- SELECT 
--   id, 
--   name, 
--   address,
--   jsonb_typeof(address) as address_type,
--   address ? 'full_address' as has_full_address,
--   address ? 'street' as has_street,
--   address ? 'address1' as has_address1,
--   address ? 'external_number' as has_external_number,
--   address ? 'internal_number' as has_internal_number
-- FROM companies 
-- WHERE address IS NOT NULL AND address != '{}'::jsonb
-- LIMIT 10;

-- Update companies to new address structure
UPDATE companies 
SET address = CASE 
  -- If address has old structure with street/city/state, update to new format
  WHEN address IS NOT NULL AND address != '{}'::jsonb THEN
    jsonb_build_object(
      'full_address', CASE
        -- If full_address already exists, keep it
        WHEN address ? 'full_address' THEN address->>'full_address'
        -- Otherwise build from existing components
        ELSE CONCAT_WS(', ', 
          NULLIF(COALESCE(address->>'address1', address->>'street'), ''),
          NULLIF(address->>'city', ''), 
          NULLIF(COALESCE(address->>'state', address->>'region'), ''),
          NULLIF(COALESCE(address->>'zip', address->>'zipcode'), ''),
          NULLIF(address->>'country', '')
        )
      END,
      'street', CASE
        -- Use existing street or address1 as street
        WHEN address ? 'street' THEN address->>'street'
        WHEN address ? 'address1' THEN address->>'address1'
        ELSE NULL
      END,
      'external_number', CASE
        -- Try to extract external number from existing data
        WHEN address ? 'external_number' THEN address->>'external_number'
        WHEN address ? 'address1' THEN (
          SELECT CASE 
            WHEN address->>'address1' ~ '(?:núm\.?|no\.?|#)\s*(\d+)' THEN 
              (regexp_match(address->>'address1', '(?:núm\.?|no\.?|#)\s*(\d+)', 'i'))[1]
            WHEN address->>'address1' ~ '\b(\d+)\b' THEN 
              (regexp_match(address->>'address1', '\b(\d+)\b'))[1]
            ELSE NULL
          END
        )
        WHEN address ? 'street' THEN (
          SELECT CASE 
            WHEN address->>'street' ~ '(?:núm\.?|no\.?|#)\s*(\d+)' THEN 
              (regexp_match(address->>'street', '(?:núm\.?|no\.?|#)\s*(\d+)', 'i'))[1]
            WHEN address->>'street' ~ '\b(\d+)\b' THEN 
              (regexp_match(address->>'street', '\b(\d+)\b'))[1]
            ELSE NULL
          END
        )
        ELSE NULL
      END,
      'internal_number', CASE
        -- Try to extract internal number from existing data
        WHEN address ? 'internal_number' THEN address->>'internal_number'
        WHEN address ? 'address1' THEN (
          SELECT CASE 
            WHEN address->>'address1' ~ '(?:int\.?|interior|depto\.?|dept\.?|apt\.?)\s*([a-zA-Z0-9]+)' THEN 
              (regexp_match(address->>'address1', '(?:int\.?|interior|depto\.?|dept\.?|apt\.?)\s*([a-zA-Z0-9]+)', 'i'))[1]
            ELSE NULL
          END
        )
        WHEN address ? 'street' THEN (
          SELECT CASE 
            WHEN address->>'street' ~ '(?:int\.?|interior|depto\.?|dept\.?|apt\.?)\s*([a-zA-Z0-9]+)' THEN 
              (regexp_match(address->>'street', '(?:int\.?|interior|depto\.?|dept\.?|apt\.?)\s*([a-zA-Z0-9]+)', 'i'))[1]
            ELSE NULL
          END
        )
        ELSE NULL
      END,
      'city', COALESCE(address->>'city', NULL),
      'state', COALESCE(address->>'state', address->>'region', NULL),
      'zip', COALESCE(address->>'zip', address->>'zipcode', NULL),
      'country', COALESCE(address->>'country', NULL),
      'coordinates', CASE 
        WHEN address ? 'coordinates' THEN address->'coordinates'
        ELSE NULL
      END
    )
  -- If address is empty object, set to complete structure
  WHEN address = '{}'::jsonb THEN
    jsonb_build_object(
      'full_address', NULL,
      'street', NULL,
      'external_number', NULL,
      'internal_number', NULL,
      'city', NULL,
      'state', NULL,
      'zip', NULL,
      'country', NULL,
      'coordinates', NULL
    )
  -- If address is NULL, set to empty complete structure
  ELSE jsonb_build_object(
    'full_address', NULL,
    'street', NULL,
    'external_number', NULL,
    'internal_number', NULL,
    'city', NULL,
    'state', NULL,
    'zip', NULL,
    'country', NULL,
    'coordinates', NULL
  )
END,
updated_at = NOW()
WHERE 
  -- Update all companies to ensure consistent structure
  TRUE;

-- =====================================================
-- VERIFICATION - Check migration results
-- =====================================================

-- Summary of companies migration
SELECT 
  'COMPANIES MIGRATION RESULTS' as status,
  COUNT(*) as total_companies,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as has_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as has_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as has_internal_number,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'zip' THEN 1 END) as has_zip,
  COUNT(CASE WHEN address ? 'country' THEN 1 END) as has_country,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates,
  COUNT(CASE WHEN address = '{}'::jsonb OR address IS NULL THEN 1 END) as empty_addresses,
  COUNT(CASE WHEN address IS NOT NULL AND address != '{}'::jsonb THEN 1 END) as non_empty_addresses
FROM companies;

-- Check for old fields that should be removed
SELECT 
  'OLD FIELDS CHECK' as check_type,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as has_old_address1,
  COUNT(CASE WHEN address ? 'zipcode' THEN 1 END) as has_old_zipcode,
  COUNT(CASE WHEN address ? 'region' THEN 1 END) as has_old_region
FROM companies;

-- Show sample of migrated addresses
SELECT 
  'SAMPLE MIGRATED ADDRESSES' as sample_type,
  id, 
  name, 
  address
FROM companies 
WHERE address IS NOT NULL AND address != '{}'::jsonb
ORDER BY updated_at DESC
LIMIT 5;

-- Check for any companies with external/internal numbers extracted
SELECT 
  'EXTRACTED NUMBERS SAMPLE' as sample_type,
  id,
  name,
  address->>'street' as street,
  address->>'external_number' as external_number,
  address->>'internal_number' as internal_number,
  address->>'full_address' as full_address
FROM companies 
WHERE address ? 'external_number' AND address->>'external_number' IS NOT NULL
LIMIT 10;

-- Check extraction success rate
SELECT 
  'NUMBER EXTRACTION STATS' as stats_type,
  COUNT(*) as total_with_addresses,
  COUNT(CASE WHEN address->>'external_number' IS NOT NULL THEN 1 END) as extracted_external_numbers,
  COUNT(CASE WHEN address->>'internal_number' IS NOT NULL THEN 1 END) as extracted_internal_numbers,
  ROUND(
    COUNT(CASE WHEN address->>'external_number' IS NOT NULL THEN 1 END) * 100.0 / 
    NULLIF(COUNT(*), 0), 2
  ) as external_extraction_percentage
FROM companies 
WHERE address IS NOT NULL AND address != '{}'::jsonb;

