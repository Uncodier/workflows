# Cron Status Validation - Prevención de Workflows Stuck

## Descripción

La actividad `validateAndCleanStuckCronStatusActivity` es una función general reutilizable que previene que los workflows se bloqueen por registros de `cron_status` que se quedaron en estado "RUNNING" de ejecuciones anteriores fallidas.

## Problema que Resuelve

### Antes ❌
```
Workflow A se ejecuta → Falla inesperadamente → cron_status queda en "RUNNING"
                                                    ↓
Workflow A intenta ejecutarse de nuevo → Detecta estado "RUNNING" → Se bloquea
```

### Después ✅
```
Workflow A intenta ejecutarse → Validación detecta registro stuck → Lo limpia automáticamente → Workflow procede
```

## Funcionalidad

### Validaciones que Realiza

1. **Verificar conexión a BD**: Si no hay conexión, procede optimísticamente
2. **Buscar registro existente**: Para el workflow específico y site ID
3. **Verificar estado**: Si no está en "RUNNING", permite continuar
4. **Calcular tiempo stuck**: Cuánto tiempo lleva en "RUNNING"
5. **Limpiar si necesario**: Si excede el threshold, lo marca como "FAILED"
6. **Decidir si proceder**: Retorna si es seguro ejecutar el workflow

### Parámetros

```typescript
validateAndCleanStuckCronStatusActivity(
  activityName: string,    // Nombre del workflow (ej: 'dailyStandUpWorkflow')
  siteId: string,          // ID del site o 'global' para workflows globales
  hoursThreshold: number   // Horas después de las cuales se considera stuck (default: 24)
)
```

### Retorna

```typescript
{
  wasStuck: boolean;       // Si había un registro stuck
  cleaned: boolean;        // Si se limpió automáticamente
  reason: string;          // Explicación del resultado
  previousStatus?: string; // Estado anterior del registro
  hoursStuck?: number;     // Horas que estuvo stuck
  canProceed: boolean;     // Si es seguro ejecutar el workflow
}
```

## Uso en Workflows

### Patrón Básico (Recomendado)

```typescript
export async function myWorkflow(options: WorkflowOptions) {
  const { site_id } = options;

  // 🔍 PASO 1: Validar cron status antes de ejecutar
  const cronValidation = await validateAndCleanStuckCronStatusActivity(
    'myWorkflow',
    site_id,
    24 // 24 horas threshold
  );

  if (!cronValidation.canProceed) {
    return {
      executed: false,
      reason: `Workflow blocked: ${cronValidation.reason}`
    };
  }

  // 🚀 PASO 2: Marcar como RUNNING y ejecutar
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId: `my-workflow-${site_id}`,
    activityName: 'myWorkflow',
    status: 'RUNNING'
  });

  try {
    // ... lógica del workflow ...

    // 🎯 PASO 3: Marcar como COMPLETED
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId: `my-workflow-${site_id}`,
      activityName: 'myWorkflow',
      status: 'COMPLETED'
    });

  } catch (error) {
    // 💥 PASO 4: Marcar como FAILED en caso de error
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId: `my-workflow-${site_id}`,
      activityName: 'myWorkflow',
      status: 'FAILED',
      errorMessage: error.message
    });
    throw error;
  }
}
```

### Configuración en Workflows

```typescript
// 1. Agregar al proxy de activities
const { 
  validateAndCleanStuckCronStatusActivity,
  saveCronStatusActivity,
  // ... otras activities
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
});

// 2. Usar al inicio del workflow
const cronValidation = await validateAndCleanStuckCronStatusActivity(
  'workflowName',
  site_id,
  hoursThreshold
);
```

## Thresholds Recomendados

| Tipo de Workflow | Threshold | Justificación |
|------------------|-----------|---------------|
| **Email Sync** | 6-12 horas | Procesos rápidos, no deberían tardar más |
| **Daily Standups** | 24 horas | Se ejecutan diariamente, 24h es razonable |
| **Lead Generation** | 24 horas | Procesos complejos pero diarios |
| **System Maintenance** | 48+ horas | Pueden ser procesos largos |
| **Deep Research** | 48+ horas | Análisis extensivos permitidos |

## Site ID Guidelines

