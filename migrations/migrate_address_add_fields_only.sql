-- Migration script to ADD ONLY the missing address fields
-- Adds: street, external_number, internal_number
-- Removes: address1 (if exists)
-- KEEPS all existing fields unchanged (zip, city, state, country, coordinates, full_address)
-- Run this in Supabase SQL Editor

-- =====================================================
-- PART 1: MIGRATE LEADS TABLE
-- =====================================================

-- Add missing fields to leads addresses and flatten nested structure
UPDATE leads 
SET address = CASE 
  -- If address has nested full_address object, flatten it
  WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN
    -- Extract all fields from nested full_address object to root level
    (address->'full_address') 
    -- Remove address1 if it exists in nested structure
    - 'address1'
    -- Add new required fields
    || jsonb_build_object(
      'street', CASE
        -- Use address1 from nested structure as street if it exists
        WHEN (address->'full_address') ? 'address1' THEN (address->'full_address')->>'address1'
        -- Otherwise set to null
        ELSE NULL
      END,
      'external_number', NULL,
      'internal_number', NULL
    )
  -- If address exists at root level and needs new fields
  WHEN address IS NOT NULL AND address != '{}'::jsonb THEN
    -- Keep all existing fields and add new ones
    address 
    -- Remove address1 if it exists
    - 'address1'
    -- Add new required fields
    || jsonb_build_object(
      'street', CASE
        -- Use address1 as street if it exists
        WHEN address ? 'address1' THEN address->>'address1'
        -- Otherwise set to null (will be populated by parsing logic)
        ELSE NULL
      END,
      'external_number', NULL,
      'internal_number', NULL
    )
  -- If address is empty, create minimal structure
  ELSE jsonb_build_object(
    'street', NULL,
    'external_number', NULL,
    'internal_number', NULL
  )
END,
updated_at = NOW()
WHERE 
  -- Update records that have nested full_address structure
  (address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object')
  OR
  -- Update records that don't have the new fields or have address1
  (address ? 'address1') 
  OR NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number')
  OR address IS NULL;

-- =====================================================
-- PART 2: MIGRATE COMPANIES TABLE  
-- =====================================================

-- Add missing fields to companies addresses
UPDATE companies 
SET address = CASE 
  -- If address exists and needs new fields
  WHEN address IS NOT NULL AND address != '{}'::jsonb THEN
    -- Keep all existing fields and add new ones
    address 
    -- Remove address1 if it exists
    - 'address1'
    -- Add new required fields
    || jsonb_build_object(
      'street', CASE
        -- Use address1 as street if it exists
        WHEN address ? 'address1' THEN address->>'address1'
        -- Otherwise set to null (will be populated by parsing logic)
        ELSE NULL
      END,
      'external_number', NULL,
      'internal_number', NULL
    )
  -- If address is empty, create minimal structure
  ELSE jsonb_build_object(
    'street', NULL,
    'external_number', NULL,
    'internal_number', NULL
  )
END,
updated_at = NOW()
WHERE 
  -- Update records that don't have the new fields or have address1
  (address ? 'address1') 
  OR NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number')
  OR address IS NULL;

-- =====================================================
-- VERIFICATION - Check migration results
-- =====================================================

-- Summary of leads migration
SELECT 
  'LEADS MIGRATION RESULTS' as table_name,
  COUNT(*) as total_records,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as has_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as has_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as has_internal_number,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as still_has_address1,
  COUNT(CASE WHEN address ? 'zip' THEN 1 END) as has_zip,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'country' THEN 1 END) as has_country,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address
FROM leads

UNION ALL

-- Summary of companies migration
SELECT 
  'COMPANIES MIGRATION RESULTS' as table_name,
  COUNT(*) as total_records,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as has_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as has_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as has_internal_number,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as still_has_address1,
  COUNT(CASE WHEN address ? 'zip' THEN 1 END) as has_zip,
  COUNT(CASE WHEN address ? 'city' THEN 1 END) as has_city,
  COUNT(CASE WHEN address ? 'state' THEN 1 END) as has_state,
  COUNT(CASE WHEN address ? 'country' THEN 1 END) as has_country,
  COUNT(CASE WHEN address ? 'coordinates' THEN 1 END) as has_coordinates,
  COUNT(CASE WHEN address ? 'full_address' THEN 1 END) as has_full_address
FROM companies;

-- Sample of migrated addresses
SELECT 
  'SAMPLE LEADS ADDRESSES' as sample_type,
  id, 
  name, 
  address
FROM leads 
WHERE address IS NOT NULL AND address != '{}'::jsonb
ORDER BY updated_at DESC
LIMIT 3

UNION ALL

SELECT 
  'SAMPLE COMPANIES ADDRESSES' as sample_type,
  id, 
  name, 
  address
FROM companies 
WHERE address IS NOT NULL AND address != '{}'::jsonb
ORDER BY updated_at DESC
LIMIT 3;

-- Verify no address1 fields remain and no nested structures
SELECT 
  'CLEANUP VERIFICATION' as check_type,
  'leads' as table_name,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as records_with_address1,
  COUNT(CASE WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN 1 END) as nested_full_address_objects
FROM leads 

UNION ALL

SELECT 
  'CLEANUP VERIFICATION' as check_type,
  'companies' as table_name,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as records_with_address1,
  COUNT(CASE WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN 1 END) as nested_full_address_objects
FROM companies;

-- Show any remaining problematic nested structures (should be 0 after migration)
SELECT 
  'REMAINING NESTED STRUCTURES' as issue_type,
  id,
  name,
  address
FROM leads 
WHERE address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object'
LIMIT 5;
