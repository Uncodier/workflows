# Build Segments Workflow

## Descripción

El `buildSegmentsWorkflow` es un workflow de Temporal que automatiza el análisis y creación de segmentos de audiencia para sitios web utilizando inteligencia artificial. Este workflow se ejecuta **on-demand** a través del API de Temporal cuando se requiere crear o actualizar segmentos para un sitio específico.

## Funcionalidad

Este workflow realiza las siguientes operaciones:

1. **Obtiene información del sitio**: Consulta la base de datos para obtener la URL del sitio basándose en el `siteId`
2. **Analiza el sitio web**: Utiliza IA para analizar el contenido del sitio y identificar segmentos potenciales
3. **Crea segmentos**: Genera segmentos de audiencia basados en criterios de rentabilidad y comportamiento
4. **Registra resultados**: Mantiene logs detallados de la ejecución y resultados obtenidos
5. **Manejo de errores**: Gestiona errores de forma robusta con información detallada

## Parámetros de Entrada

### `BuildSegmentsOptions`

```typescript
interface BuildSegmentsOptions {
  siteId: string;                              // Requerido: ID del sitio
  segmentCount?: number;                       // Número de segmentos (1-20, default: 5)
  mode?: 'analyze' | 'create' | 'update';     // Modo de operación (default: 'create')
  timeout?: number;                           // Timeout en ms (default: 45000)
  userId?: string;                            // ID del usuario
  includeScreenshot?: boolean;                // Incluir captura (default: true)
  profitabilityMetrics?: string[];           // Métricas de rentabilidad
  minConfidenceScore?: number;                // Score mínimo (0-1, default: 0.7)
  segmentAttributes?: string[];               // Atributos a considerar
  industryContext?: string;                   // Contexto de industria (default: 'ecommerce')
  additionalInstructions?: string;            // Instrucciones adicionales
  aiProvider?: 'openai' | 'anthropic' | 'gemini'; // Proveedor IA (default: 'openai')
  aiModel?: string;                          // Modelo específico (default: 'gpt-4o')
}
```

### Ejemplos de Uso

#### Uso Básico (Mínimo)
```typescript
const options = {
  siteId: "site_456"
};
```

#### Uso Estándar
```typescript
const options = {
  siteId: "site_456",
  segmentCount: 5,
  mode: "create",
  userId: "user_789",
  industryContext: "ecommerce"
};
```

#### Uso Avanzado
```typescript
const options = {
  siteId: "site_456",
  segmentCount: 8,
  mode: "analyze",
  timeout: 60000,
  userId: "user_789",
  includeScreenshot: true,
  profitabilityMetrics: ["conversionRate", "ltv", "aov", "churnRate"],
  minConfidenceScore: 0.8,
  segmentAttributes: ["demographic", "behavioral", "psychographic", "geographic"],
  industryContext: "saas",
  additionalInstructions: "Enfocarse en segmentos B2B con alto potencial de retención",
  aiProvider: "anthropic",
  aiModel: "claude-3-sonnet"
};
```

## Respuesta del Workflow

### `BuildSegmentsResult`

```typescript
interface BuildSegmentsResult {
  success: boolean;           // Indica si el workflow fue exitoso
  siteId: string;            // ID del sitio procesado
  siteName?: string;         // Nombre del sitio
  siteUrl?: string;          // URL del sitio analizado
  segmentsBuilt: number;     // Número de segmentos creados
  mode: string;              // Modo de operación utilizado
  segments?: any[];          // Segmentos creados
  analysis?: any;            // Análisis detallado del sitio
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
  "siteName": "E-commerce Store",
  "siteUrl": "https://store.example.com",
  "segmentsBuilt": 5,
  "mode": "create",
  "segments": [
    {
      "id": "seg_123",
      "name": "High-Value Customers",
      "description": "Customers with high lifetime value and frequent purchases",
      "confidence": 0.92,
      "criteria": {
        "minOrderValue": 200,
        "purchaseFrequency": "monthly"
      }
    },
    {
      "id": "seg_456",
      "name": "Mobile-First Users",
      "description": "Users primarily accessing via mobile devices",
      "confidence": 0.88,
      "criteria": {
        "deviceType": "mobile",
        "sessionDuration": "> 3min"
      }
    }
  ],
  "analysis": {
    "totalVisitors": 15420,
    "conversionRate": 0.034,
    "averageOrderValue": 156.78,
    "topCategories": ["electronics", "home", "fashion"],
    "processingTime": "23.4s",
    "confidence": 0.86
  },
  "errors": [],
  "executionTime": "28.5s",
  "completedAt": "2024-01-15T14:30:00.000Z"
}
```

## API Utilizada

