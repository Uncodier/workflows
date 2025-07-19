# Business Hours Scheduling Fix

## Problema Identificado

El sistema estaba programando **16 sitios** para ejecutar actividades los sábados, cuando solo **2 sitios** tenían `business_hours` configurados para abrir los sábados.

### Datos del Problema:
- `sitesWithBusinessHours`: 11 (sitios con configuración de business_hours)
- `sitesOpenToday`: 2 (sitios abiertos los sábados)
- `individualSchedules`: 16 (sitios programados - **INCORRECTO**)

### Causa Raíz

Las funciones de programación individual estaban usando un **fallback indiscriminado** para sitios sin `business_hours`, incluso los fines de semana:

```typescript
// LÓGICA INCORRECTA (ANTES)
if (businessHours) {
  // Site HAS business_hours - use them
  scheduledTime = businessHours.open;
  siteTimezone = businessHours.timezone || timezone;
  businessHoursSource = 'database-configured';
} else {
  // Site DOES NOT have business_hours - use fallback ❌ PROBLEMA EN FINES DE SEMANA
  scheduledTime = "09:00"; // Default fallback time
  siteTimezone = timezone; // Default timezone
  businessHoursSource = 'fallback-default';
}
```

Esto causaba que sitios sin configuración de business_hours para sábado se programaran de todos modos a las 09:00, enviando mensajes en días no laborales.

## Solución Implementada

### Cambios Realizados

1. **Fallback Condicional por Día**: Los sitios sin `business_hours` ahora usan fallback solo en días laborables (Domingo-Jueves) y se omiten los fines de semana (Viernes-Sábado).

2. **Modificación en `scheduleIndividualDailyStandUpsActivity`**:
```typescript
// LÓGICA CORREGIDA (DESPUÉS)
const currentDay = new Date().getDay(); // 0=Sunday, 1=Monday, etc.
const isWeekend = currentDay === 5 || currentDay === 6; // Friday = 5, Saturday = 6
const businessHours = sitesWithBusinessHours.get(site.id);

if (businessHours) {
  // Site HAS business_hours - use them
  scheduledTime = businessHours.open;
  siteTimezone = businessHours.timezone || timezone;
  businessHoursSource = 'database-configured';
} else if (!isWeekend) {
  // Site DOES NOT have business_hours - use fallback ONLY on weekdays
  scheduledTime = "09:00";
  siteTimezone = timezone;
  businessHoursSource = 'fallback-weekday';
} else {
  // Weekend: NO fallback for sites without business_hours
  console.log(`   ⏭️ SKIPPING - No business_hours configured and weekend (no fallback)`);
  continue;
}
```

3. **Modificación en `scheduleIndividualSiteAnalysisActivity`**:
   - Verifica `business_hours` ANTES de verificar si necesita análisis
   - Omite sitios sin `business_hours` configurados

4. **Modificación en `scheduleIndividualLeadGenerationActivity`**:
   - Misma lógica: solo procesa sitios con `business_hours` configurados

### Archivos Modificados

- `src/temporal/activities/workflowSchedulingActivities.ts`
- `src/temporal/workflows/activityPrioritizationEngineWorkflow.ts` (documentación)

### Funciones Afectadas

- `scheduleIndividualDailyStandUpsActivity`
- `scheduleIndividualSiteAnalysisActivity`
- `scheduleIndividualLeadGenerationActivity`

## Resultado Esperado

### Antes del Fix:
- ✅ 2 sitios con business_hours para sábado
- ❌ **16 sitios programados** (incluyendo 14 sitios sin business_hours usando fallback indiscriminado)

### Después del Fix:
- ✅ 2 sitios con business_hours para sábado
- ✅ **2 sitios programados** (solo los que tienen business_hours configurados)
- ⏭️ 14 sitios omitidos correctamente (fallback bloqueado en fin de semana)

### En Días Laborables (Domingo-Jueves):
- ✅ Sitios con business_hours: Se programan según sus horarios
- ✅ Sitios sin business_hours: Se programan con fallback a las 09:00
- ➡️ **Comportamiento preservado** para días laborables

## Impacto

### Positivo:
1. **Respeto Real de Business Hours**: Solo se ejecutan operaciones para sitios que realmente operan en el día específico
2. **Prevención de Spam**: No se envían mensajes a clientes fuera de sus horarios de negocio
3. **Precisión en Scheduling**: Los números de sitios programados ahora reflejan la realidad
4. **Mejor Logging**: Logs más claros que muestran qué sitios se omiten y por qué

### Consideraciones:
1. **Fallback Condicional**: Los sitios sin `business_hours` solo se ejecutan en días laborables (Dom-Jue)
2. **Restricción de Fin de Semana**: Los sitios sin `business_hours` NO se ejecutarán los viernes y sábados
3. **Compatibilidad**: El comportamiento de días laborables se mantiene igual que antes

## Verificación

Creado el script de test `src/scripts/test-business-hours-filtering-fix.ts` para verificar que:
1. Solo sitios con `business_hours` se programan
2. Sitios sin `business_hours` se omiten correctamente
3. Los números de programación coinciden con la realidad

## Documentación Actualizada

- Comentarios de funciones actualizados para reflejar política de fin de semana
- Nuevas referencias a "WEEKEND RESTRICTION" y "WEEKDAY FALLBACK"
- Documentación clara de la lógica condicional por día de semana

## Testing

Para probar el fix:
```bash
npx tsx src/scripts/test-business-hours-filtering-fix.ts
```

Este test simula el escenario del sábado y verifica que:
- **Solo 2 sitios** con business_hours se programan (no 16)
- **14 sitios sin business_hours** se omiten en fin de semana
- El fallback funciona correctamente en días laborables 