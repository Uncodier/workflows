# Build Campaigns Workflow

## Descripción

El `buildCampaignsWorkflow` es un workflow de Temporal que automatiza la creación de campañas de marketing basadas en segmentos de audiencia existentes para un sitio web específico. Este workflow se ejecuta **on-demand** a través del API de Temporal cuando se requiere crear campañas para un sitio específico.

## Funcionalidad

Este workflow realiza las siguientes operaciones:

1. **Obtiene segmentos**: Consulta la API para obtener todos los segmentos disponibles para un sitio específico
2. **Crea campañas**: Utiliza los segmentos encontrados para crear campañas a través del agente de crecimiento
3. **Registra ejecución**: Mantiene un registro completo de la ejecución y resultados
4. **Manejo de errores**: Gestiona errores de forma robusta y proporciona información detallada

## Parámetros de Entrada

### `BuildCampaignsOptions`

```typescript
interface BuildCampaignsOptions {
  siteId: string;                              // Requerido: ID del sitio
  userId?: string;                            // Opcional: ID del usuario
  agentId?: string;                           // Opcional: ID del agente
  additionalCampaignData?: Record<string, any>; // Opcional: Datos adicionales para la campaña
}
```

### Ejemplos de Uso

#### Uso Básico
```typescript
const options = {
  siteId: "site_456"
};
```

#### Uso Completo
```typescript
const options = {
  siteId: "site_456",
  userId: "user_789", 
  agentId: "agent_growth_123",
  additionalCampaignData: {
    strategy: "growth",
    priority: "high",
    budget: 1000,
    targetAudience: "premium_users"
  }
};
```

## Respuesta del Workflow

### `BuildCampaignsResult`

```typescript
interface BuildCampaignsResult {
  success: boolean;           // Indica si el workflow fue exitoso
  siteId: string;            // ID del sitio procesado
  segmentsFound: number;     // Número de segmentos encontrados
  campaignCreated: boolean;  // Indica si se creó una campaña
  segments?: any[];          // Segmentos encontrados (opcional)
  campaign?: any;            // Campaña creada (opcional)
  errors: string[];          // Lista de errores encontrados
  executionTime: string;     // Tiempo de ejecución
  completedAt: string;       // Timestamp de finalización
}
```

### Ejemplo de Respuesta Exitosa

```json
{
  "success": true,
  "siteId": "site_456",
  "segmentsFound": 3,
  "campaignCreated": true,
  "segments": [
    {
      "id": "seg_123",
      "name": "High Value Customers",
      "siteId": "site_456"
    },
    {
      "id": "seg_456", 
      "name": "New Visitors",
      "siteId": "site_456"
    }
  ],
  "campaign": {
    "id": "campaign_789",
    "name": "Growth Campaign",
    "status": "created",
    "segments": ["seg_123", "seg_456"]
  },
  "errors": [],
  "executionTime": "2.45s",
  "completedAt": "2024-01-15T10:30:00.000Z"
}
```

## APIs Utilizadas

### 1. Obtener Segmentos
- **Endpoint**: `GET /api/segments?siteId={siteId}`
- **Propósito**: Recuperar todos los segmentos disponibles para el sitio

### 2. Crear Campañas
- **Endpoint**: `POST /api/agents/growth/campaigns`
- **Propósito**: Crear campañas usando los segmentos encontrados
- **Body**:
```json
{
  "siteId": "site_456",
  "agent_id": "agent_growth_123",
  "userId": "user_789",
  "campaignData": {
    "segmentIds": ["seg_123", "seg_456"]
  }
}
```

## Actividades Relacionadas

### `getSegmentsActivity`
Obtiene los segmentos para un sitio específico.

```typescript
const result = await getSegmentsActivity("site_456");
```

### `createCampaignsActivity`
Crea campañas usando los segmentos proporcionados.

```typescript
const result = await createCampaignsActivity({
  siteId: "site_456",
  campaignData: {
    segmentIds: ["seg_123", "seg_456"]
  }
});
```