### Endpoint de Segmentos
- **URL**: `POST /api/site/segments`
- **Propósito**: Analizar sitio web e identificar segmentos rentables
- **Request Body**: Incluye URL del sitio y parámetros de configuración
- **Timeout**: Configurable (default: 45 segundos)

#### Request Body Completo
```json
{
  "url": "https://store.example.com",
  "segmentCount": 5,
  "mode": "create",
  "timeout": 45000,
  "user_id": "user_789",
  "site_id": "site_456",
  "includeScreenshot": true,
  "profitabilityMetrics": ["conversionRate", "ltv", "aov"],
  "minConfidenceScore": 0.7,
  "segmentAttributes": ["demographic", "behavioral", "psychographic"],
  "industryContext": "ecommerce",
  "additionalInstructions": "Enfocarse en segmentos con alto potencial de compra recurrente",
  "aiProvider": "openai",
  "aiModel": "gpt-4o"
}
```

## Actividades Relacionadas

### `getSiteActivity`
Obtiene información del sitio por ID para recuperar la URL.

```typescript
const result = await getSiteActivity("site_456");
// Retorna: { success: true, site: { url: "https://example.com", ... } }
```

### `buildSegmentsActivity`
Construye segmentos utilizando la API de análisis de sitios.

```typescript
const result = await buildSegmentsActivity({
  url: "https://example.com",
  segmentCount: 5,
  mode: "create"
});
```

## Modos de Operación

### 1. `analyze` - Solo Análisis
- Analiza el sitio sin crear segmentos en la base de datos
- Útil para validación y testing
- Retorna análisis detallado y segmentos propuestos

### 2. `create` - Crear Segmentos (Default)
- Analiza el sitio y crea nuevos segmentos en la base de datos
- Modo principal para sitios nuevos
- Sobrescribe segmentos existentes si los hay

### 3. `update` - Actualizar Segmentos
- Actualiza segmentos existentes basándose en nuevo análisis
- Preserva configuraciones manuales cuando es posible
- Útil para refreshes periódicos

## Casos de Uso

### 1. Setup Inicial de Sitio
```typescript
const options = {
  siteId: "new_site_123",
  mode: "create",
  segmentCount: 5,
  industryContext: "ecommerce"
};
```

### 2. Análisis de Validación
```typescript
const options = {
  siteId: "site_456",
  mode: "analyze",
  segmentCount: 3,
  minConfidenceScore: 0.9
};
```

### 3. Refresh Periódico
```typescript
const options = {
  siteId: "site_456",
  mode: "update",
  segmentCount: 7,
  includeScreenshot: true
};
```

### 4. Análisis Específico para Campaña
```typescript
const options = {
  siteId: "site_456",
  mode: "create",
  segmentCount: 10,
  industryContext: "saas",
  additionalInstructions: "Enfocarse en segmentos B2B para campaña de LinkedIn",
  aiProvider: "anthropic"
};
```

## Ejecución del Workflow

### Invocación Directa via Temporal Client

```typescript
import { getTemporalClient } from '../temporal/client';

const client = await getTemporalClient();
const handle = await client.workflow.start('buildSegmentsWorkflow', {
  args: [options],
  workflowId: `build-segments-${siteId}-${Date.now()}`,
  taskQueue: 'default-task-queue',
  workflowRunTimeout: '1 hour',
});

const result = await handle.result();
```

### Invocación via HTTP API (Ejemplo)

```bash
curl -X POST http://localhost:3000/api/workflows/build-segments \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "site_456",
    "segmentCount": 5,
    "mode": "create",
    "industryContext": "ecommerce"
  }'
```

## Configuración de AI Providers

### OpenAI (Default)
```typescript
{
  aiProvider: "openai",
  aiModel: "gpt-4o"  // También: "gpt-4", "gpt-3.5-turbo"
}
```

### Anthropic
```typescript
{
  aiProvider: "anthropic",
  aiModel: "claude-3-sonnet"  // También: "claude-3-opus", "claude-3-haiku"
}
```

### Google Gemini
```typescript
{
  aiProvider: "gemini",
  aiModel: "gemini-pro"  // También: "gemini-pro-vision"
}
```

## Métricas de Rentabilidad

### Métricas Disponibles
- `conversionRate`: Tasa de conversión
- `ltv`: Lifetime Value del cliente
- `aov`: Average Order Value
- `churnRate`: Tasa de abandono
- `repeatPurchaseRate`: Tasa de compra repetida
- `sessionDuration`: Duración promedio de sesión
- `pageViews`: Páginas vistas por sesión
- `bounceRate`: Tasa de rebote

