# Cron Index - Workflows Programados por Cron

Este archivo define qué workflows están realmente programados para ejecutarse por cron schedules y por lo tanto deben guardar registros de `cron_status`.

## ⚠️ IMPORTANTE

Solo los workflows listados en este archivo deben guardar registros en la tabla `cron_status`. Los workflows de orquestación (schedules principales y motores de priorización) NO necesitan guardar cron_status ya que no son los workflows de trabajo real.

## Workflows Programados por Cron

### 1. Schedules Principales (Definidos en `/src/temporal/schedules/index.ts`)

#### `scheduleActivitiesWorkflow`
- **Schedule ID**: `central-schedule-activities`
- **Frecuencia**: Cada 24 horas
- **Descripción**: Workflow central que orquesta otros workflows
- **Ejecuta como children**:
  - `activityPrioritizationEngineWorkflow`
  - `sendReportWorkflow`

#### `syncEmailsScheduleWorkflow`
- **Schedule ID**: `sync-emails-schedule-manager`
- **Frecuencia**: Cada 60 minutos (1 hora)
- **Descripción**: Programa workflows de sincronización de emails para todos los sitios

### 2. Child Workflows Ejecutados por Cron (Indirectamente)

#### `activityPrioritizationEngineWorkflow`
- **Ejecutado por**: `scheduleActivitiesWorkflow` (child workflow)
- **Descripción**: Motor de priorización que decide si ejecutar operaciones diarias
- **Ejecuta como children**:
  - `dailyOperationsWorkflow` (condicionalmente)
- **Programa workflows mediante actividades**:
  - `dailyProspectionWorkflow` (vía `executeDailyProspectionWorkflowsActivity`)
  - `leadGenerationWorkflow` (vía `scheduleIndividualLeadGenerationActivity`)
  - `dailyStandUpWorkflow` (vía `scheduleIndividualDailyStandUpsActivity`)
  - `analyzeSiteWorkflow` (vía `scheduleIndividualSiteAnalysisActivity`)

#### `dailyOperationsWorkflow`
- **Ejecutado por**: `activityPrioritizationEngineWorkflow` (child workflow)
- **Descripción**: Workflow de monitoreo de operaciones diarias
- **Nota**: Solo se ejecuta si el motor de priorización lo determina

#### `syncEmailsWorkflow`
- **Ejecutado por**: `syncEmailsScheduleWorkflow` (programado dinámicamente)
- **Descripción**: Sincronización de emails para sitios individuales

### 3. Workflows Programados por el Sistema de Cron (Indirectamente)

Estos workflows son ejecutados por actividades que forman parte del pipeline de cron:

#### `dailyProspectionWorkflow`
- **Programado por**: `activityPrioritizationEngineWorkflow` → `executeDailyProspectionWorkflowsActivity`
- **Descripción**: Prospección diaria de leads para sitios individuales

#### `leadGenerationWorkflow`
- **Programado por**: `activityPrioritizationEngineWorkflow` → `scheduleIndividualLeadGenerationActivity`  
- **Descripción**: Generación de leads para sitios individuales

#### `dailyStandUpWorkflow`
- **Programado por**: `activityPrioritizationEngineWorkflow` → `scheduleIndividualDailyStandUpsActivity`
- **Descripción**: Daily standup del CMO para sitios individuales

#### `analyzeSiteWorkflow`
- **Programado por**: `activityPrioritizationEngineWorkflow` → `scheduleIndividualSiteAnalysisActivity`
- **Descripción**: Análisis individual de sitios para configuraciones y optimizaciones

## Lista de Workflows que DEBEN Guardar cron_status

```typescript
const CRON_SCHEDULED_WORKFLOWS = [
  'syncEmailsWorkflow',                   // Programado dinámicamente
  'dailyProspectionWorkflow',             // Programado por activityPrioritizationEngineWorkflow
  'leadGenerationWorkflow',               // Programado por activityPrioritizationEngineWorkflow
  'dailyStrategicAccountsWorkflow',       // Strategic accounts workflow
  'dailyStandUpWorkflow',                 // Programado por activityPrioritizationEngineWorkflow
  'analyzeSiteWorkflow'                   // Programado por activityPrioritizationEngineWorkflow
];
```

## Workflows que NO Deben Guardar cron_status

Todos los demás workflows del sistema, incluyendo:

**Workflows de Orquestación (no guardan cron_status):**
- `scheduleActivitiesWorkflow` (schedule principal - solo orquesta)
- `syncEmailsScheduleWorkflow` (schedule principal - solo orquesta)
- `activityPrioritizationEngineWorkflow` (motor de decisión - solo orquesta)
- `dailyOperationsWorkflow` (monitoreo - solo orquesta)

**Workflows Ejecutados Manualmente:**
- `buildCampaignsWorkflow`
- `deepResearchWorkflow`  
- `leadFollowUpWorkflow`
- `leadInvalidationWorkflow`
- Todos los workflows de agentes (`sendWhatsappFromAgent`, `sendEmailFromAgent`, etc.)
- Workflows de análisis (`buildSegmentsWorkflow`, etc.)
- Workflows de contenido (`buildContentWorkflow`, `sendNewsletterWorkflow`, etc.)
- Workflows de soporte (`customerSupportMessageWorkflow`, etc.)

## Cómo Mantener Este Archivo

### Al Agregar un Nuevo Schedule de Cron

1. Actualizar la sección "Schedules Principales" si es un schedule raíz
2. Actualizar la sección "Child Workflows Ejecutados por Cron" si es un child workflow
3. Agregar el nombre del workflow a la lista `CRON_SCHEDULED_WORKFLOWS`
4. Actualizar el código en `/src/temporal/activities/cronActivities.ts`

### Al Remover un Schedule de Cron

1. Remover de las secciones correspondientes
2. Remover de la lista `CRON_SCHEDULED_WORKFLOWS`
3. Actualizar el código en `/src/temporal/activities/cronActivities.ts`

### Al Cambiar la Arquitectura de Schedules

1. Revisar y actualizar toda la documentación
2. Verificar que la lista `CRON_SCHEDULED_WORKFLOWS` sea correcta
3. Probar que solo workflows programados por cron guarden `cron_status`

## Verificación

Para verificar que este índice está actualizado:

1. Revisar `/src/temporal/schedules/index.ts` para schedules activos
2. Revisar workflows que llaman `startChild` para identificar children
3. Revisar logs de producción para ver qué workflows están guardando `cron_status`
4. Ejecutar tests que validen la lógica de filtrado

## Última Actualización

**Fecha**: 2024-12-19  
**Por**: Assistant  
**Motivo**: Agregado analyzeSiteWorkflow que también es programado por activityPrioritizationEngineWorkflow vía scheduleIndividualSiteAnalysisActivity.