### `scheduleBuildCampaignsWorkflowActivity`
Programa la ejecución del workflow.

```typescript
const result = await scheduleBuildCampaignsWorkflowActivity("site_456", {
  userId: "user_789",
  agentId: "agent_growth_123"
});
```

## Casos de Uso

### 1. Sitio con Segmentos Existentes
- El workflow encuentra segmentos y crea campañas exitosamente
- Resultado: `campaignCreated: true`

### 2. Sitio sin Segmentos
- El workflow encuentra que no hay segmentos disponibles
- No se crean campañas
- Resultado: `segmentsFound: 0, campaignCreated: false`

### 3. Error en API
- Fallos en la obtención de segmentos o creación de campañas
- Resultado: `success: false, errors: [...]`

## Programación y Ejecución

### Ejecución Directa
```typescript
import { getTemporalClient } from '../temporal/client';

const client = await getTemporalClient();
const handle = await client.workflow.start('buildCampaignsWorkflow', {
  args: [options],
  workflowId: `build-campaigns-${siteId}`,
  taskQueue: 'default-task-queue',
  workflowRunTimeout: '30 minutes',
});

const result = await handle.result();
```

### Programación Automática
```typescript
import { scheduleBuildCampaignsWorkflowActivity } from '../activities/workflowSchedulingActivities';

const result = await scheduleBuildCampaignsWorkflowActivity(siteId, {
  userId: "user_789",
  agentId: "agent_growth_123",
  additionalCampaignData: { strategy: "growth" }
});
```

## Logging y Monitoreo

El workflow registra automáticamente:

1. **Cron Status**: Estado de ejecución en la tabla de cron
2. **Workflow Execution Log**: Registro detallado de la ejecución
3. **Console Logs**: Logs detallados para debugging

### Estados de Cron
- `RUNNING`: Workflow en ejecución
- `COMPLETED`: Workflow completado exitosamente
- `FAILED`: Workflow falló

## Manejo de Errores

### Errores Comunes

1. **API No Disponible**
   - Error: "Failed to fetch segments"
   - Solución: Verificar conectividad y configuración de API

2. **Sitio No Encontrado**
   - Error: "Site not found"
   - Solución: Verificar que el siteId existe

3. **Datos de Campaña Inválidos**
   - Error: "Invalid campaign data"
   - Solución: Verificar estructura de campaignData

### Reintentos

El workflow utiliza la configuración de reintentos de Temporal:
- **Intentos máximos**: 3
- **Timeout**: 5 minutos por actividad

## Testing

### Ejecutar Tests
```bash
npm test -- buildCampaignsWorkflow.test.ts
```

### Script de Prueba
```bash
node scripts/test-build-campaigns-workflow.js
```

## Configuración

### Variables de Entorno Requeridas
- `API_BASE_URL`: URL base de la API
- `API_KEY`: Clave de API para autenticación
- `TEMPORAL_SERVER_URL`: URL del servidor Temporal

### Configuración de Temporal
- **Task Queue**: `default-task-queue`
- **Timeout**: 30 minutos
- **Reintentos**: 3 intentos máximos

## Integración

### Con Otros Workflows
El `buildCampaignsWorkflow` puede ser llamado desde otros workflows:

```typescript
import { startChild } from '@temporalio/workflow';

const campaignResult = await startChild(buildCampaignsWorkflow, {
  args: [{ siteId: "site_456" }]
});
```

### Con Cron Jobs
Puede ser programado para ejecutarse periódicamente:

```typescript
// Ejecutar diariamente para crear nuevas campañas
const cronExpression = '0 9 * * *'; // 9 AM todos los días
```

## Métricas y Performance

### Tiempo de Ejecución Típico
- **Con segmentos**: 2-5 segundos
- **Sin segmentos**: 1-2 segundos
- **Con errores**: Variable según timeout

### Consideraciones de Escalabilidad
- Procesamiento secuencial de sitios
- Rate limiting en APIs externas
- Gestión de memoria para grandes volúmenes de datos 