| Escenario | Site ID | Ejemplo |
|-----------|---------|---------|
| **Workflow específico de site** | `site.id` real | `'550e8400-e29b-41d4-a716-446655440000'` |
| **Workflow global/sistema** | `'global'` | `'global'` |
| **Workflow de usuario** | `user.id` | `'user-123'` |

## Ejemplos de Integración

### Daily Standup Workflow

```typescript
// ✅ Implementado en src/temporal/workflows/dailyStandUpWorkflow.ts
const cronValidation = await validateAndCleanStuckCronStatusActivity(
  'dailyStandUpWorkflow',
  site_id,
  24 // 24 horas
);
```

### Activity Prioritization Engine

```typescript
// ✅ Implementado en src/temporal/workflows/activityPrioritizationEngineWorkflow.ts
const cronValidation = await validateAndCleanStuckCronStatusActivity(
  'activityPrioritizationEngineWorkflow',
  'global', // Workflow global
  24
);
```

### Email Sync (Ejemplo)

```typescript
const cronValidation = await validateAndCleanStuckCronStatusActivity(
  'syncEmailsWorkflow',
  site_id,
  12 // 12 horas - proceso más rápido
);
```

## Testing

### Script de Pruebas

```bash
# Ejecutar tests completos
npm run ts-node src/scripts/test-cron-status-validation.ts

# Ver ejemplos de uso
npm run ts-node src/scripts/test-cron-status-validation.ts --examples

# Ayuda
npm run ts-node src/scripts/test-cron-status-validation.ts --help
```

### Tests que Realiza

1. **Workflow no existente**: Verifica comportamiento con workflows sin registros
2. **Sites reales**: Prueba con sites de la base de datos
3. **Diferentes thresholds**: Prueba con 1h, 6h, 12h, 24h, 48h
4. **Registros stuck**: Identifica y limpia registros problemáticos

## Manejo de Errores

### Comportamiento Defensivo

- **Base de datos no disponible**: Procede optimísticamente (no bloquea workflows)
- **Error en consulta**: Procede optimísticamente con log de error
- **Error en limpieza**: Reporta error pero no bloquea workflow

### Logs Informativos

```bash
🔍 Validating cron status for dailyStandUpWorkflow (Site: site-123, threshold: 24h)
📋 Cron validation result: No existing cron record - first execution
✅ No existing cron record found - safe to proceed

# O en caso de limpieza:
🚨 Found stuck RUNNING record - stuck for 26.3h (threshold: 24h)
🧹 Cleaned stuck record that was 26.3h old
✅ Successfully cleaned stuck record for dailyStandUpWorkflow (Site: site-123)
```

## Archivos Relacionados

- **Actividad principal**: `src/temporal/activities/cronActivities.ts`
- **Ejemplos de uso**: `src/examples/cron-status-validation-example.ts`
- **Tests**: `src/scripts/test-cron-status-validation.ts`
- **Implementación en Daily Standup**: `src/temporal/workflows/dailyStandUpWorkflow.ts`
- **Implementación en Engine**: `src/temporal/workflows/activityPrioritizationEngineWorkflow.ts`

## Monitoreo

### Consultas Útiles

```sql
-- Ver workflows actualmente en RUNNING
SELECT 
  activity_name,
  site_id,
  workflow_id,
  status,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))/3600 as hours_running
FROM cron_status 
WHERE status = 'running'
ORDER BY updated_at ASC;

-- Ver workflows que se han limpiado automáticamente
SELECT *
FROM cron_status 
WHERE error_message LIKE '%Auto-reset from stuck RUNNING%'
ORDER BY updated_at DESC
LIMIT 10;
```

### Dashboard Recomendado

1. **Workflows en RUNNING > 24h**: Alerta crítica
2. **Workflows en RUNNING > 12h**: Alerta warning
3. **Limpiezas automáticas frecuentes**: Investigar causa raíz
4. **Workflows bloqueados**: Revisar logs de validación

## Próximos Pasos

1. **Integrar en más workflows**: Agregar a todos los workflows críticos
2. **Métricas**: Agregar métricas de limpiezas automáticas
3. **Alertas**: Notificaciones cuando se limpian registros stuck
4. **Dashboard**: Panel de monitoreo de salud de workflows