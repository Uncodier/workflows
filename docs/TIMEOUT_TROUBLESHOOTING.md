# Troubleshooting Timeouts en Customer Support

## 🚨 Error Típico

```
API call failed: 500 Internal Server Error. 
{
  "success":false,
  "error":{
    "code":"COMMAND_EXECUTION_FAILED",
    "message":"The command did not complete successfully in the expected time"
  }
}
```

## 🔍 Diagnóstico Rápido

### 1. Ejecutar Script de Diagnóstico

```bash
npm run diagnose:customer-support
```

Este script:
- ✅ Prueba conectividad básica
- ⏱️ Mide latencia de la API
- 🎯 Prueba diferentes timeouts
- 📊 Proporciona recomendaciones

### 2. Revisar Logs de Temporal

Buscar en los logs del worker:
```bash
grep "⏱️ API call completed" logs/
grep "🚨 TIMEOUT DETECTED" logs/
```

## 🔧 Soluciones

### Solución 1: Aumentar Timeout (Ya Implementado)

Los timeouts se han centralizado en `src/temporal/config/timeouts.ts`:

```typescript
export const ACTIVITY_TIMEOUTS = {
  CUSTOMER_SUPPORT: '5 minutes', // ✅ Aumentado de 2 a 5 minutos
  // ...
}
```

### Solución 2: Ajustar Retry Policy

Si sigue fallando, ajustar en `timeouts.ts`:

```typescript
export const RETRY_POLICIES = {
  CUSTOMER_SUPPORT: {
    maximumAttempts: 2, // Menos intentos para timeouts
    backoffCoefficient: 2.0,
    initialIntervalMs: 5000,
    maximumIntervalMs: 60000,
  },
}
```

### Solución 3: Fix de agentId (Ya Implementado)

**Problema**: La API externa estaba recibiendo `agentId: undefined` y usando valor por defecto.

**Solución**: Omitir completamente el campo `agentId` cuando no viene explícito:

```typescript
// ❌ ANTES: Enviaba agentId: undefined
const messageRequest = {
  message: message,
  agentId: agentId, // Esto enviaba undefined
  // ...
};

// ✅ AHORA: Solo incluye agentId cuando tiene valor
const messageRequest = { /* campos base */ };

if (agentId) {
  messageRequest.agentId = agentId; // Solo cuando está definido
}
```

Para probar el comportamiento:
```bash
npm run test:agent-id-behavior
```

### Solución 4: Monitoring de API Externa

Verificar el estado de la API de customer support:
- 📊 CPU/memoria del servidor
- 🔄 Procesamiento de IA (puede ser lento)
- 🌐 Conectividad de red

## 📋 Configuración Actual

| Componente | Timeout | Retry |
|------------|---------|-------|
| Customer Support Activity | 5 minutos | 2 intentos |
| Email Operations | 3 minutos | 3 intentos |
| WhatsApp Operations | 2 minutos | 3 intentos |

## 🚀 Si Aumentar Timeout No Resuelve

1. **Optimizar API Externa**: Revisar logs de la API de customer support
2. **Implementar Circuit Breaker**: Evitar cascadas de fallos
3. **Async Processing**: Considerar procesamiento asíncrono para customer support
4. **Caching**: Cachear respuestas comunes del agente

## 🔄 Archivos Modificados

- ✅ `src/temporal/workflows/customerSupportWorkflow.ts` - Timeout aumentado y config centralizada
- ✅ `src/temporal/workflows/sendEmailFromAgentWorkflow.ts` - Config centralizada
- ✅ `src/temporal/workflows/sendWhatsappFromAgentWorkflow.ts` - Config centralizada  
- ✅ `src/temporal/activities/customerSupportActivities.ts` - Mejor logging, diagnóstico y **agentId fix**
- ✅ `src/temporal/config/timeouts.ts` - Configuración centralizada de timeouts
- ✅ `scripts/diagnose-customer-support-api.js` - Script de diagnóstico completo
- ✅ `src/scripts/test-agent-id-behavior.ts` - Test para verificar comportamiento de agentId
- ✅ `package.json` - Comandos `npm run diagnose:customer-support` y `npm run test:agent-id-behavior`

## 🎯 Próximos Pasos

Si el problema persiste después de estas mejoras:

1. Ejecutar diagnóstico: `npm run diagnose:customer-support`
2. Revisar logs de la API externa
3. Considerar arquitectura asíncrona para customer support
4. Implementar fallback responses 