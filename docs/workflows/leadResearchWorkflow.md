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
  leadInfo?: any;                     // Información del lead de la base de datos
  deepResearchResult?: any;           // Resultado del deep research
  researchQuery?: string;             // Query generado para la investigación
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
  "leadInfo": {
    "id": "lead_12345",
    "name": "John Doe",
    "email": "john@acme.com",
    "position": "VP of Sales",
    "phone": "+1-555-0123",
    "social_networks": {
      "linkedin": "https://linkedin.com/in/johndoe",
      "twitter": "https://twitter.com/johndoe",
      "github": "https://github.com/johndoe",
      "website": "https://johndoe.com"
    }
  },
  "deepResearchResult": {
    "success": true,
    "operations": [],
    "operationResults": [],
    "insights": [
      {
        "title": "Social Media Presence",
        "description": "Active on LinkedIn with 2K+ connections",
        "confidence": 0.9,
        "source": "LinkedIn profile analysis"
      }
    ],
    "recommendations": [
      "Connect on LinkedIn first",
      "Reference shared connections",
      "Focus on technology solutions"
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

## Información capturada

### Datos del Lead
El workflow actualiza los siguientes campos del lead:
- **Información básica**: nombre, posición, teléfono, notas, idioma, fecha de cumpleaños
- **Redes sociales**: perfiles en LinkedIn, Twitter, Facebook, Instagram, YouTube, GitHub y sitio web personal
- **Metadatos**: análisis e información adicional obtenida durante la investigación

### Formato de redes sociales (JSONb)
```json
{
  "linkedin": "https://linkedin.com/in/username",
  "twitter": "https://twitter.com/username",
  "facebook": "https://facebook.com/username", 
  "instagram": "https://instagram.com/username",
  "youtube": "https://youtube.com/channel/username",
  "github": "https://github.com/username",
  "website": "https://personalwebsite.com"
}
```

## Flujo de trabajo

1. **Validación**: Verifica que `lead_id` y `site_id` estén presentes
2. **Logging inicial**: Registra el inicio del workflow
3. **Obtener sitio**: Busca información del sitio usando `getSiteActivity`
4. **Obtener lead**: Busca información del lead de la base de datos
5. **Generar query**: Crea un query de investigación incluyendo búsqueda de redes sociales
6. **Deep research**: Ejecuta el workflow de investigación profunda
7. **Actualizar lead**: Actualiza la información del lead con los datos encontrados
8. **Actualizar empresa**: Crea o actualiza la información de la empresa asociada
9. **Logging final**: Registra el resultado (éxito o fallo)
10. **Retorno**: Devuelve el resultado estructurado

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