### Ejemplo de Configuración
```typescript
{
  profitabilityMetrics: [
    "conversionRate",
    "ltv", 
    "aov",
    "repeatPurchaseRate"
  ]
}
```

## Atributos de Segmentación

### Tipos Disponibles
- `demographic`: Edad, género, ingresos, ubicación
- `behavioral`: Patrones de compra, frecuencia, preferencias
- `psychographic`: Intereses, valores, estilo de vida
- `geographic`: Región, ciudad, zona horaria
- `technographic`: Dispositivos, navegadores, plataformas

### Ejemplo de Configuración
```typescript
{
  segmentAttributes: [
    "demographic",
    "behavioral", 
    "psychographic"
  ]
}
```

## Contextos de Industria

### Contextos Soportados
- `ecommerce`: Comercio electrónico
- `saas`: Software as a Service
- `finance`: Servicios financieros
- `healthcare`: Salud y bienestar
- `education`: Educación y formación
- `realestate`: Bienes raíces
- `travel`: Viajes y turismo
- `media`: Medios y entretenimiento

## Logging y Monitoreo

### Estados de Workflow
- `RUNNING`: Workflow en ejecución
- `COMPLETED`: Workflow completado exitosamente
- `FAILED`: Workflow falló

### Logs Generados
1. **Inicio de workflow**: Parámetros y configuración
2. **Obtención de sitio**: URL recuperada y validación
3. **Análisis de sitio**: Progreso y configuración de IA
4. **Resultados**: Segmentos creados y análisis
5. **Finalización**: Tiempo total y estado final

## Manejo de Errores

### Errores Comunes

1. **Sitio No Encontrado**
   - Error: "Site not found"
   - Solución: Verificar que el siteId existe en la base de datos

2. **URL No Configurada**
   - Error: "Site has no URL configured"
   - Solución: Configurar URL válida para el sitio

3. **API de Análisis No Disponible**
   - Error: "Failed to build segments"
   - Solución: Verificar conectividad y configuración de API

4. **Timeout de Análisis**
   - Error: "Analysis timeout"
   - Solución: Aumentar el timeout o usar sitio más simple

5. **Base de Datos No Disponible**
   - Error: "Database not available"
   - Solución: Verificar conexión a Supabase

### Reintentos

- **Intentos máximos**: 3
- **Timeout por actividad**: 10 minutos
- **Timeout total del workflow**: 1 hora

## Testing

### Ejecutar Tests
```bash
npm test -- buildSegmentsWorkflow.test.ts
```

### Script de Prueba
```bash
node scripts/test-build-segments-workflow.js
```

### Tests Incluidos
- Construcción exitosa de segmentos
- Manejo de errores de API
- Validación de parámetros
- Tests de tipos TypeScript

## Configuración

### Variables de Entorno Requeridas
- `API_BASE_URL`: URL base de la API de análisis
- `API_KEY`: Clave de API para autenticación
- `TEMPORAL_SERVER_URL`: URL del servidor Temporal
- `DATABASE_URL`: URL de conexión a Supabase

### Configuración de Temporal
- **Task Queue**: `default-task-queue`
- **Timeout**: 1 hora
- **Reintentos**: 3 intentos máximos

## Métricas y Performance

### Tiempo de Ejecución Típico
- **Sitios simples**: 15-30 segundos
- **Sitios complejos**: 30-60 segundos
- **Análisis detallado**: 60-120 segundos

### Consideraciones de Escalabilidad
- Un workflow por sitio a la vez
- Rate limiting en APIs de IA
- Caché de análisis para sitios similares
- Optimización basada en tamaño del sitio

## Integración con Otros Workflows

### Secuencia Típica
1. **Setup de sitio** → `siteSetupWorkflow`
2. **Análisis de segmentos** → `buildSegmentsWorkflow` ⭐
3. **Creación de campañas** → `buildCampaignsWorkflow`

### Llamada desde Otros Workflows
```typescript
import { startChild } from '@temporalio/workflow';

const segmentResult = await startChild(buildSegmentsWorkflow, {
  args: [{ siteId: "site_456", mode: "create" }]
});
```

## Mejores Prácticas

### Recomendaciones de Uso

1. **Para sitios nuevos**: Usar modo `create` con 5-7 segmentos
2. **Para análisis**: Usar modo `analyze` antes de crear
3. **Para actualizaciones**: Usar modo `update` mensualmente
4. **Para campañas específicas**: Personalizar `additionalInstructions`

### Optimización de Parámetros

1. **segmentCount**: Empezar con 5, ajustar según necesidades
2. **minConfidenceScore**: Usar 0.7 para balancear calidad/cantidad
3. **timeout**: Ajustar según complejidad del sitio
4. **aiProvider**: OpenAI para velocidad, Anthropic para precisión 