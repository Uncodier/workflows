# 🚀 Deployment en Render

Esta guía te ayudará a deployar la aplicación de Temporal Workflows en Render con workers persistentes.

## 📋 Prerrequisitos

- ✅ Cuenta en [Render](https://render.com)
- ✅ Cuenta en [Temporal Cloud](https://cloud.temporal.io)
- ✅ Base de datos Supabase configurada
- ✅ Repositorio Git con el código

## 🏗️ Arquitectura en Render

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Service   │    │ Worker Service   │    │ Temporal Cloud  │
│   (Next.js)     │────│ (Always Running) │────│   Schedules &   │
│   Port: 3000    │    │ Processes Tasks  │    │   Workflows     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🔧 Configuración de Environment Variables

### 1. Crear Environment Variable Groups en Render

#### **Temporal Config**
```
TEMPORAL_SERVER_URL=<tu-server>.tmprl.cloud:7233
TEMPORAL_NAMESPACE=<tu-namespace>
TEMPORAL_API_KEY=<tu-api-key>
```

#### **Database Config**
```
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_ANON_KEY=<tu-anon-key>
```

## 📦 Pasos de Deployment

### 1. Crear Web Service

1. **Conectar repositorio** en Render Dashboard
2. **Configurar Web Service:**
   ```yaml
   Name: temporal-workflows-web
   Environment: Node
   Build Command: npm run build
   Start Command: npm run start
   Plan: Starter (o superior)
   ```

3. **Variables de entorno:**
   - `NODE_ENV=production`
   - `TEMPORAL_TLS=true`
   - `WORKFLOW_TASK_QUEUE=default`
   - Importar grupos de variables creados arriba

### 2. Crear Worker Service

1. **Nuevo servicio tipo "Background Worker"**
2. **Configurar Worker Service:**
   ```yaml
   Name: temporal-workflows-worker
   Environment: Node
   Build Command: npm run worker:build
   Start Command: npm run worker:start
   Plan: Starter (o superior)
   ```

3. **Variables de entorno:** (Mismas que Web Service)

### 3. Inicializar Schedules

Una vez deployados ambos servicios:

1. **Ejecutar manualmente en Worker Service:**
   ```bash
   npm run render:init
   ```

2. **O usar el endpoint web:**
   ```bash
   curl https://tu-app.render.com/api/schedules -X POST
   ```

## 🎯 Verificación del Deployment

### 1. Verificar Web Service
```bash
curl https://tu-app.render.com/api/health
```

### 2. Verificar Worker
- Revisar logs del Worker Service en Render Dashboard
- Buscar mensajes como: `✅ Worker created successfully`

### 3. Verificar Schedules
- Ir a Temporal UI: `https://cloud.temporal.io`
- Navegar a tu namespace
- Verificar que aparezcan los schedules creados

## 📊 Monitoring y Logs

### Render Dashboard
- **Web Service Logs:** Para requests HTTP y API calls
- **Worker Service Logs:** Para execución de workflows y activities

### Temporal UI
- **Workflows:** Ver execuciones en tiempo real
- **Schedules:** Verificar próximas ejecuciones
- **Activities:** Monitorear tasks individuales

## 🔄 Schedules Configurados

| Schedule | Cron | Descripción |
|----------|------|-------------|
| `central-schedule-activities` | `0 0 * * *` | Daily workflow orchestration |
| `sync-emails-schedule-manager` | `0 */1 * * *` | Email sync every hour |

## 🐛 Troubleshooting

### Worker no se conecta a Temporal
```bash
# Verificar en logs del Worker Service:
ERROR: Failed to start worker
```

**Solución:**
1. Verificar `TEMPORAL_SERVER_URL` (incluir puerto `:7233`)
2. Verificar `TEMPORAL_API_KEY` (sin espacios extra)
3. Confirmar `TEMPORAL_NAMESPACE` correcto

### Schedules no se crean
**Síntomas:** Worker conectado pero no hay schedules en Temporal UI

**Solución:**
1. Ejecutar manualmente: `npm run render:init`
2. Verificar logs del comando de inicialización
3. Confirmar permisos del API key

### Workflows fallan
**Síntomas:** Schedules creados pero workflows fallan

**Solución:**
1. Verificar variables de Supabase
2. Revisar logs de activities específicas
3. Comprobar conectividad a APIs externas

## 📞 Comandos Útiles

```bash
# Reiniciar worker
npm run render:worker

# Recrear schedules
npm run render:init

# Ejecutar workflow manualmente
npm run workflow:execute

# Listar schedules
npm run schedule:list

# Logs en tiempo real (en Render Dashboard)
# Ir a: Worker Service > Logs
```

## 🚀 Ventajas de Render

- ✅ **Workers persistentes** (no serverless)
- ✅ **Auto-scaling** según carga
- ✅ **Zero-downtime deployments**
- ✅ **Monitoring integrado**
- ✅ **Compatible con Temporal** oficialmente
- ✅ **Costos predecibles**

## 📈 Escalabilidad

### Starter Plan
- ✅ 1 worker instance
- ✅ Ideal para desarrollo/testing
- ✅ ~100 workflows/hora

### Standard Plan
- ✅ Auto-scaling
- ✅ Mayor CPU/memoria
- ✅ Miles de workflows/hora

---

¿Necesitas ayuda? Revisa los logs en Render Dashboard o contacta al equipo de desarrollo. 