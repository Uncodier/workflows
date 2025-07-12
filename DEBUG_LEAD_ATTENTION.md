# Lead Attention Workflow - Refactored ✅

## Problema Original Resuelto
El workflow `leadAttentionWorkflow` estaba ejecutando todas las validaciones dentro de una sola actividad, lo que causaba:
1. ❌ Solo 1 actividad visible en Temporal UI
2. ❌ Validaciones invisibles/difíciles de debuggear
3. ❌ Validaciones que se saltaban

## Solución Implementada

### 🔧 Refactorización Completa

**ANTES**: 1 actividad que hacía todo internamente
```
leadAttentionActivity (todo interno)
├── checkExistingLeadNotificationActivity ⚠️ invisible
├── getLeadActivity ⚠️ invisible
└── API call ⚠️ mezclado
```

**DESPUÉS**: 3 actividades separadas y visibles
```
1. checkExistingLeadNotificationActivity ✅ visible
2. getLeadActivity ✅ visible  
3. leadAttentionActivity ✅ visible (solo API call)
```

### 📊 Beneficios de la Refactorización

1. **Visibilidad en Temporal UI**: Ahora ves 3 pasos separados
2. **Mejor Debugging**: Cada validación es una actividad independiente
3. **Logs Organizados**: Prefijos claros para cada fase
4. **Validaciones Garantizadas**: Imposible saltarse pasos

### 🏗️ Nueva Arquitectura

#### Workflow (`leadAttentionWorkflow.ts`)
- **STEP 1**: Llama `checkExistingLeadNotificationActivity`
- **STEP 2**: Llama `getLeadActivity` 
- **STEP 3**: Llama `leadAttentionActivity` (solo API)

#### Activities Separadas
1. `checkExistingLeadNotificationActivity`: Solo verifica duplicados
2. `getLeadActivity`: Solo obtiene info del lead
3. `leadAttentionActivity`: Solo llama al API

### 🔍 Logs Reorganizados

- **DUPLICATE CHECK**: Verificación de notificaciones duplicadas
- **WORKFLOW**: Orchestración del workflow entre pasos
- **API CALL**: Llamada final al API

### 📋 Script de Prueba Actualizado

```bash
node test-lead-attention-activities.js
```

Este script ahora prueba el workflow completo refactorizado y te muestra:
- ✅ Las 3 actividades separadas en Temporal UI
- ✅ Validaciones funcionando correctamente 
- ✅ Logs organizados por fase

## Cómo Debuggear

### Paso 1: Actualizar el Lead ID de Prueba

En ambos scripts, cambia esta línea:
```javascript
const testLeadId = 'test-lead-id-123'; // Replace with actual lead ID
```

Por un lead ID real de tu base de datos.

### Paso 2: Ejecutar el Script de Activities

Primero ejecuta el script de activities para ver exactamente dónde falla:

```bash
node test-lead-attention-activities.js
```

Este script te mostrará:
- ✅ Si la verificación de duplicados funciona
- ✅ Si la verificación de assignee_id funciona
- ✅ Si el flujo completo funciona

### Paso 3: Ejecutar el Script de Workflow

Después ejecuta el script de workflow:

```bash
node test-lead-attention-debug.js
```

### Paso 4: Revisar los Logs

Busca estos patrones en los logs:

#### Si las validaciones funcionan correctamente:
```
🔍 DUPLICATE CHECK: Starting check for existing lead attention notification
👤 STEP 2: Getting lead information to check assignee
⏭️ STEP 2 BLOCK: Skipping lead attention notification - lead has no assignee_id
```

#### Si las validaciones se saltan:
```
🔍 DUPLICATE CHECK: Starting check for existing lead attention notification
👤 STEP 2: Getting lead information to check assignee
📤 STEP 3: Sending lead attention request to API...
```

## Flujo de Validación Esperado

```
1. DUPLICATE CHECK
   ├── Verificar conexión a base de datos
   ├── Consultar notificaciones de hoy para este lead
   └── Si existe → SKIP (no enviar)

2. STEP 2: ASSIGNEE CHECK
   ├── Obtener información del lead
   ├── Verificar si tiene assignee_id
   └── Si no tiene → SKIP (no enviar)

3. STEP 3: API CALL
   ├── Enviar notificación al API
   └── Registrar resultado
```

## Posibles Problemas

### 1. Base de Datos No Conectada
```
⚠️ DUPLICATE CHECK: Database not available, proceeding with notification
```
**Solución**: Verificar configuración de Supabase

### 2. Tabla de Notificaciones Vacía
```
✅ DUPLICATE CHECK: NO existing notifications found
```
**Esperado**: Primera vez que se ejecuta

### 3. Lead Sin Assignee
```
⏭️ STEP 2 BLOCK: Skipping lead attention notification - lead has no assignee_id
```
**Esperado**: Lead no tiene asignado

### 4. API Falla
```
❌ STEP 3 FAILED: API call failed
```
**Solución**: Verificar API `/api/notifications/leadAttention`

## Temporal UI

También puedes revisar los logs detallados en la Temporal UI:
1. Ir a `http://localhost:8233` (o tu URL de Temporal)
2. Buscar el workflow por ID
3. Ver los logs detallados de cada actividad

## Estructura de Base de Datos

La tabla `notifications` debe tener esta estructura:
```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  related_entity_id uuid,     -- lead_id va aquí
  related_entity_type text,   -- 'lead' para filtrar
  created_at timestamp,       -- para verificar fecha
  -- ... otros campos
);
```

## Verificación Manual

Para verificar manualmente si hay duplicados:
```sql
SELECT * FROM notifications 
WHERE related_entity_id = 'your-lead-id' 
  AND related_entity_type = 'lead'
  AND created_at >= CURRENT_DATE;
``` 