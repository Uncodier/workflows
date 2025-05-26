# Configuración de Temporal Cloud para Deployment en Vercel

## Cuándo usar TEMPORAL_API_KEY

El `TEMPORAL_API_KEY` se usa cuando te conectas a **Temporal Cloud** (conexión remota) en lugar de una instancia local de Temporal Server.

### Conexión Local vs Remota

#### Conexión Local (Desarrollo)
```bash
TEMPORAL_SERVER_URL=localhost:7233
TEMPORAL_NAMESPACE=default
# No necesitas TEMPORAL_API_KEY ni TLS
```

#### Conexión Remota (Temporal Cloud - Producción)
```bash
TEMPORAL_SERVER_URL=your-namespace.tmprl.cloud:7233
TEMPORAL_NAMESPACE=your-namespace
TEMPORAL_API_KEY=your-temporal-cloud-api-key
TEMPORAL_TLS=true
```

## Configuración para Vercel

### 1. Crear cuenta en Temporal Cloud
1. Ve a [Temporal Cloud](https://temporal.io/cloud)
2. Crea una cuenta y un namespace
3. Genera un API key desde el dashboard

### 2. Configurar Variables de Entorno en Vercel
En tu proyecto de Vercel, agrega estas variables de entorno:

```bash
TEMPORAL_SERVER_URL=your-namespace.tmprl.cloud:7233
TEMPORAL_NAMESPACE=your-namespace
TEMPORAL_API_KEY=your-temporal-cloud-api-key
TEMPORAL_TLS=true
WORKFLOW_TASK_QUEUE=default
```

### 3. Verificar la Conexión
Después del deployment, puedes verificar la conexión visitando:
```
https://your-vercel-app.vercel.app/api/status
```

Deberías ver algo como:
```json
{
  "status": "ok",
  "temporal": {
    "connected": true,
    "address": "your-namespace.tmprl.cloud:7233",
    "tls": true,
    "hasApiKey": true
  }
}
```

## Solución al Error "Failed to start worker"

El error que estás viendo:
```
{"message":"Failed to start worker","error":{}}
Node.js process exited with exit status: 1
```

Generalmente se debe a:

### 1. Variables de entorno faltantes
Asegúrate de que todas las variables estén configuradas en Vercel:
- `TEMPORAL_SERVER_URL`
- `TEMPORAL_NAMESPACE` 
- `TEMPORAL_API_KEY`
- `TEMPORAL_TLS=true`

### 2. Configuración de TLS incorrecta
Para Temporal Cloud, siempre necesitas TLS habilitado.

### 3. API Key inválido
Verifica que el API key sea correcto y tenga los permisos necesarios.

### 4. Namespace incorrecto
El namespace debe coincidir exactamente con el configurado en Temporal Cloud.

## Debugging

### Logs detallados
Para ver logs más detallados, agrega:
```bash
LOG_LEVEL=debug
```

### Verificar conexión manualmente
Puedes usar el endpoint `/api/status` para verificar si la conexión a Temporal está funcionando.

## Arquitectura en Vercel

En Vercel, el worker se ejecuta como una función serverless que:
1. Se conecta a Temporal Cloud usando TLS y API key
2. Procesa tareas del task queue configurado
3. Se mantiene activo mediante cron jobs de Vercel

## Ejemplo de .env.local para Temporal Cloud

```bash
# Temporal Cloud Configuration
TEMPORAL_SERVER_URL=my-namespace.tmprl.cloud:7233
TEMPORAL_NAMESPACE=my-namespace
TEMPORAL_API_KEY=tcld_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TEMPORAL_TLS=true
WORKFLOW_TASK_QUEUE=default

# Other configurations...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key
LOG_LEVEL=info
```

## Notas Importantes

1. **Nunca** commits el API key en el código
2. Usa variables de entorno de Vercel para producción
3. El TLS se habilita automáticamente cuando se detecta un API key
4. La conexión local no requiere API key ni TLS 