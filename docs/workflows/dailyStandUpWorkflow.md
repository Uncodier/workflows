# Daily Stand Up Workflow

## Descripción

El `dailyStandUpWorkflow` es un workflow de Temporal que ejecuta el stand up diario del CMO (Chief Marketing Officer). Este workflow coordina múltiples análisis independientes y los consolida en un resumen ejecutivo final.

## Flujo del Workflow

### 1. Inicialización
- Valida los parámetros de entrada
- Obtiene información del sitio
- Configura el tracking y logging del workflow

### 2. Análisis Independientes

El workflow ejecuta 4 análisis principales que pueden ejecutarse de forma secuencial o paralela:

#### 2.1 System Analysis (`/api/cmo/dailyStandUp/system`)
- Analiza settings del sistema
- Revisa estado de billing
- Evalúa aspectos básicos del sistema
- Detecta problemas o alertas

#### 2.2 Sales Analysis (`/api/cmo/dailyStandUp/sales`)
- Obtiene resumen del agente de ventas
- Analiza métricas de conversión
- Revisa pipeline de ventas
- Identifica oportunidades

#### 2.3 Support Analysis (`/api/cmo/dailyStandUp/support`)
- Analiza tareas pendientes de soporte
- Revisa conversaciones recientes
- Evalúa satisfacción del cliente
- Identifica patrones de problemas

#### 2.4 Growth Analysis (`/api/cmo/dailyStandUp/growth`)
- Revisa contenidos publicados
- Analiza experimentos en curso
- Evalúa métricas de crecimiento
- Identifica oportunidades de optimización

### 3. Consolidación Final

#### 3.1 Wrap Up (`/api/cmo/dailyStandUp/wrapUp`)
- Junta todas las memorias del command_id compartido
- Genera resumen ejecutivo consolidado
- Proporciona recomendaciones estratégicas
- Crea plan de acción diario

## Parámetros de Entrada

```typescript
interface DailyStandUpOptions {
  site_id: string;                    // Required: ID del sitio
  userId?: string;                    // Optional: ID del usuario
  additionalData?: any;               // Optional: datos adicionales
  runParallel?: boolean;              // Optional: ejecutar análisis en paralelo
}
```

## Resultado del Workflow

```typescript
interface DailyStandUpResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  command_id?: string;               // ID del comando compartido
  systemAnalysis?: any;              // Resultado del análisis de sistema
  salesAnalysis?: any;               // Resultado del análisis de ventas
  supportAnalysis?: any;             // Resultado del análisis de soporte
  growthAnalysis?: any;              // Resultado del análisis de crecimiento
  finalSummary?: string;             // Resumen final consolidado
  data?: any;                        // Todos los datos recopilados
  errors: string[];
  executionTime: string;
  completedAt: string;
}
```

## Modos de Ejecución

### Modo Secuencial (Default)
```typescript
const options = {
  site_id: 'site-123',
  runParallel: false  // default
};
```

Los análisis se ejecutan uno después del otro, compartiendo el mismo `command_id`:
1. System → 2. Sales → 3. Support → 4. Growth → 5. Wrap Up

### Modo Paralelo
```typescript
const options = {
  site_id: 'site-123',
  runParallel: true
};
```

Los análisis (1-4) se ejecutan simultáneamente, luego se ejecuta el Wrap Up:
1. System + Sales + Support + Growth (paralelo) → 2. Wrap Up

## Memoria Compartida

Todos los análisis comparten el mismo `command_id` que se genera en el primer análisis exitoso. Esto permite que:

- El sistema de agent_memory pueda relacionar todas las observaciones
- El wrap-up tenga acceso a toda la información recopilada
- Se mantenga contexto entre diferentes análisis
- Se pueda hacer seguimiento de decisiones a lo largo del tiempo

## Ejemplo de Uso

### Básico
```typescript
import { getTemporalClient } from '../temporal/client';
import { dailyStandUpWorkflow } from '../temporal/workflows/dailyStandUpWorkflow';

const client = await getTemporalClient();

const result = await client.workflow.execute(dailyStandUpWorkflow, {
  args: [{
    site_id: 'site-12345',
    userId: 'user-67890'
  }],
  taskQueue: 'default',
  workflowId: `daily-standup-${Date.now()}`
});

console.log('Resultado:', result);
```

### Con Configuración Avanzada
```typescript
const result = await client.workflow.execute(dailyStandUpWorkflow, {
  args: [{
    site_id: 'site-12345',
    userId: 'user-67890',
    runParallel: true,
    additionalData: {
      requestedBy: 'cmo',
      priority: 'high',
      includeRecommendations: true,
      focusAreas: ['sales', 'support']
    }
  }],
  taskQueue: 'default',
  workflowId: 'daily-standup-cmo'
});
```

## Manejo de Errores

El workflow está diseñado para ser resiliente:

- Si falla un análisis individual, los otros continúan
- Los errores se recopilan en el array `errors`
- El workflow siempre intenta ejecutar el wrap-up si hay al menos un `command_id`
- El resultado incluye información parcial even si algunos análisis fallan

## Monitoreo y Logging

El workflow registra:
- Inicio y fin de cada análisis
- Tiempo de ejecución de cada paso
- Errores y excepciones
- Estado del cron para seguimiento
- Métricas de performance

## APIs Requeridas

Para que el workflow funcione, deben estar implementadas las siguientes rutas:

```
POST /api/cmo/dailyStandUp/system
POST /api/cmo/dailyStandUp/sales
POST /api/cmo/dailyStandUp/support
POST /api/cmo/dailyStandUp/growth
POST /api/cmo/dailyStandUp/wrapUp
```

Todas las rutas deben:
- Aceptar `site_id` y opcionalmente `command_id`
- Retornar `{ success: boolean, command_id: string, summary: string, data: any }`
- Guardar sus memorias en agent_memory con el `command_id`

## Scripts de Prueba

```bash
# Ejecutar test completo
npm run test:daily-standup

# Ejecutar ejemplo
node examples/dailyStandUpWorkflow-example.js

# Ver ayuda del ejemplo
node examples/dailyStandUpWorkflow-example.js --help
```

## Programación Automática

El workflow puede ser programado para ejecutarse automáticamente:

```typescript
// Ejemplo de programación diaria a las 9:00 AM
await scheduleRecurringWorkflow({
  workflowType: 'dailyStandUpWorkflow',
  schedule: '0 9 * * *', // Cron expression
  args: [{ site_id: 'site-123' }]
});
```

## Casos de Uso

1. **Stand-up diario del CMO**: Resumen ejecutivo matutino
2. **Monitoreo continuo**: Detección temprana de problemas
3. **Optimización de procesos**: Identificación de oportunidades
4. **Reportes ejecutivos**: Información consolidada para toma de decisiones
5. **Alertas automáticas**: Notificación de situaciones que requieren atención

## Consideraciones de Performance

- **Modo Paralelo**: Reduce tiempo de ejecución ~60-70%
- **Timeout**: 10 minutos por análisis individual
- **Reintentos**: Máximo 3 intentos por análisis
- **Memoria**: Los datos se almacenan en agent_memory, no en memoria del workflow 