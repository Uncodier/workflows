# Temporal Services

Este directorio contiene servicios centralizados para interactuar con APIs externas y otras dependencias.

## API Service

El `apiService` es un servicio centralizado para realizar llamadas a APIs externas con autenticación automática usando el header `x-api-key`.

### Configuración

El servicio requiere las siguientes variables de entorno en `.env.local`:

```env
API_BASE_URL=https://your-api-domain.com
API_KEY=your-api-key-here
```

### Uso

```typescript
import { apiService } from '../services/apiService';

// GET request
const response = await apiService.get('/api/endpoint');
if (response.success) {
  console.log(response.data);
} else {
  console.error(response.error);
}

// POST request
const postResponse = await apiService.post('/api/create', {
  name: 'New Resource',
  type: 'example'
});

// PUT request
const putResponse = await apiService.put('/api/update/123', {
  name: 'Updated Resource'
});

// DELETE request
const deleteResponse = await apiService.delete('/api/delete/123');
```

### Características

- **Autenticación automática**: Agrega automáticamente el header `x-api-key` con el valor de `API_KEY`
- **Manejo de errores**: Retorna una estructura consistente con `success` y `error`/`data`
- **Timeout**: Implementa timeout de 30 segundos por defecto
- **Logging**: Logs automáticos de requests y responses para debugging
- **URL building**: Maneja automáticamente las barras diagonales en URLs

### Estructura de respuesta

```typescript
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;           // Presente cuando success: true
  error?: {           // Presente cuando success: false
    code: string;
    message: string;
    status?: number;
  };
}
```

### Migración desde implementaciones anteriores

Si tienes código que usa `fetch` directamente para llamadas a APIs externas, deberías migrar a usar `apiService`:

**Antes:**
```typescript
const response = await fetch(`${API_BASE_URL}/api/endpoint`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`, // ❌ Incorrecto
  },
  body: JSON.stringify(data),
});
```

**Después:**
```typescript
const response = await apiService.post('/api/endpoint', data);
if (!response.success) {
  throw new Error(response.error?.message);
}
return response.data;
```

### Servicios relacionados

- `supabaseService`: Para interacciones con Supabase
- `emailConfigService`: Para configuración de email
- `emailSyncSchedulingService`: Para scheduling de sincronización de emails 