# Business Hours Filtering Fix

## Problema Identificado

El sistema ejecutaba `dailyStandUpWorkflow` para **todos los sitios** cuando solo algunos tenían horas de trabajo activas:

1. **`activityPrioritizationEngineWorkflow`** evaluaba correctamente las business hours
2. **PERO** `dailyOperationsWorkflow` ignoraba esta información 
3. **`executeDailyStandUpWorkflowsActivity`** ejecutaba workflows para TODOS los sitios
4. **Además** los workflows se marcaban como ejecución "inmediata" en lugar de respetar horarios

### Ejemplo del Problema

```
businessHoursAnalysis: {
  "sitesWithBusinessHours": 5,
  "sitesOpenToday": 1,  // ← Solo 1 sitio debería ejecutarse
  "shouldExecuteOperations": true,
  "reason": "1 site(s) have business hours on sunday"
}

Pero ejecutaba:
"dailyStandUpsExecuted": 5  // ← Ejecutó para TODOS los sitios
```

## Solución Implementada

### 1. Flujo de Información de Business Hours

**Antes:**
```
activityPrioritizationEngineWorkflow
  ↓ (información perdida)
dailyOperationsWorkflow  
  ↓ (ejecuta para todos)
executeDailyStandUpWorkflowsActivity
```

**Después:**
```
activityPrioritizationEngineWorkflow
  ↓ (pasa businessHoursAnalysis)
dailyOperationsWorkflow
  ↓ (filtra sitios)
executeDailyStandUpWorkflowsActivity
```

### 2. Cambios en `activityPrioritizationEngineWorkflow.ts`

```typescript
// ANTES
operationsResult = await executeChild('dailyOperationsWorkflow', {
  workflowId: `daily-operations-${Date.now()}`,
});

// DESPUÉS  
operationsResult = await executeChild('dailyOperationsWorkflow', {
  workflowId: `daily-operations-${Date.now()}`,
  args: [{ businessHoursAnalysis }], // ← Pasa la información
});
```

### 3. Cambios en `dailyOperationsWorkflow.ts`

```typescript
// ANTES
export async function dailyOperationsWorkflow(): Promise<{...}>

// DESPUÉS
export async function dailyOperationsWorkflow(
  options: { businessHoursAnalysis?: any } = {}
): Promise<{...}>

// Pasa la información a la actividad
dailyStandUpResult = await executeDailyStandUp({
  dryRun: false,
  testMode: false,
  businessHoursAnalysis, // ← Información de filtrado
});
```

### 4. Cambios en `workflowSchedulingActivities.ts`

#### Filtrado de Sitios
```typescript
// ANTES: Obtenía TODOS los sitios
let sites = await supabaseService.fetchSites();

// DESPUÉS: Filtra según business hours
if (businessHoursAnalysis && businessHoursAnalysis.openSites.length > 0) {
  // FILTERED MODE: Solo sitios con horas activas
  const allSites = await supabaseService.fetchSites();
  const openSiteIds = businessHoursAnalysis.openSites.map(site => site.siteId);
  sitesToProcess = allSites.filter(site => openSiteIds.includes(site.id));
} else {
  // FALLBACK MODE: Todos los sitios (legacy)
  sitesToProcess = await supabaseService.fetchSites();
}
```

#### Modo de Ejecución
```typescript
// ANTES: Siempre inmediato
additionalData: {
  executeReason: 'immediate-execution',
  scheduleType: 'immediate',
  scheduleTime: 'immediate',
  executionMode: 'direct'
}

// DESPUÉS: Respeta business hours
const hasBusinessHours = businessHoursAnalysis && businessHoursAnalysis.openSites.length > 0;
const executeReason = hasBusinessHours ? 'business-hours-scheduled' : 'fallback-execution';
const scheduleType = hasBusinessHours ? 'business-hours' : 'immediate';

additionalData: {
  executeReason,
  scheduleType,
  scheduleTime: scheduleType === 'business-hours' ? 'business-hours-based' : 'immediate',
  executionMode: scheduleType === 'business-hours' ? 'scheduled' : 'direct',
  businessHoursAnalysis
}
```

## Validación

### Test Exitoso
```bash
🧪 Testing Business Hours Filtering Fix
📅 Testing for: Saturday (day 6)

📊 Business Hours Analysis Result:
   - Should execute operations: true
   - Reason: 1 site(s) have business hours on saturday  
   - Sites with business_hours: 5
   - Sites open today: 1

📊 DRY RUN Results:
   - Sites that would be executed: 1  ← ✅ Correcto
   - Business hours filtering: ENABLED
   - Total sites found: 1

✅ VALIDATION PASSED: Correct number of sites would be executed
   Expected: 1 sites with active business hours
   Actual: 1 sites would be executed

🔧 Fix Status: ✅ WORKING
```

## Resultado

**Antes del Fix:**
- ❌ Ejecutaba para todos los sitios (5)
- ❌ Modo "immediate-execution" 
- ❌ Ignoraba business hours

**Después del Fix:**
- ✅ Ejecuta solo para sitios con horas activas (1)
- ✅ Modo "business-hours-scheduled"
- ✅ Respeta business hours analysis

## Compatibilidad

- **✅ Backward Compatible**: Sin `businessHoursAnalysis` funciona como antes
- **✅ Fallback Mode**: Si no hay business hours, ejecuta para todos los sitios  
- **✅ No Breaking Changes**: Todos los workflows existentes siguen funcionando

## Archivos Modificados

1. `src/temporal/workflows/activityPrioritizationEngineWorkflow.ts`
2. `src/temporal/workflows/dailyOperationsWorkflow.ts` 
3. `src/temporal/activities/workflowSchedulingActivities.ts`
4. `src/scripts/test-business-hours-filtering.ts` (nuevo test) 