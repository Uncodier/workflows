# Resumen de Correcciones: IDs Reales de Temporal en cron_status

## Problema Identificado

La tabla `cron_status` estaba guardando IDs generados localmente en lugar de capturar los IDs reales devueltos por Temporal cuando se creaban schedules y workflows. Esto causaba inconsistencias entre lo que se almacenaba en la base de datos y los IDs reales en Temporal.

## Análisis Realizado

1. **Investigación de API de Temporal**: Confirmé que `scheduleClient.create()` devuelve un `Promise<ScheduleHandle>` que contiene el ID real del schedule.
2. **Investigación de workflows**: Confirmé que `client.workflow.start()` devuelve un `Promise<WorkflowHandle>` que contiene el ID real del workflow.
3. **Identificación de problemas**: Encontré múltiples lugares donde se usaban IDs generados localmente como `email-sync-${siteId}` o `sync-emails-${siteId}-${timestamp}`.

## Cambios Implementados

### 1. Correcciones en `workflowSchedulingActivities.ts`

#### a) `createRecurringEmailSyncScheduleActivity`
- **Antes**: Usaba `scheduleId` generado localmente
- **Después**: Captura `scheduleHandle.scheduleId` real de Temporal
- **Líneas modificadas**: 303-343

```typescript
// ANTES
await scheduleClient.create({...});
const cronUpdate = {
  scheduleId, // ID local generado
  workflowId: `${scheduleId}-recurring`, // ID local generado
};

// DESPUÉS  
const scheduleHandle = await scheduleClient.create({...});
const actualScheduleId = scheduleHandle.scheduleId;
const cronUpdate = {
  scheduleId: actualScheduleId, // ID real de Temporal
  workflowId: `${actualScheduleId}-recurring`, // Basado en ID real
};
```

#### b) `scheduleDailyOperationsWorkflowActivity`
- **Antes**: Usaba `scheduleId` generado localmente
- **Después**: Captura `scheduleHandle.scheduleId` real de Temporal  
- **Líneas modificadas**: 1085-1135

#### c) `scheduleIndividualDailyStandUpsActivity`
- **Antes**: Usaba `dateSpecificId` generado localmente para workflow
- **Después**: Captura `workflowHandle.workflowId` real de Temporal
- **Líneas modificadas**: 1325-1393

#### d) `scheduleIndividualLeadGenerationActivity`
- **Antes**: Usaba `workflowId` generado localmente
- **Después**: Captura `leadGenHandle.workflowId` real de Temporal
- **Líneas modificadas**: 1916-1958

### 2. Funciones ya correctas identificadas

Las siguientes funciones ya estaban capturando correctamente los IDs reales:
- `scheduleEmailSyncWorkflowActivity` (línea 83-97)
- `executeDailyProspectionWorkflow` (línea 2365-2393)
- `startLeadAttentionWorkflowActivity` en `leadActivities.ts`
- `startLeadFollowUpWorkflowActivity` en `leadActivities.ts`

### 3. Script de prueba creado

Creé `/src/scripts/test-temporal-id-fixes.ts` que:
- Crea un schedule de prueba y verifica que se capture el ID real
- Inicia un workflow de prueba y verifica que se capture el ID real
- Verifica que los registros en `cron_status` contengan los IDs reales
- Limpia los recursos de prueba

## Archivos Modificados

1. **src/temporal/activities/workflowSchedulingActivities.ts** - Principales correcciones
2. **src/scripts/test-temporal-id-fixes.ts** - Script de prueba (nuevo)
3. **TEMPORAL_ID_FIXES_SUMMARY.md** - Este resumen (nuevo)

## Beneficios de los Cambios

1. **Consistencia**: Los IDs en `cron_status` ahora coinciden con los IDs reales en Temporal
2. **Trazabilidad**: Es posible hacer queries directas en Temporal usando los IDs almacenados
3. **Debugging mejorado**: Los logs muestran tanto IDs generados como IDs reales de Temporal
4. **Mantenimiento**: Facilita la identificación y gestión de schedules/workflows

## Verificación de Cambios

Para verificar que los cambios funcionan correctamente:

```bash
npm run ts-node src/scripts/test-temporal-id-fixes.ts
```

Este script verificará que:
- Los schedules creados devuelvan IDs reales que se capturen correctamente
- Los workflows iniciados devuelvan IDs reales que se capturen correctamente  
- Los registros en `cron_status` contengan los IDs reales de Temporal

## Compatibilidad

Los cambios son completamente compatibles con el código existente ya que:
- No se modificaron interfaces públicas
- Solo se cambió la lógica interna de captura de IDs
- Las funciones siguen devolviendo la misma estructura de datos
- Se mantuvieron logs adicionales para mayor transparencia

## Próximos Pasos Recomendados

1. Ejecutar el script de prueba para verificar el funcionamiento
2. Monitorear los logs en producción para confirmar que se capturan IDs reales
3. Considerar agregar validación adicional en `saveCronStatusActivity` para asegurar que se usen IDs de Temporal válidos