# Implementación de IDs Reales de Temporal en cron_status

## 📋 Problema Identificado

Después de revisar la implementación actual de `cron_status`, se confirmaron los siguientes problemas:

### a) Workflow IDs Generados Manualmente ❌
Los workflows estaban generando sus propios `workflow_id` usando patrones manuales:
```typescript
const workflowId = `deep-research-${site_id}-${Date.now()}`;
```

**Problema:** Estos IDs no corresponden a los IDs reales asignados por Temporal, lo que hace imposible rastrear los workflows en el sistema Temporal.

### b) Schedule IDs Usando Fallback ❌
Los workflows estaban usando schedule IDs de fallback:
```typescript
const scheduleId = options.additionalData?.scheduleType || `deep-research-${site_id}`;
```

**Problema:** Estos IDs no corresponden a los schedules reales que triggerearon los workflows.

## ✅ Solución Implementada

### 1. Uso de `workflowInfo()` de Temporal
Se implementó el uso de la función nativa `workflowInfo()` para obtener los IDs reales:

```typescript
import { workflowInfo } from '@temporalio/workflow';

// ANTES (INCORRECTO):
const workflowId = `deep-research-${site_id}-${Date.now()}`;

// DESPUÉS (CORRECTO):
const workflowInfo_real = workflowInfo();
const realWorkflowId = workflowInfo_real.workflowId;
```

### 2. Extracción de Schedule ID Real
Se implementó una función helper para extraer el schedule ID real:

```typescript
function extractScheduleId(info: any): string {
  const searchAttributes = info.searchAttributes || {};
  const memo = info.memo || {};
  
  const scheduleId = 
    searchAttributes['TemporalScheduledById'] || 
    searchAttributes['ScheduleId'] ||
    memo['TemporalScheduledById'] ||
    memo['scheduleId'] ||
    memo['scheduleName'];
    
  if (scheduleId) {
    console.log(`✅ Real schedule ID found: ${scheduleId}`);
    return scheduleId;
  }
  
  console.log(`⚠️ No schedule ID found - likely manual execution`);
  return 'manual-execution';
}
```

### 3. Actualización de Actividades cron_status
Todas las llamadas a `saveCronStatusActivity` ahora usan los IDs reales:

```typescript
await saveCronStatusActivity({
  siteId: site_id,
  workflowId: realWorkflowId,     // ✅ ID real de Temporal
  scheduleId: realScheduleId,     // ✅ Schedule ID real o 'manual-execution'
  activityName: 'deepResearchWorkflow',
  status: 'RUNNING'
});
```

## 🔧 Workflows Actualizados

### ✅ Completamente Implementado:
1. **`deepResearchWorkflow.ts`** - Workflow para investigación profunda
2. **`dailyProspectionWorkflow.ts`** - Workflow de prospección diaria

### 📋 Pendientes por Actualizar:
Los siguientes workflows también usan `saveCronStatusActivity` y deberían actualizarse siguiendo el mismo patrón:

- `leadResearchWorkflow.ts`
- `dailyStandUpWorkflow.ts` 
- `leadFollowUpWorkflow.ts`
- `leadGenerationWorkflow.ts`
- `dailyStrategicAccountsWorkflow.ts`
- `buildSegmentsWorkflow.ts`
- `syncEmailsWorkflow.ts`
- `buildSegmentsICPWorkflow.ts`
- `leadInvalidationWorkflow.ts`
- `analyzeSiteWorkflow.ts`

## 🧪 Scripts de Verificación

### `src/scripts/verify-cron-status-ids.ts`
Script para verificar el estado actual de los registros cron_status y detectar problemas.

### `src/scripts/compare-workflow-ids.ts`
Script para comparar registros antes y después de la implementación, mostrando la migración del patrón antiguo al nuevo.

### `src/scripts/test-deep-research-fixed.ts`
Script de prueba para ejecutar un workflow actualizado y verificar que use los IDs reales.

## 📊 Beneficios de la Implementación

### 1. Trazabilidad Completa ✅
- Los `workflow_id` ahora corresponden exactamente a los IDs de Temporal
- Posible correlacionar registros de cron_status con workflows en Temporal UI
- Eliminación de ambigüedad entre IDs manuales y reales

### 2. Schedule Tracking Mejorado ✅
- Identificación precisa de qué schedule triggereó cada workflow
- Diferenciación clara entre ejecuciones automáticas y manuales
- Mejor debugging y monitoreo de schedules

### 3. Consistencia de Datos ✅
- Eliminación de IDs generados manualmente que no coinciden con Temporal
- Datos más confiables para análisis y debugging
- Mejor integración con herramientas de monitoreo de Temporal

## 🔍 Verificación Post-Implementación

Para verificar que la implementación funciona:

1. **Ejecutar un workflow actualizado:**
   ```bash
   npx tsx src/scripts/test-deep-research-fixed.ts
   ```

2. **Verificar los registros resultantes:**
   ```bash
   npx tsx src/scripts/compare-workflow-ids.ts
   ```

3. **Características de los IDs reales:**
   - **Workflow IDs:** Largos, complejos, únicos de Temporal (no siguen nuestro patrón manual)
   - **Schedule IDs:** ID del schedule real o `'manual-execution'` para ejecuciones manuales

## 🚀 Próximos Pasos

1. **Actualizar workflows restantes** siguiendo el mismo patrón implementado
2. **Validar en production** que los schedules reales pasen la información correcta
3. **Considerar refactoring** para centralizar la lógica de obtención de IDs reales
4. **Documentar el patrón** para futuros workflows

---

**Estado:** ✅ Implementación base completada  
**Tested:** ✅ Scripts de verificación funcionales  
**Ready for Production:** ⚠️ Pendiente testing con workflows reales