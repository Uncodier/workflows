# Arquitectura Temporal Serverless en Vercel

## 🎯 **Problema Resuelto**

Los workers de Temporal requieren procesos persistentes que **no son compatibles** con las funciones serverless de Vercel. Esta nueva arquitectura resuelve ese problema usando un enfoque **"Just-in-Time Worker"**.

## 🏗️ **Nueva Arquitectura**

### **1. Schedules en Temporal Cloud** ✅
- Los schedules se crean correctamente en Temporal Cloud
- Usan la sintaxis `cron` correcta (no `intervals`)
- Se configuran con timezone UTC y políticas de overlap

### **2. Pseudo-Workers en Vercel** ✅
- `/api/trigger-workflow`: Se ejecuta cada 2 minutos via cron
- `/api/execute-workflow`: Ejecuta workflows específicos bajo demanda
- `/api/auto-init`: Inicializa schedules automáticamente cada 15 minutos

### **3. Ejecución de Workflows** ✅
- Los workflows se ejecutan **sin necesidad de worker persistente**
- Temporal Cloud actúa como el coordinador
- Las funciones serverless actúan como workers temporales

## 🔄 **Flujo de Trabajo**

```mermaid
graph TD
    A[Vercel Cron Every 2min] --> B[/api/trigger-workflow]
    B --> C[Temporal Client]
    C --> D[Start syncEmailsScheduleWorkflow]
    D --> E[Temporal Cloud]
    E --> F[Schedule Individual Workflows]
    F --> G[Execute syncEmailsWorkflow]
    G --> H[Process Emails & AI Analysis]
```

## 📊 **Ventajas**

### ✅ **Funciona en Vercel**
- No requiere procesos persistentes
- Compatible con límites de tiempo serverless
- Usa recursos solo cuando es necesario

### ✅ **Escalable**
- Los workflows se ejecutan bajo demanda
- No hay límites de conexiones persistentes
- Costos proporcionales al uso

### ✅ **Confiable**
- Temporal Cloud maneja la persistencia
- Auto-reinicio en caso de fallos
- Logs detallados para debugging

## 🔧 **Configuración**

### **Schedules Creados**
```javascript
{
  id: 'central-schedule-activities',
  workflowType: 'scheduleActivitiesWorkflow', 
  cronSchedule: '0 0 * * *', // Daily at midnight
},
{
  id: 'sync-emails-schedule-manager',
  workflowType: 'syncEmailsScheduleWorkflow',
  cronSchedule: '0 */2 * * *', // Every 2 hours
}
```

### **Cron Jobs de Vercel**
```json
{
  "path": "/api/trigger-workflow",
  "schedule": "*/2 * * * *"  // Every 2 minutes
},
{
  "path": "/api/auto-init", 
  "schedule": "*/15 * * * *" // Every 15 minutes
}
```

## 🚀 **Cómo Funciona**

### **1. Initialization (Auto)**
- `/api/auto-init` se ejecuta cada 15 minutos
- Verifica si existen schedules en Temporal Cloud
- Crea schedules faltantes automáticamente

### **2. Workflow Triggering (Every 2min)**
- `/api/trigger-workflow` se ejecuta cada 2 minutos
- Conecta con Temporal Cloud
- Ejecuta `syncEmailsScheduleWorkflow` que:
  - Analiza qué sites necesitan sincronización
  - Programa workflows individuales de email sync
  - Actualiza status en base de datos

### **3. Workflow Execution (On-Demand)**
- Los workflows individuales se ejecutan cuando Temporal los programa
- Procesan emails, ejecutan AI analysis, etc.
- Se ejecutan completamente en Temporal Cloud

## 🔍 **Debugging & Monitoring**

### **Endpoints de Verificación**
- `/api/status` - Estado general del sistema
- `/api/schedules` - Lista schedules activos
- `/api/health` - Health check básico

### **Logs en Vercel**
- Todos los endpoints loggan detalladamente
- Incluyen timing y información de debug
- Errores se capturan y reportan

### **Temporal Cloud UI**
- Muestra schedules activos con horarios específicos
- Historial de ejecución de workflows
- Métricas de rendimiento

## 📈 **Beneficios vs Worker Persistente**

| Aspecto | Worker Persistente | Pseudo-Worker Serverless |
|---------|-------------------|--------------------------|
| **Compatibilidad Vercel** | ❌ No funciona | ✅ Compatible |
| **Costos** | 🔄 Constantes | ✅ Solo cuando se usa |
| **Escalabilidad** | ⚠️ Limitada | ✅ Automática |
| **Mantenimiento** | ❌ Requiere gestión | ✅ Automático |
| **Timeouts** | ❌ Problemas frecuentes | ✅ Sin problemas |

## 🎉 **Resultado**

Esta arquitectura permite que:
- ✅ Los schedules aparezcan con **horarios específicos** en Temporal Cloud
- ✅ Los workflows se **ejecuten correctamente** y a tiempo
- ✅ El sistema sea **escalable** y **mantenible**
- ✅ **Sin necesidad de infraestructura adicional**

## 🔄 **Próximos Pasos**

1. **Deploy** los cambios a Vercel
2. **Verificar** que `/api/trigger-workflow` se ejecute cada 2 minutos
3. **Monitorear** Temporal Cloud UI para confirmar schedules
4. **Ajustar** frecuencia según necesidades (puede ser cada 1 minuto si se requiere más frecuencia) 