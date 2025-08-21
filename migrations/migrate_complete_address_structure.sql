-- COMPLETE ADDRESS STRUCTURE MIGRATION
-- Updates both LEADS and COMPANIES tables to new address structure
-- Adds: street, external_number, internal_number
-- Removes: address1, zipcode (old field name)
-- Run this in Supabase SQL Editor

-- =====================================================
-- PART 1: MIGRATE LEADS TABLE
-- =====================================================

-- Update leads with old structure to new complete structure
UPDATE leads 
SET address = CASE 
  -- If address only has full_address field, expand it to complete structure
  WHEN address ? 'full_address' AND NOT (address ? 'street') THEN
    jsonb_build_object(
      'full_address', address->>'full_address',
      'street', address->>'full_address',
      'external_number', NULL,
      'internal_number', NULL,
      'city', NULL,
      'state', NULL,
      'zip', NULL,
      'country', NULL,
      'coordinates', NULL
    )
  -- If address has old address1 field, migrate to new structure
  WHEN address ? 'address1' THEN
    jsonb_build_object(
      'full_address', COALESCE(address->>'full_address', address->>'address1'),
      'street', address->>'address1',
      'external_number', NULL,
      'internal_number', NULL,
      'city', address->>'city',
      'state', address->>'state',
      'zip', address->>'zip',
      'country', address->>'country',
      'coordinates', CASE 
        WHEN address ? 'coordinates' THEN address->'coordinates'
        ELSE NULL
      END
    )
  -- If address is just a string (edge case)
  WHEN jsonb_typeof(address) = 'string' THEN
    jsonb_build_object(
      'full_address', address#>>'{}'::text[],
      'street', address#>>'{}'::text[],
      'external_number', NULL,
      'internal_number', NULL,
      'city', NULL,
      'state', NULL,
      'zip', NULL,
      'country', NULL,
      'coordinates', NULL
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
  -- If missing new required fields, add them
  WHEN address IS NOT NULL AND address != '{}'::jsonb AND NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number') THEN
    address || jsonb_build_object(
      'street', COALESCE(address->>'street', address->>'address1', NULL),
      'external_number', COALESCE(address->>'external_number', NULL),
      'internal_number', COALESCE(address->>'internal_number', NULL)
    )
  -- Otherwise keep existing structure
  ELSE address
END,
updated_at = NOW()
WHERE 
  address IS NOT NULL 
  AND (
    -- Has only full_address but missing street
    (address ? 'full_address' AND NOT (address ? 'street'))
    OR 
    -- Has old address1 field that needs migration
    (address ? 'address1')
    OR
    -- Missing new required fields
    (address IS NOT NULL AND address != '{}'::jsonb AND NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number'))
    OR
    -- Is empty object
    address = '{}'::jsonb
    OR
    -- Is string type (edge case)
    jsonb_typeof(address) = 'string'
  );

-- =====================================================
-- PART 2: MIGRATE COMPANIES TABLE  
-- =====================================================

-- Update companies to new address structure
UPDATE companies 
SET address = CASE 
  -- If address has existing structure, update to new format
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
updated_at = NOW();

-- =====================================================
-- VERIFICATION - Check migration results for both tables
-- =====================================================

-- Summary of leads migration
SELECT 
  'LEADS MIGRATION RESULTS' as table_name,
  COUNT(*) as total_records,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as has_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as has_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as has_internal_number,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'zip' THEN 1 END) as has_zip,
  COUNT(CASE WHEN address ? 'country' THEN 1 END) as has_country,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates
FROM leads

UNION ALL

-- Summary of companies migration
SELECT 
  'COMPANIES MIGRATION RESULTS' as table_name,
  COUNT(*) as total_records,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as has_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as has_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as has_internal_number,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'zip' THEN 1 END) as has_zip,
  COUNT(CASE WHEN address ? 'country' THEN 1 END) as has_country,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates
FROM companies;

-- Check for old fields that should be completely removed
SELECT 
  'OLD FIELDS CLEANUP CHECK' as check_type,
  'leads' as table_name,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as has_old_address1,
  COUNT(CASE WHEN address ? 'zipcode' THEN 1 END) as has_old_zipcode
FROM leads

UNION ALL

SELECT 
  'OLD FIELDS CLEANUP CHECK' as check_type,
  'companies' as table_name,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as has_old_address1,
  COUNT(CASE WHEN address ? 'zipcode' THEN 1 END) as has_old_zipcode
FROM companies;

-- Sample of successfully extracted numbers
SELECT 
  'NUMBER EXTRACTION SAMPLE' as sample_type,
  'companies' as table_name,
  id,
  name,
  address->>'street' as street,
  address->>'external_number' as external_number,
  address->>'internal_number' as internal_number
FROM companies 
WHERE address->>'external_number' IS NOT NULL
LIMIT 5

UNION ALL

SELECT 
  'NUMBER EXTRACTION SAMPLE' as sample_type,
  'leads' as table_name,
  id,
  name,
  address->>'street' as street,
  address->>'external_number' as external_number,
  address->>'internal_number' as internal_number
FROM leads 
WHERE address->>'external_number' IS NOT NULL
LIMIT 5;

