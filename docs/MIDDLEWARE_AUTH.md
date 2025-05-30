# Middleware de Autenticación por API Key

Este middleware protege todos los endpoints de la API en producción mediante autenticación por API key.

## Ubicación del Middleware

El middleware está duplicado en dos ubicaciones para máxima compatibilidad con diferentes plataformas de deployment:

- `/middleware.ts` (raíz del proyecto) - Para Render y otros servicios
- `/src/middleware.ts` (carpeta src) - Para Vercel y proyectos con estructura src

Next.js automáticamente detecta y usa el middleware desde cualquiera de estas ubicaciones.

## Configuración

### Variables de Entorno

Asegúrate de configurar la variable de entorno `API_KEY` en tu archivo `.env.local`:

```env
API_KEY=tu-api-key-super-secreta
```

### Comportamiento por Entorno

#### Desarrollo (`NODE_ENV !== 'production'`)
- Los endpoints públicos definidos funcionan sin autenticación
- Se mantiene la compatibilidad con el desarrollo local

#### Producción (`NODE_ENV === 'production'`)
- **TODOS** los endpoints `/api/*` requieren autenticación
- Se debe incluir un header válido con la API key

## Uso

### Headers Soportados

El middleware acepta la API key en dos formatos de header:

#### 1. Header `x-api-key`
```bash
curl -H "x-api-key: tu-api-key-super-secreta" \
     https://tu-dominio.com/api/workflows
```

#### 2. Header `authorization`
```bash
# Solo la API key
curl -H "authorization: tu-api-key-super-secreta" \
     https://tu-dominio.com/api/workflows

# Formato Bearer
curl -H "authorization: Bearer tu-api-key-super-secreta" \
     https://tu-dominio.com/api/workflows
```

### Respuestas de Error

#### API Key no configurada (500)
```json
{
  "error": "Server configuration error"
}
```

#### API Key inválida o faltante (401)
```json
{
  "error": "Unauthorized",
  "message": "Valid API key required in x-api-key or authorization header"
}
```

## Endpoints Afectados

En producción, todos los endpoints que empiecen con `/api/` requieren autenticación:

- `/api/workflows`
- `/api/workflows/execute`
- `/api/schedules`
- `/api/health`
- `/api/status`
- Y cualquier otro endpoint futuro bajo `/api/`

## Consideraciones de Seguridad

1. **Mantén la API key segura**: No la incluyas en el código fuente ni en repositorios públicos
2. **Usa HTTPS**: La API key se envía en headers, asegúrate de usar conexiones seguras
3. **Rotación de keys**: Considera rotar la API key periódicamente
4. **Logging**: El middleware no loggea la API key por seguridad

## Testing

Para probar el middleware localmente en modo producción:

```bash
NODE_ENV=production npm run dev
```

Luego realiza requests con y sin la API key para verificar el comportamiento. 