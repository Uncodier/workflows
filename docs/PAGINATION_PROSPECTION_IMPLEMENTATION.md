# Implementación de Paginación en Daily Prospection Workflow

## Resumen

Se ha implementado un sistema de paginación en el `dailyProspectionWorkflow` que permite continuar buscando en múltiples páginas hasta encontrar al menos 1 lead válido para prospectar, resolviendo el problema donde el flujo terminaba sin prospectar a ningún usuario debido a validaciones.

## Problema Solucionado

**Antes**: El workflow podía terminar sin encontrar leads válidos en la primera página de resultados debido a:
- Filtros de canales de comunicación (email/WhatsApp)
- Leads con `assignee_id` ya asignados
- Leads con tareas existentes en etapa 'awareness'

**Después**: El workflow busca automáticamente en múltiples páginas hasta encontrar leads válidos o alcanzar límites de seguridad.

## Nuevas Funcionalidades

### 1. Parámetros de Configuración

```typescript
interface DailyProspectionOptions {
  // ... campos existentes ...
  maxPages?: number;           // Máximo de páginas a buscar (default: 10)
  minLeadsRequired?: number;   // Mínimo leads requeridos para detener paginación (default: 1)
}
```

### 2. Nueva Función de Paginación

```typescript
async function searchLeadsWithPagination(
  options: DailyProspectionOptions,
  maxPages: number,
  minLeadsRequired: number,
  channelsValidation: any,
  site: any
): Promise<{
  allLeads: any[];
  totalPagesSearched: number;
  totalCandidatesFound: number;
  stopped: 'found_leads' | 'max_pages_reached' | 'no_more_pages';
  paginationLog: string[];
}>
```

### 3. Actividad Mejorada con Paginación

```typescript
export async function getProspectionLeadsActivity(
  options: DailyProspectionOptions
): Promise<GetProspectionLeadsResult> {
  const { page = 0, pageSize = 30 } = options;
  // Implementa OFFSET y LIMIT en consultas SQL
  // Retorna información de hasMorePages
}
```

## Lógica de Funcionamiento

### Flujo de Paginación

1. **Inicialización**:
   - `currentPage = 0`
   - `maxPages = 10` (configurable)
   - `minLeadsRequired = 1` (configurable)
   - `pageSize = 30` (fijo)

2. **Bucle de Búsqueda**:
   ```
   WHILE (currentPage < maxPages AND hasMorePages AND leadsFound < minLeadsRequired):
     - Buscar en página actual
     - Aplicar filtros de canales
     - Agregar leads válidos a colección
     - Incrementar página
     - Verificar condiciones de parada
   ```

3. **Condiciones de Parada**:
   - **`found_leads`**: Se encontraron suficientes leads válidos
   - **`max_pages_reached`**: Se alcanzó el límite máximo de páginas
   - **`no_more_pages`**: No hay más datos en la base de datos

### Ejemplo de Ejecución

```
📄 Searching page 0...
Page 0: Found 30 raw, 2 after filtering. Total so far: 2
✅ Found 2 leads (>= 1 required) after searching 1 page(s)
```

```
📄 Searching page 0...
Page 0: Found 30 raw, 0 after filtering. Total so far: 0
📄 Searching page 1...
Page 1: Found 25 raw, 1 after filtering. Total so far: 1
✅ Found 1 leads (>= 1 required) after searching 2 page(s)
```

## Información de Debugging

### Logs Detallados

Cada ejecución incluye logs completos del proceso:

```
🔄 Starting paginated lead search:
   - Max pages to search: 10
   - Min leads required: 1
   - Page size: 30 leads per page

📄 Searching page 0...
📋 Page 0 results:
   - Raw leads found: 30
   - Has more pages: true
   - Total candidates in DB: 150

📊 Page 0 after channel filtering:
   - Leads after filtering: 2
   - Leads filtered out: 28
```

### Información en Resultados

```typescript
interface DailyProspectionResult {
  // ... campos existentes ...
  paginationInfo?: {
    totalPagesSearched: number;
    maxPagesConfigured: number;
    minLeadsRequired: number;
    stoppedReason: 'found_leads' | 'max_pages_reached' | 'no_more_pages';
    paginationLog: string[];
  };
}
```

## Base de Datos - Cambios en Consultas

### Antes
```sql
SELECT * FROM leads 
WHERE site_id = ? AND status = 'new' AND created_at < ?
ORDER BY created_at ASC 
LIMIT 30;
```

### Después
```sql
-- Primero: Contar total
SELECT COUNT(*) FROM leads 
WHERE site_id = ? AND status = 'new' AND created_at < ?;

-- Segundo: Obtener página específica
SELECT * FROM leads 
WHERE site_id = ? AND status = 'new' AND created_at < ?
ORDER BY created_at ASC 
LIMIT 30 OFFSET ?;
```

## Prevención de Bucles Infinitos

### Límites de Seguridad

1. **Máximo de páginas**: `maxPages = 10` (configurable)
2. **Timeout de actividad**: 10 minutos por actividad
3. **Timeout de workflow**: Configurado en Temporal

### Cálculo de Límites

- **Máximo leads procesables**: `maxPages × pageSize = 10 × 30 = 300 leads`
- **Tiempo máximo estimado**: `10 páginas × ~30s/página = ~5 minutos`

## Configuración Recomendada

### Para Sitios con Pocos Leads
```typescript
{
  maxPages: 5,
  minLeadsRequired: 1,
  // Búsqueda menos agresiva
}
```

### Para Sitios con Muchos Leads
```typescript
{
  maxPages: 3,
  minLeadsRequired: 5,
  // Encuentra varios leads rápidamente
}
```

### Para Testing/Debug
```typescript
{
  maxPages: 2,
  minLeadsRequired: 1,
  // Límites bajos para pruebas
}
```

## Métricas y Monitoreo

### Nuevas Métricas Disponibles

1. **Páginas buscadas**: Número de páginas procesadas
2. **Razón de parada**: Por qué se detuvo la paginación
3. **Leads totales en DB**: Candidatos disponibles totales
4. **Eficiencia de filtrado**: Ratio de leads válidos por página

### Alertas Recomendadas

- **Muchas páginas buscadas**: Si `totalPagesSearched > 5`
- **Sin leads encontrados**: Si `stoppedReason = 'no_more_pages'` y `leadsFound = 0`
- **Límite alcanzado**: Si `stoppedReason = 'max_pages_reached'`

## Retrocompatibilidad

### Comportamiento por Defecto

Si no se especifican los nuevos parámetros:
- `maxPages = 10`
- `minLeadsRequired = 1`
- `pageSize = 30`

### Workflows Existentes

Los workflows existentes funcionarán sin cambios, con el beneficio automático de la paginación.

## Testing

Para probar la funcionalidad:

```typescript
// Test con límites bajos
const options = {
  site_id: "test-site",
  maxPages: 2,
  minLeadsRequired: 1
};

// Verificar que se busca en múltiples páginas si es necesario
const result = await dailyProspectionWorkflow(options);
console.log(result.paginationInfo);
```

## Impacto en Performance

### Positivo
- Encuentra leads válidos cuando antes fallaba
- Logs detallados para debugging
- Límites de seguridad previenen bucles infinitos

### Consideraciones
- Más consultas a la base de datos si se necesitan múltiples páginas
- Tiempo de ejecución ligeramente mayor cuando se necesita paginar
- Mayor uso de memoria para logs de paginación (mínimo)

