# Daily Strategic Accounts Workflow

## Descripción

El `dailyStrategicAccountsWorkflow` es un flujo automatizado que se enfoca en la prospección de cuentas estratégicas de alta calidad en las principales capitales del mundo. Este workflow es una variante especializada del `dailyProspectionWorkflow` que utiliza criterios de búsqueda específicos para empresas clave.

## Características Principales

### 🌍 Generación de Leads Estratégicos
- Utiliza la actividad `callRegionSearchApiActivity` con parámetros específicos:
  - **Region**: `"world"` - Búsqueda global en principales capitales
  - **Keywords**: `"key accounts"` - Enfoque en cuentas estratégicas y empresas clave
  - **Search Type**: `"strategic_accounts"` - Tipo de búsqueda especializada

### 📡 Validación de Canales de Comunicación
- Verifica que el sitio tenga configurados canales de email o WhatsApp
- Filtra leads basado en la disponibilidad de información de contacto compatible

### 🎯 Procesamiento Inteligente
- Envía leads generados al agente de ventas para selección y priorización
- Asigna leads de alta prioridad a representantes humanos
- Procesa automáticamente leads no asignados

### 🔄 Seguimiento Automatizado
- Inicia workflows de seguimiento para leads estratégicos no asignados a humanos
- Mantiene tracking completo del proceso de prospección

## Parámetros de Configuración

```typescript
interface DailyStrategicAccountsOptions {
  site_id: string;                    // Required: Site ID
  userId?: string;                    // Optional: User ID
  maxLeads?: number;                  // Límite de leads a procesar (default: 100)
  createTasks?: boolean;              // Crear tareas (default: true)
  updateStatus?: boolean;             // Actualizar status de leads (default: false)
  additionalData?: any;               // Datos adicionales
}
```

## Resultado del Workflow

```typescript
interface DailyStrategicAccountsResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  strategicCriteria: {
    region: string;                   // "world"
    keywords: string;                 // "key accounts"
    searchType: string;               // "strategic_accounts"
  };
  leadsGenerated: number;             // Leads estratégicos generados
  leadsProcessed: number;             // Leads procesados
  tasksCreated: number;               // Tareas creadas
  statusUpdated: number;              // Status actualizados
  assignedLeads: any[];              // Leads asignados a humanos
  followUpWorkflowsStarted: number;   // Workflows de seguimiento iniciados
  channelFilteringInfo: object;       // Info del filtrado por canales
  errors: string[];                   // Errores encontrados
  executionTime: string;              // Tiempo de ejecución
  completedAt: string;                // Timestamp de finalización
}
```

## Diferencias con Daily Prospection Workflow

| Aspecto | Daily Prospection | Daily Strategic Accounts |
|---------|------------------|-------------------------|
| **Fuente de Leads** | Base de datos existente | Generación vía IA con region search |
| **Criterios** | Leads > 48h, status 'new' | Region "world", keywords "key accounts" |
| **Enfoque** | Prospección general | Cuentas estratégicas globales |
| **Alcance** | Local/Regional | Global (capitales mundiales) |
| **Calidad** | Leads estándar | Leads de alta calidad/estratégicos |

## Uso

### Script de Prueba
```bash
# Ejecutar test del workflow
npm run test-daily-strategic-accounts
```

### Variables de Entorno Requeridas
```bash
export TEST_SITE_ID="your-site-id"
export TEST_USER_ID="your-user-id" # opcional
```

### Ejecución Programática
```typescript
import { getTemporalClient } from '../temporal/client';
import type { DailyStrategicAccountsOptions } from '../temporal/workflows/dailyStrategicAccountsWorkflow';

const client = await getTemporalClient();

const options: DailyStrategicAccountsOptions = {
  site_id: 'your-site-id',
  maxLeads: 20,
  createTasks: true,
  updateStatus: false
};

const handle = await client.workflow.start('dailyStrategicAccountsWorkflow', {
  args: [options],
  taskQueue: 'default',
  workflowId: `daily-strategic-accounts-${siteId}-${Date.now()}`,
  workflowRunTimeout: '15m'
});

const result = await handle.result();
```

## Monitoreo y Logs

El workflow incluye logging detallado en cada paso:
- 🎯 Inicio del workflow
- 📡 Validación de canales de comunicación
- 🏢 Información del sitio
- 🌍 Generación de leads estratégicos vía region search
- 🔍 Filtrado por canales de comunicación
- 🎯 Procesamiento por agente de ventas
- 📋 Asignación de leads prioritarios
- 👥 Procesamiento individual de leads
- 🔄 Inicio de workflows de seguimiento
- 📊 Resumen final con estadísticas

## Programación

Este workflow está diseñado para ejecutarse de forma programada (similar a `dailyProspectionWorkflow`) para mantener un flujo constante de prospección de cuentas estratégicas de alta calidad.

## Consideraciones

- ⏱️ **Timeout extendido**: 15 minutos (vs 10 min del prospection estándar) debido a la generación de leads
- 🌐 **Alcance global**: Enfocado en capitales mundiales y empresas internacionales
- 💎 **Calidad premium**: Leads de mayor valor potencial que la prospección estándar
- 🔄 **Integración completa**: Compatible con todo el ecosistema de workflows existente 