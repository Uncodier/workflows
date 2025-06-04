# Workflow ExecuteTool para Temporal

## Descripción
Este workflow permite ejecutar herramientas API personalizadas de manera distribuida y confiable usando Temporal. Reemplaza la ejecución local directa de herramientas por una ejecución en workflow que permite retry automático, monitoreo y escalabilidad.

## Características

- ✅ **Retry automático** con configuración personalizable
- ✅ **Monitoreo y logging** integrado
- ✅ **Escalabilidad** distribuida
- ✅ **Manejo de errores** robusto
- ✅ **Autenticación flexible** (Bearer, ApiKey)
- ✅ **Mapeo de respuestas** personalizable
- ✅ **Soporte para URLs locales y remotas**
- ✅ **Detección automática de servicios** en desarrollo

## Instalación

```bash
# Las dependencias ya están instaladas en el proyecto
npm install @temporalio/workflow @temporalio/worker @temporalio/client axios
```

## Configuración

### Variables de Entorno

```env
# Temporal Configuration
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TLS=false
TEMPORAL_API_KEY=your_temporal_api_key

# API Keys para herramientas
SERVICE_API_KEY=your_service_api_key
SUPPORT_API_TOKEN=your_support_api_token
WEATHER_API_KEY=your_weather_api_key

# Configuración de entorno
NODE_ENV=development
API_BASE_URL=https://your-api-base-url.com
PORT=3000
```

## Uso Básico

### 1. Importar el Cliente

```typescript
import { TemporalToolExecutor } from '../temporal/client/temporalToolExecutor';
import type { ExecuteToolInput } from '../temporal/workflows/executeToolWorkflow';
```

### 2. Crear una Instancia del Ejecutor

```typescript
const executor = new TemporalToolExecutor();
```

### 3. Ejecutar una Herramienta

```typescript
const input: ExecuteToolInput = {
  toolName: 'get-weather',
  args: {
    location: 'Madrid',
    units: 'metric'
  },
  apiConfig: {
    endpoint: {
      url: 'https://api.openweathermap.org/data/2.5/weather',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      requiresAuth: true,
      authType: 'ApiKey'
    }
  },
  environment: {
    WEATHER_API_KEY: process.env.WEATHER_API_KEY
  }
};

const result = await executor.executeTool(input);
```

## Ejemplos de Uso

### Ejemplo 1: API Externa con Autenticación

```typescript
const weatherInput: ExecuteToolInput = {
  toolName: 'get-weather',
  args: {
    location: 'Madrid',
    units: 'metric'
  },
  apiConfig: {
    endpoint: {
      url: 'https://api.openweathermap.org/data/2.5/weather',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'appid': '{{WEATHER_API_KEY}}'
      },
      requiresAuth: true,
      authType: 'ApiKey'
    },
    responseMapping: {
      temperature: 'main.temp',
      description: 'weather[0].description',
      city: 'name'
    }
  },
  environment: {
    WEATHER_API_KEY: process.env.WEATHER_API_KEY
  }
};
```

### Ejemplo 2: API Local con Parámetros en URL

```typescript
const userInput: ExecuteToolInput = {
  toolName: 'get-user',
  args: {
    userId: '123',
    include: 'profile,settings'
  },
  apiConfig: {
    endpoint: {
      url: '/api/users/{userId}',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer {{SERVICE_API_KEY}}',
        'Content-Type': 'application/json'
      },
      requiresAuth: true,
      authType: 'Bearer'
    },
    responseMapping: {
      id: 'data.id',
      name: 'data.name',
      email: 'data.email'
    }
  },
  environment: {
    NODE_ENV: 'development',
    PORT: '3000',
    SERVICE_API_KEY: process.env.SERVICE_API_KEY
  }
};
```

### Ejemplo 3: POST con Manejo de Errores

```typescript
const createTaskInput: ExecuteToolInput = {
  toolName: 'create-task',
  args: {
    title: 'Nueva Tarea',
    description: 'Descripción de la tarea',
    priority: 'high'
  },
  apiConfig: {
    endpoint: {
      url: '/api/tasks',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '{{SERVICE_API_KEY}}'
      },
      requiresAuth: true,
      authType: 'ApiKey'
    },
    errors: {
      400: { message: 'error.message', code: 'BAD_REQUEST' },
      401: { message: 'error.details', code: 'UNAUTHORIZED' },
      404: { message: 'error.message', code: 'NOT_FOUND' },
      500: { message: 'error.message', code: 'SERVER_ERROR' }
    }
  },
  environment: {
    SERVICE_API_KEY: process.env.SERVICE_API_KEY
  }
};
```

## Configuración del Workflow

### Parámetros de Retry

El workflow está configurado con los siguientes parámetros de retry:

```typescript
{
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    maximumInterval: '30s',
    maximumAttempts: 3,
  },
}
```

### Task Queue

El workflow utiliza la cola `execute-tool-queue` por defecto.

## Estructura de Respuesta

```typescript
interface ExecuteToolResult {
  success: boolean;
  data?: any;           // Datos de respuesta (mapeados si se especifica)
  error?: string;       // Mensaje de error si falló
  statusCode?: number;  // Código de estado HTTP
  url?: string;         // URL final utilizada
}
```

## Ejecutar Pruebas

```bash
# Ejecutar el script de pruebas
npm run test:execute-tool

# Ejecutar el worker en desarrollo
npm run worker:dev

# Ejecutar todo el stack en desarrollo
npm run dev:all
```

## Integración con el API Principal

Para usar desde tu API principal:

```typescript
import { TemporalToolExecutor } from './temporal/client/temporalToolExecutor';

// En tu handler/controller
const executor = new TemporalToolExecutor();

app.post('/api/execute-tool', async (req, res) => {
  try {
    const { toolName, args, apiConfig, environment } = req.body;
    
    const result = await executor.executeTool({
      toolName,
      args,
      apiConfig,
      environment
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Monitoreo

Puedes monitorear los workflows desde:
- **Temporal Web UI**: `http://localhost:8080` (desarrollo)
- **Logs del Worker**: Información detallada de ejecución
- **Temporal Cloud**: Si usas Temporal Cloud en producción

## Limitaciones

- Timeout máximo: 5 minutos por ejecución
- Máximo 3 intentos de retry por defecto
- Solo soporta métodos HTTP estándar (GET, POST, PUT, DELETE, PATCH)

## Troubleshooting

### Error: "Cannot find module"
Asegúrate de que el worker esté corriendo con las activities registradas.

### Error: "ECONNREFUSED"
Para APIs locales, el workflow intentará automáticamente diferentes puertos (3000, 3001, 8080).

### Error: "Workflow timeout"
Aumenta el `startToCloseTimeout` si tu API tarda más de 5 minutos. 