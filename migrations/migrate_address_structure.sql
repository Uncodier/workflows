-- Migration script to fix address structure in leads and companies tables
-- This script converts old { full_address: "..." } format to complete address structure
-- Run this in Supabase SQL Editor

-- =====================================================
-- PART 1: Migrate LEADS table addresses
-- =====================================================

-- First, let's see what we have (optional check)
-- SELECT 
--   id, 
--   name, 
--   address,
--   jsonb_typeof(address) as address_type,
--   address ? 'full_address' as has_full_address,
--   address ? 'city' as has_city,
--   address ? 'state' as has_state
-- FROM leads 
-- WHERE address IS NOT NULL AND address != '{}'::jsonb
-- LIMIT 10;

-- Update leads with old { full_address: "..." } structure
UPDATE leads 
SET address = CASE 
  -- If address only has full_address field, expand it to complete structure
  WHEN address ? 'full_address' AND NOT (address ? 'city' AND address ? 'state') THEN
    jsonb_build_object(
      'full_address', address->>'full_address',
      'address1', address->>'full_address',
      'city', NULL,
      'state', NULL,
      'zip', NULL,
      'country', NULL,
      'coordinates', NULL
    )
  -- If address is just a string (shouldn't happen but just in case)
  WHEN jsonb_typeof(address) = 'string' THEN
    jsonb_build_object(
      'full_address', address#>>'{}'::text[],
      'address1', address#>>'{}'::text[],
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
      'address1', NULL,
      'city', NULL,
      'state', NULL,
      'zip', NULL,
      'country', NULL,
      'coordinates', NULL
    )
  -- Otherwise keep existing structure (already complete)
  ELSE address
END,
updated_at = NOW()
WHERE 
  address IS NOT NULL 
  AND (
    -- Has only full_address but missing other fields
    (address ? 'full_address' AND NOT (address ? 'city' AND address ? 'state'))
    OR 
    -- Is empty object
    address = '{}'::jsonb
    OR
    -- Is string type (edge case)
    jsonb_typeof(address) = 'string'
  );

-- =====================================================
-- PART 2: Migrate COMPANIES table addresses  
-- =====================================================

-- First, let's see what we have in companies (optional check)
-- SELECT 
--   id, 
--   name, 
--   address,
--   jsonb_typeof(address) as address_type,
--   address ? 'full_address' as has_full_address,
--   address ? 'city' as has_city,
--   address ? 'state' as has_state
-- FROM companies 
-- WHERE address IS NOT NULL AND address != '{}'::jsonb
-- LIMIT 10;

-- Update companies with incomplete address structure
UPDATE companies 
SET address = CASE 
  -- If address only has full_address field, expand it to complete structure
  WHEN address ? 'full_address' AND NOT (address ? 'city' AND address ? 'state') THEN
    jsonb_build_object(
      'full_address', address->>'full_address',
      'address1', address->>'full_address',
      'city', address->>'city', -- Keep existing city if present
      'state', address->>'state', -- Keep existing state if present
      'zip', address->>'zip', -- Keep existing zip if present
      'country', address->>'country', -- Keep existing country if present
      'coordinates', CASE 
        WHEN address ? 'coordinates' THEN address->'coordinates'
        ELSE NULL
      END
    )
  -- If address has street/city/state but no full_address, build it
  WHEN (address ? 'street' OR address ? 'city' OR address ? 'state') AND NOT (address ? 'full_address') THEN
    jsonb_build_object(
      'full_address', CONCAT_WS(', ', 
        address->>'street',
        address->>'city', 
        address->>'state',
        address->>'zipcode',
        address->>'country'
      ),
      'address1', address->>'street',
      'city', address->>'city',
      'state', address->>'state',
      'zip', COALESCE(address->>'zip', address->>'zipcode'),
      'country', address->>'country',
      'coordinates', CASE 
        WHEN address ? 'coordinates' THEN address->'coordinates'
        ELSE NULL
      END
    )
  -- If address is just a string (shouldn't happen but just in case)
  WHEN jsonb_typeof(address) = 'string' THEN
    jsonb_build_object(
      'full_address', address#>>'{}'::text[],
      'address1', address#>>'{}'::text[],
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
      'address1', NULL,
      'city', NULL,
      'state', NULL,
      'zip', NULL,
      'country', NULL,
      'coordinates', NULL
    )
  -- Otherwise keep existing structure (already complete)
  ELSE address
END,
updated_at = NOW()
WHERE 
  address IS NOT NULL 
  AND (
    -- Has only full_address but missing other standard fields
    (address ? 'full_address' AND NOT (address ? 'city' AND address ? 'state'))
    OR
    -- Has old structure (street/city/state) but no full_address
    ((address ? 'street' OR address ? 'city' OR address ? 'state') AND NOT (address ? 'full_address'))
    OR 
    -- Is empty object
    address = '{}'::jsonb
    OR
    -- Is string type (edge case)
    jsonb_typeof(address) = 'string'
  );

-- =====================================================
-- PART 3: Verification queries (run these to check results)
-- =====================================================

-- Check leads migration results
SELECT 
  'leads' as table_name,
  COUNT(*) as total_records,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates,
  COUNT(CASE WHEN address = '{}'::jsonb OR address IS NULL THEN 1 END) as empty_addresses
FROM leads;

-- Check companies migration results  
SELECT 
  'companies' as table_name,
  COUNT(*) as total_records,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates,
  COUNT(CASE WHEN address = '{}'::jsonb OR address IS NULL THEN 1 END) as empty_addresses
FROM companies;

-- Sample of migrated leads addresses (optional)
-- SELECT 
--   id, 
--   name, 
--   address
-- FROM leads 
-- WHERE address IS NOT NULL AND address != '{}'::jsonb
-- ORDER BY updated_at DESC
-- LIMIT 5;

-- Sample of migrated companies addresses (optional)
-- SELECT 
--   id, 
--   name, 
--   address
-- FROM companies 
-- WHERE address IS NOT NULL AND address != '{}'::jsonb
-- ORDER BY updated_at DESC
-- LIMIT 5;

-- =====================================================
-- PART 4: Clean up any malformed JSON (if needed)
-- =====================================================

-- This will fix any records where address might be malformed
-- Uncomment if you encounter JSON parsing issues:

/*
UPDATE leads 
SET address = '{
  "full_address": null,
  "address1": null,
  "city": null,
  "state": null,
  "zip": null,
  "country": null,
  "coordinates": null
}'::jsonb
WHERE address IS NOT NULL 
  AND NOT jsonb_typeof(address) = 'object';

UPDATE companies 
SET address = '{
  "full_address": null,
  "address1": null,
  "city": null,
  "state": null,
  "zip": null,
  "country": null,
  "coordinates": null
}'::jsonb
WHERE address IS NOT NULL 
  AND NOT jsonb_typeof(address) = 'object';
*/
