# Troubleshooting Guide - Temporal Worker en Vercel

## Problema Actual
El worker de Temporal está fallando inmediatamente en Vercel con código de salida 1, y los schedules no se están creando.

## Diagnóstico Rápido

### 1. Ejecutar Diagnóstico Local
```bash
npm run diagnose
```

### 2. Verificar Status en Vercel
Visita: `https://tu-deployment.vercel.app/api/status`

### 3. Revisar Logs de Vercel
En el dashboard de Vercel, revisa los logs de la función `/api/worker`

## Problemas Comunes y Soluciones

### 1. Variables de Entorno Faltantes
**Síntomas:** Error "TEMPORAL_SERVER_URL is required"

**Solución:**
- Verifica que todas las variables estén configuradas en Vercel:
  - `TEMPORAL_SERVER_URL`
  - `TEMPORAL_NAMESPACE`
  - `TEMPORAL_API_KEY`
  - `TEMPORAL_TLS=true`
  - `WORKFLOW_TASK_QUEUE`

### 2. Archivos Compilados Faltantes
**Síntomas:** Error "Cannot find module '../dist/scripts/start-worker'"

**Solución:**
- Asegúrate de que el build command en Vercel sea: `npm run build:all && npm run schedule:create-all`
- Verifica que el directorio `dist/` se esté generando correctamente

### 3. Problemas de Conexión a Temporal
**Síntomas:** Connection timeout o authentication errors

**Solución:**
- Verifica las credenciales de Temporal Cloud
- Asegúrate de que TLS esté habilitado
- Revisa que el namespace sea correcto

### 4. Worker Timeout en Serverless
**Síntomas:** Function timeout después de 10 segundos

**Solución:**
- El `vercel.json` ya está configurado con `maxDuration: 300`
- El worker ahora retorna inmediatamente y ejecuta en background

### 5. Schedules No Se Crean
**Síntomas:** Worker inicia pero no hay schedules

**Solución:**
- Verifica que `npm run schedule:create-all` se ejecute durante el build
- Revisa los logs del build process en Vercel
- Ejecuta manualmente: `npm run schedule:list` para verificar

## Comandos de Debugging

### Local
```bash
# Diagnóstico completo
npm run diagnose

# Verificar build
npm run build:all

# Crear schedules manualmente
npm run schedule:create-all

# Listar schedules existentes
npm run schedule:list

# Ejecutar worker localmente
npm run worker:dev
```

### Vercel
```bash
# Deploy con logs detallados
vercel --debug

# Ver logs en tiempo real
vercel logs --follow
```

## Estructura de Logs

Los logs ahora incluyen:
- `=== Worker serverless function triggered ===`
- `=== Attempting to load worker module ===`
- `=== Worker startup completed successfully ===`
- `=== Worker startup failed ===`

Busca estos marcadores para identificar dónde falla el proceso.

## Configuración Actual

### vercel.json
- Build command: `npm run build:all && npm run schedule:create-all`
- Max duration: 300 segundos para worker
- Cron job: cada 5 minutos

### Flujo de Ejecución
1. Vercel ejecuta build command
2. Se compila TypeScript a JavaScript
3. Se crean los schedules
4. Cron job llama `/api/worker` cada 5 minutos
5. Worker se inicia en background

## Próximos Pasos

1. **Verificar Variables de Entorno:** Asegúrate de que todas las variables estén configuradas en Vercel
2. **Revisar Build Logs:** Verifica que el build process complete exitosamente
3. **Monitorear Function Logs:** Revisa los logs de `/api/worker` para errores específicos
4. **Probar Conexión:** Usa `/api/status` para verificar conectividad a Temporal

## Contacto
Si el problema persiste, incluye:
- Output de `npm run diagnose`
- Logs de Vercel function
- Response de `/api/status` 