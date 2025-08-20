-- Migration script to fix address structure ONLY in leads table
-- This script converts old { full_address: "..." } format to complete address structure
-- Run this in Supabase SQL Editor

-- =====================================================
-- LEADS TABLE MIGRATION ONLY
-- =====================================================

-- Optional: Check current state before migration
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

-- Update leads with old { full_address: "..." } structure or incomplete structure
UPDATE leads 
SET address = CASE 
  -- If address only has full_address field, expand it to complete structure
  WHEN address ? 'full_address' AND NOT (address ? 'city' AND address ? 'state') THEN
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
  -- If address is just a string (shouldn't happen but just in case)
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
  -- Otherwise keep existing structure (already complete)
  ELSE address
END,
updated_at = NOW()
WHERE 
  address IS NOT NULL 
  AND (
    -- Has only full_address but missing other fields
    (address ? 'full_address' AND NOT (address ? 'street'))
    OR 
    -- Has old address1 field that needs migration
    (address ? 'address1')
    OR
    -- Missing new required fields (street, external_number, internal_number)
    (address IS NOT NULL AND address != '{}'::jsonb AND NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number'))
    OR
    -- Is empty object
    address = '{}'::jsonb
    OR
    -- Is string type (edge case)
    jsonb_typeof(address) = 'string'
  );

-- =====================================================
-- VERIFICATION - Check migration results
-- =====================================================

-- Summary of leads migration
SELECT 
  'LEADS MIGRATION RESULTS' as status,
  COUNT(*) as total_leads,
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
FROM leads;

-- Show sample of migrated addresses
SELECT 
  'SAMPLE MIGRATED ADDRESSES' as sample_type,
  id, 
  name, 
  address
FROM leads 
WHERE address IS NOT NULL AND address != '{}'::jsonb
ORDER BY updated_at DESC
LIMIT 5;

-- Check for any remaining problematic addresses
SELECT 
  'PROBLEMATIC ADDRESSES' as check_type,
  COUNT(*) as count
FROM leads 
WHERE address IS NOT NULL 
  AND address != '{}'::jsonb
  AND NOT (address ? 'full_address' AND address ? 'street');

-- Check for old address1 fields that might still exist
SELECT 
  'OLD ADDRESS1 FIELDS' as check_type,
  COUNT(*) as count
FROM leads 
WHERE address ? 'address1';

-- If the above queries return > 0, you can see the problematic records with:
-- SELECT id, name, address FROM leads 
-- WHERE address IS NOT NULL 
--   AND address != '{}'::jsonb
--   AND NOT (address ? 'full_address' AND address ? 'street')
-- LIMIT 10;
