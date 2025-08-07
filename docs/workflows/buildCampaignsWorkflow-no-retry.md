# BuildCampaignsWorkflow - No Retry Policy

## Resumen

El `buildCampaignsWorkflow` ha sido modificado para manejar fallos de creación de campañas como operaciones **no críticas**. Esto significa que el workflow continúa ejecutándose exitosamente incluso si la creación de campañas falla, evitando reintentos costosos e innecesarios.

## Cambios Realizados

### 1. Nueva Política de Reintentos

Se agregó una nueva política `NO_RETRY` en `src/temporal/config/timeouts.ts`:

```typescript
NO_RETRY: {
  maximumAttempts: 1,
  backoffCoefficient: 1.0,
  initialIntervalMs: 0,
  maximumIntervalMs: 0,
}
```

### 2. Separación de Actividades

Las actividades se dividieron en dos categorías:

#### Críticas (con reintentos)
- `getSiteActivity` - Validación del sitio
- `getSegmentsActivity` - Validación de segmentos

#### No Críticas (sin reintentos)
- `createCampaignsActivity` - Creación de campañas
- `createCampaignRequirementsActivity` - Creación de requisitos

### 3. Manejo de Errores Mejorado

El workflow ahora:
- ✅ Siempre retorna `success: true` si las operaciones críticas funcionan
- ⚠️ Incluye un array `warnings` para fallos no críticos
- 🔄 Continúa la ejecución incluso si las campañas fallan
- 📊 Retorna resultados parciales cuando sea posible

## Comportamiento Anterior vs Nuevo

### Anterior 
```typescript
// Si createCampaignsActivity fallaba:
{
  success: false,
  processed: true,
  reason: 'Campaign creation failed',
  error: 'CAMPAIGN_PLANNING_FAILED: No se pudo obtener...'
}
// El workflow se consideraba fallido ❌
```

### Nuevo
```typescript
// Si createCampaignsActivity falla:
{
  success: true, // ✅ Workflow exitoso
  processed: true,
  reason: 'Workflow completed successfully (warnings: Campaign creation failed)',
  siteInfo: { /* datos del sitio */ },
  segmentsUsed: [ /* segmentos validados */ ],
  warnings: ['Campaign creation failed'],
  campaign: undefined // No se creó
}
```

## Casos de Uso

### Error CAMPAIGN_PLANNING_FAILED

Ahora este error específico:
```json
{
  "success": false,
  "error": "Failed to create campaigns for site 0de521da-0406-44c3-85e5-8b4c0cc8f271: API call failed: 500 Internal Server Error. {\"success\":false,\"error\":{\"code\":\"CAMPAIGN_PLANNING_FAILED\",\"message\":\"No se pudo obtener la planificación de campañas del Growth Marketer\"}}"
}
```

Se maneja como:
```json
{
  "success": true,
  "processed": true,
  "reason": "Workflow completed successfully (warnings: Campaign creation failed)",
  "siteInfo": { "id": "0de521da-0406-44c3-85e5-8b4c0cc8f271", /* ... */ },
  "warnings": ["Campaign creation failed"],
  "campaign": undefined
}
```

## Ventajas

1. **Sin Reintentos Costosos**: Evita múltiples llamadas fallidas a APIs de Growth Marketer
2. **Continuidad del Flujo**: Otros procesos pueden continuar aunque las campañas fallen
3. **Información Parcial**: Se retorna información útil del sitio y segmentos
4. **Visibilidad**: Los warnings permiten monitorear fallos sin bloquear el flujo
5. **Flexibilidad**: Permite decidir a nivel de aplicación si reintentar o no

## Testing

Para probar el nuevo comportamiento:

```bash
npx tsx src/scripts/test-build-campaigns-no-retry.ts
```

## Configuración

### Para Restaurar Reintentos (si es necesario)

Si en el futuro se quiere restaurar reintentos para campañas:

```typescript
// En buildCampaignsWorkflow.ts, cambiar:
retry: RETRY_POLICIES.NO_RETRY

// Por:
retry: RETRY_POLICIES.NETWORK // o RETRY_POLICIES.DEFAULT
```

### Para Aplicar a Otras Actividades

Para hacer otras actividades no críticas:

```typescript
const { myNonCriticalActivity } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DEFAULT,
  retry: RETRY_POLICIES.NO_RETRY,
});
```

## Monitoreo

Para monitorear fallos de campañas:

1. Verificar el campo `warnings` en los resultados del workflow
2. Buscar logs con `⚠️ Campaign creation failed (non-critical)`
3. Alertar en casos donde `campaign: undefined` pero `success: true`

---

*Último cambio: Configuración de buildCampaignsWorkflow para tratar fallos de campaña como no críticos sin políticas de reintento.*
