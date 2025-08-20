-- SCRIPT SIMPLE: Arreglar estructura de direcciones
-- 1. Aplanar { "full_address": { ... } } → { ... }
-- 2. Convertir address1 → street  
-- 3. Agregar external_number, internal_number
-- Ejecutar en Supabase SQL Editor

-- Bypass RLS para migration
SET session_replication_role = replica;

-- =====================================================
-- ARREGLAR LEADS
-- =====================================================

UPDATE leads 
SET address = CASE 
  -- Caso 1: Estructura anidada { "full_address": { ... } }
  WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN
    (address->'full_address') - 'address1' || jsonb_build_object(
      'street', (address->'full_address')->>'address1',
      'external_number', NULL,
      'internal_number', NULL
    )
  
  -- Caso 2: Tiene address1 en raíz
  WHEN address ? 'address1' THEN
    address - 'address1' || jsonb_build_object(
      'street', address->>'address1',
      'external_number', NULL,
      'internal_number', NULL
    )
  
  -- Caso 3: Le faltan los nuevos campos
  WHEN address IS NOT NULL AND NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number') THEN
    address || jsonb_build_object(
      'street', NULL,
      'external_number', NULL,
      'internal_number', NULL
    )
  
  -- Ya está bien
  ELSE address
END,
updated_at = NOW()
WHERE 
  (address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object')
  OR (address ? 'address1')
  OR NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number');

-- =====================================================
-- ARREGLAR COMPANIES
-- =====================================================

UPDATE companies 
SET address = CASE 
  -- Caso 1: Estructura anidada { "full_address": { ... } }
  WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN
    (address->'full_address') - 'address1' || jsonb_build_object(
      'street', (address->'full_address')->>'address1',
      'external_number', NULL,
      'internal_number', NULL
    )
  
  -- Caso 2: Tiene address1 en raíz
  WHEN address ? 'address1' THEN
    address - 'address1' || jsonb_build_object(
      'street', address->>'address1',
      'external_number', NULL,
      'internal_number', NULL
    )
  
  -- Caso 3: Le faltan los nuevos campos
  WHEN address IS NOT NULL AND NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number') THEN
    address || jsonb_build_object(
      'street', NULL,
      'external_number', NULL,
      'internal_number', NULL
    )
  
  -- Ya está bien
  ELSE address
END,
updated_at = NOW()
WHERE 
  (address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object')
  OR (address ? 'address1')
  OR NOT (address ? 'street' AND address ? 'external_number' AND address ? 'internal_number');

-- =====================================================
-- VERIFICAR RESULTADOS
-- =====================================================

-- Contar registros arreglados
SELECT 
  'LEADS' as tabla,
  COUNT(*) as total,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as con_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as con_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as con_internal_number,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as con_address1_viejo,
  COUNT(CASE WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN 1 END) as anidados_pendientes
FROM leads

UNION ALL

SELECT 
  'COMPANIES' as tabla,
  COUNT(*) as total,
  COUNT(CASE WHEN address ? 'street' THEN 1 END) as con_street,
  COUNT(CASE WHEN address ? 'external_number' THEN 1 END) as con_external_number,
  COUNT(CASE WHEN address ? 'internal_number' THEN 1 END) as con_internal_number,
  COUNT(CASE WHEN address ? 'address1' THEN 1 END) as con_address1_viejo,
  COUNT(CASE WHEN address ? 'full_address' AND jsonb_typeof(address->'full_address') = 'object' THEN 1 END) as anidados_pendientes
FROM companies;

-- Mostrar ejemplos arreglados
SELECT 'EJEMPLO LEADS' as tipo, name, address FROM leads WHERE address ? 'street' LIMIT 2;

SELECT 'EJEMPLO COMPANIES' as tipo, name, address FROM companies WHERE address ? 'street' LIMIT 2;

-- Restaurar configuración normal
SET session_replication_role = DEFAULT;
