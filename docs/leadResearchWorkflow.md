# Lead Research Workflow

## Descripción

El `leadResearchWorkflow` es un workflow de Temporal que ejecuta investigación de leads utilizando el agente de ventas AI. Consume la API `/api/agents/sales/leadResearch` y retorna insights y recomendaciones sobre el lead.

## Estructura

### Archivos principales:
- **Workflow**: `src/temporal/workflows/leadResearchWorkflow.ts`
- **Actividad**: `src/temporal/activities/campaignActivities.ts` (función `leadResearchActivity`)
- **Ejemplo**: `examples/leadResearchWorkflow-example.js`

## Uso

### Parámetros de entrada (LeadResearchOptions)

```typescript
interface LeadResearchOptions {
  lead_id: string;                    // Requerido: ID del lead
  site_id: string;                    // Requerido: ID del sitio
  userId?: string;                    // Opcional: ID del usuario (por defecto usa site.user_id)
  additionalData?: any;               // Opcional: datos adicionales para la investigación
}
```

### Resultado (LeadResearchResult)

```typescript
interface LeadResearchResult {
  success: boolean;                   // Si la investigación fue exitosa
  leadId: string;                     // ID del lead investigado
  siteId: string;                     // ID del sitio
  siteName?: string;                  // Nombre del sitio
  siteUrl?: string;                   // URL del sitio
  researchData?: any;                 // Datos de investigación obtenidos
  insights?: any[];                   // Insights generados
  recommendations?: string[];         // Recomendaciones de seguimiento
  data?: any;                         // Datos completos de la respuesta
  errors: string[];                   // Lista de errores (si los hay)
  executionTime: string;              // Tiempo de ejecución
  completedAt: string;                // Timestamp de finalización
}
```

## API Endpoint

El workflow consume la API: `POST /api/agents/sales/leadResearch`

### Parámetros enviados:
```json
{
  "lead_id": "string",
  "site_id": "string", 
  "user_id": "string",
  "...additionalData"
}
```

### Formato de respuesta esperado:
```json
{
  "success": true,
  "data": {
    "researchData": {
      "company": "Acme Corp",
      "industry": "Technology",
      "size": "50-100 employees",
      "revenue": "$5M-$10M",
      "location": "San Francisco, CA",
      "website": "https://acme.com",
      "contact": {
        "name": "John Doe",
        "title": "VP of Sales",
        "email": "john@acme.com",
        "phone": "+1-555-0123"
      }
    },
    "insights": [
      {
        "title": "Company Growth",
        "description": "Company has grown 50% YoY",
        "confidence": 0.85,
        "source": "LinkedIn analysis"
      }
    ],
    "recommendations": [
      "Follow up within 24 hours",
      "Focus on scalability benefits"
    ]
  }
}
```

## Ejemplos de uso

### 1. Uso básico

```javascript
const { Client } = require('@temporalio/client');

async function runLeadResearch() {
  const client = new Client();
  
  const options = {
    lead_id: 'lead_12345',
    site_id: 'site_67890'
  };

  const handle = await client.workflow.start('leadResearchWorkflow', {
    args: [options],
    taskQueue: 'default',
    workflowId: `lead-research-${options.lead_id}-${Date.now()}`,
  });

  const result = await handle.result();
  console.log('Research completed:', result);
}
```

### 2. Investigación detallada

```javascript
const detailedOptions = {
  lead_id: 'lead_12345',
  site_id: 'site_67890',
  userId: 'user_sales_manager',
  additionalData: {
    includeCompanyInfo: true,
    includeContactHistory: true,
    includeSocialMedia: true,
    researchDepth: 'comprehensive',
    focusAreas: ['technology', 'budget', 'decision_makers']
  }
};
```

### 3. Investigación rápida

```javascript
const quickOptions = {
  lead_id: 'lead_12345',
  site_id: 'site_67890',
  additionalData: {
    researchDepth: 'basic',
    timeLimit: '2 minutes',
    focusAreas: ['contact_info', 'company_size']
  }
};
```

## Flujo de trabajo

1. **Validación**: Verifica que `lead_id` y `site_id` estén presentes
2. **Logging inicial**: Registra el inicio del workflow
3. **Obtener sitio**: Busca información del sitio usando `getSiteActivity`
4. **Investigación**: Ejecuta la investigación usando `leadResearchActivity`
5. **Procesamiento**: Extrae insights y recomendaciones de la respuesta
6. **Logging final**: Registra el resultado (éxito o fallo)
7. **Retorno**: Devuelve el resultado estructurado

## Manejo de errores

- **Validación de parámetros**: Valida que `lead_id` y `site_id` no estén vacíos
- **Error de sitio**: Si no se puede obtener información del sitio
- **Error de API**: Si la API de investigación falla
- **Timeout**: Si la investigación toma más de 5 minutos
- **Reintentos**: Máximo 3 intentos automáticos

## Logging y monitoreo

El workflow genera logs detallados en cada paso:

```
🔍 Starting lead research workflow for lead {lead_id} on site {site_id}
🏢 Step 1: Getting site information for {site_id}...
✅ Retrieved site information: {siteName} ({siteUrl})
🔍 Step 2: Executing lead research for lead {lead_id}...
✅ Successfully executed lead research for lead {lead_id}
📊 Results: {insights.length} insights, {recommendations.length} recommendations
🎉 Lead research workflow completed successfully!
```

## Estado del cron

El workflow actualiza el estado del cron job durante la ejecución:
- `RUNNING`: Durante la ejecución
- `COMPLETED`: Al finalizar exitosamente  
- `FAILED`: En caso de error

## Integración

El workflow está completamente integrado en el sistema:
- ✅ Exportado en `src/temporal/workflows/index.ts`
- ✅ Actividad disponible en `src/temporal/activities/index.ts`
- ✅ Compatible con el bundle de workflows existente
- ✅ Sigue las mismas convenciones que otros workflows

## Diferencias con leadFollowUpWorkflow

| Aspecto | leadFollowUpWorkflow | leadResearchWorkflow |
|---------|---------------------|---------------------|
| **API Endpoint** | `/api/agents/sales/leadFollowUP` | `/api/agents/sales/leadResearch` |
| **Propósito** | Ejecutar seguimiento de leads | Investigar información de leads |
| **Resultado principal** | `followUpActions`, `nextSteps` | `researchData`, `insights`, `recommendations` |
| **Timeout** | 5 minutos | 5 minutos |
| **Estructura** | Idéntica | Idéntica |

## Pruebas

Para probar el workflow, ejecutar el ejemplo:

```bash
node examples/leadResearchWorkflow-example.js
```

## Notas importantes

- El workflow requiere que la API `/api/agents/sales/leadResearch` esté disponible
- Los parámetros `lead_id` y `site_id` son obligatorios
- El resultado siempre incluye un array de errores (vacío si no hay errores)
- El workflow mantiene el mismo patrón de manejo de errores que otros workflows del sistema 