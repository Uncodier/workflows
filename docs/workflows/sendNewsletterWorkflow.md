# Send Newsletter Workflow

El `sendNewsletterWorkflow` es un workflow que permite enviar newsletters masivos a leads basándose en segmentos y estatus específicos, con filtros opcionales.

## Características

- ✅ Validación de configuración de email desde el inicio
- ✅ **Filtros opcionales** por segmentos y estatus
- ✅ **Siempre** busca leads que tengan email válido
- ✅ **Últimos 500 leads** por fecha de creación si hay más de 500
- ✅ Envío individual usando `sendEmailFromAgent`
- ✅ Manejo de errores y reintentos
- ✅ Reporte detallado de resultados

## Reglas de Negocio

### 📋 Filtros Opcionales
- **`segments_ids`**: Si está vacío o no se proporciona, **no filtra por segmentos** (todos los segmentos)
- **`status`**: Si está vacío o no se proporciona, **no filtra por estatus** (todos los estatus)

### 📧 Email Obligatorio
- **Siempre** busca leads que tengan email válido (NOT NULL y no vacío)
- Filtra automáticamente leads sin email

### 📅 Orden por Fecha
- **Siempre** ordena por `created_at DESC` (más recientes primero)
- Si hay más de 500 leads, trae los **últimos 500** creados

## Parámetros

```typescript
interface SendNewsletterParams {
  site_id: string;          // ID del sitio (requerido)
  subject: string;          // Asunto del email (requerido)
  message: string;          // Contenido del email HTML (requerido)
  segments_ids?: string[];  // OPCIONAL: Array de IDs de segmentos
  status?: string[];        // OPCIONAL: Array de estatus ['new', 'contacted', etc.]
  maxEmails?: number;       // OPCIONAL: Límite de emails (default: 500)
}
```

## Resultado

```typescript
interface SendNewsletterResult {
  success: boolean;          // Si el workflow fue exitoso
  emailsSent: number;        // Cantidad de emails enviados
  emailsFailed: number;      // Cantidad de emails fallidos
  totalLeads: number;        // Total de leads encontrados
  leadsProcessed: number;    // Leads procesados
  emailConfigValid: boolean; // Si la configuración de email es válida
  executionTime: string;     // Tiempo de ejecución
  timestamp: string;         // Timestamp del resultado
  error?: string;            // Error si ocurrió
  results?: any[];           // Resultados detallados por email
}
```

## Flujo de Trabajo

1. **Validación de Configuración**: Verifica que el sitio tenga configuración de email válida
2. **Obtención de Leads**: Busca leads con filtros opcionales + email obligatorio + orden por fecha
3. **Envío de Emails**: Envía emails uno por uno usando `sendEmailFromAgent`
4. **Reporte de Resultados**: Retorna estadísticas detalladas

## Ejemplos de Uso

### 📧 Ejemplo 1: Newsletter a segmentos específicos

```typescript
import { getTemporalClient } from '../temporal/client';
import { workflows } from '../temporal/workflows';

const client = await getTemporalClient();

const result = await client.workflow.execute(workflows.sendNewsletterWorkflow, {
  args: [{
    site_id: 'your-site-id',
    subject: 'Newsletter Segmentado',
    message: '<h1>Contenido específico</h1><p>Para segmentos seleccionados...</p>',
    segments_ids: ['segment-1', 'segment-2'], // Solo estos segmentos
    status: ['new', 'contacted'],             // Solo estos estatus
    maxEmails: 100
  }],
  taskQueue: 'default',
  workflowId: 'newsletter-segments-' + Date.now()
});
```

### 📧 Ejemplo 2: Newsletter a todos los leads (sin filtros)

```typescript
const result = await client.workflow.execute(workflows.sendNewsletterWorkflow, {
  args: [{
    site_id: 'your-site-id',
    subject: 'Newsletter General',
    message: '<h1>Para todos!</h1><p>Contenido general para todos los leads...</p>',
    // segments_ids y status no se proporcionan = sin filtros
    maxEmails: 500
  }],
  taskQueue: 'default',
  workflowId: 'newsletter-all-' + Date.now()
});
```

### 📧 Ejemplo 3: Solo filtro por estatus

```typescript
const result = await client.workflow.execute(workflows.sendNewsletterWorkflow, {
  args: [{
    site_id: 'your-site-id',
    subject: 'Newsletter para Nuevos Leads',
    message: '<h1>Bienvenidos!</h1><p>Para leads nuevos...</p>',
    // segments_ids no se proporciona = todos los segmentos
    status: ['new'],              // Solo leads nuevos
    maxEmails: 200
  }],
  taskQueue: 'default',
  workflowId: 'newsletter-new-leads-' + Date.now()
});
```

## Validaciones

### ✅ Configuración de Email
El workflow falla inmediatamente si:
- No hay configuración de email en `settings.channels`
- El email no está habilitado (`enabled: false`)
- Faltan campos requeridos: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`

### ✅ Leads
- **Siempre** filtra leads con email válido (NOT NULL y no vacío)
- **Opcionalmente** filtra por `segment_id` si `segments_ids` no está vacío
- **Opcionalmente** filtra por `status` si `status` no está vacío
- **Siempre** ordena por `created_at DESC` (más recientes primero)
- **Siempre** respeta el límite de emails

## Consulta SQL Generada

### Con todos los filtros:
```sql
SELECT * FROM leads 
WHERE site_id = 'site-id' 
  AND email IS NOT NULL 
  AND email != '' 
  AND segment_id IN ('seg1', 'seg2') 
  AND status IN ('new', 'contacted')
ORDER BY created_at DESC 
LIMIT 500;
```

### Sin filtros (solo email):
```sql
SELECT * FROM leads 
WHERE site_id = 'site-id' 
  AND email IS NOT NULL 
  AND email != ''
ORDER BY created_at DESC 
LIMIT 500;
```

## Estructura de Base de Datos

### Tabla `leads`
```sql
- id: uuid
- email: text (requerido para newsletter)
- name: text
- segment_id: uuid (FK a segments) - OPCIONAL para filtros
- status: text (new, contacted, qualified, converted, lost) - OPCIONAL para filtros
- site_id: uuid (FK a sites) - REQUERIDO
- created_at: timestamp (usado para ordenamiento)
```

### Tabla `segments`
```sql
- id: uuid
- name: text
- site_id: uuid (FK a sites)
```

### Tabla `settings`
```sql
- site_id: uuid
- channels: jsonb (configuración de email)
```

## Escenarios de Uso

| Caso de Uso | segments_ids | status | Resultado |
|-------------|--------------|---------|-----------|
| Newsletter general | `undefined` o `[]` | `undefined` o `[]` | Todos los leads con email |
| Segmento específico | `['seg1', 'seg2']` | `undefined` o `[]` | Solo segmentos especificados |
| Estado específico | `undefined` o `[]` | `['new']` | Solo leads nuevos |
| Segmento + Estado | `['seg1']` | `['new', 'contacted']` | Intersección de ambos filtros |

## Limitaciones

- Máximo 500 emails por defecto (configurable hasta 500)
- Envío secuencial (no paralelo)
- Requiere configuración de email previa
- No maneja templates avanzados

## Test

Para probar diferentes escenarios:

```bash
npx tsx src/scripts/test-send-newsletter-workflow.ts
```

El script de prueba incluye:
- ✅ Newsletter con filtros de segmento y estatus
- ✅ Newsletter sin filtros (todos los leads)
- ✅ Validación de reglas de negocio 