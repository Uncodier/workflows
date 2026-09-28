# Email Validation Implementation - validateEmail Tool Integration

> **Histórico (no aplica al despliegue AKS actual):** esta guía describe la
> antigua integración con endpoint de agentes/NeverBounce. Consulte
> [REOON_AKS_INCIDENT.md](./REOON_AKS_INCIDENT.md) para el código y la política
> de validación de Reoon activos.

## Resumen

Se ha implementado una nueva funcionalidad que valida emails usando la herramienta `/api/agents/tools/validateEmail` antes de enviar correos en el `leadFollowUpWorkflow`. Esta implementación incluye lógica inteligente para manejar diferentes escenarios de invalidación basados en los métodos de contacto alternativos disponibles.

## Componentes Implementados

### 1. Nueva Actividad: `validateContactInformation`

**Ubicación:** `src/temporal/activities/apiActivities.ts`

```typescript
validateContactInformation(request: {
  email?: string;
  hasEmailMessage?: boolean;
  hasWhatsAppMessage?: boolean;
  leadId?: string;
  phone?: string;
}): Promise<{
  success: boolean;
  isValid: boolean;
  result?: string;
  flags?: string[];
  suggested_correction?: string;
  execution_time?: number;
  message?: string;
  error?: string;
}>
```

**Funcionalidad:**
- Acepta contexto completo (email, teléfono, mensajes disponibles)
- Llama a `/api/agents/tools/validateEmail` para validar emails
- Procesa la respuesta del servicio de validación
- Maneja errores de la API gracefulmente
- Toma decisiones inteligentes basadas en métodos de contacto alternativos
- Preparado para futuras validaciones (WhatsApp, etc.)
- Retorna información detallada sobre la validación y decisiones

### 2. Nueva Actividad: `invalidateEmailOnlyActivity`

**Ubicación:** `src/temporal/activities/leadActivities.ts`

```typescript
invalidateEmailOnlyActivity(request: {
  lead_id: string;
  failed_email: string;
  userId?: string;
}): Promise<{ success: boolean; error?: string }>
```

**Funcionalidad:**
- Elimina únicamente el campo `email` del lead
- Preserva el `site_id` y otros datos
- Se usa cuando el lead tiene métodos de contacto alternativos (WhatsApp)

### 3. Integración en `leadFollowUpWorkflow`

**Ubicación:** `src/temporal/workflows/leadFollowUpWorkflow.ts`

**Flujo de validación:**

1. **Antes del envío de email:** Se valida el email con `/api/agents/tools/validateEmail`
2. **Si la validación falla:** Se procede con el envío (servicio no disponible)
3. **Si el email es inválido:**
   - Se obtiene información del lead para verificar WhatsApp
   - **Si tiene WhatsApp:** Solo se elimina el email (`invalidateEmailOnlyActivity`)
   - **Si no tiene WhatsApp:** Se ejecuta invalidación completa (`leadInvalidationWorkflow`)
4. **Si el email es válido:** Se procede con el envío normal

## Casos de Uso

### Escenario 1: Email Válido
```
Email: valid@example.com
Resultado: isValid = true
Acción: Envío normal del email
```

### Escenario 2: Email Inválido + Lead con WhatsApp
```
Email: invalid@fake.domain
Lead phone: +34600123456
Resultado: isValid = false
Acción: 
- Eliminar email del lead
- Preservar site_id
- Continuar con WhatsApp si hay mensaje disponible
```

### Escenario 3: Email Inválido + Lead sin WhatsApp
```
Email: invalid@fake.domain
Lead phone: null
Resultado: isValid = false
Acción: 
- Ejecutar leadInvalidationWorkflow completo
- Eliminar site_id
- Agregar metadata de invalidación
```

### Escenario 4: Servicio de Validación No Disponible
```
Email: test@example.com
Validación: service_error
Acción: Proceder con envío de email (fallback)
```

## Respuesta Esperada de validateEmail

```json
{
  "success": true,
  "data": {
    "email": "xxx@500.co",
    "isValid": true,
    "deliverable": false,
    "result": "catchall",
    "flags": [
      "catchall_domain",
      "catchall_detected",
      "confidence_100%"
    ],
    "suggested_correction": null,
    "execution_time": 6506,
    "message": "Email accepted but domain is catchall (100% confidence) - delivery uncertain",
    "timestamp": "2025-08-18T18:41:52.716Z",
    "bounceRisk": "low",
    "reputationFlags": [],
    "riskFactors": [],
    "confidence": 65,
    "confidenceLevel": "medium",
    "reasoning": [
      "SMTP server accepts email (+30)",
      "Low bounce risk domain (+10)",
      "Catchall domain detected (-25)"
    ],
    "aggressiveMode": false
  }
}
```

## Logging y Monitoreo

El workflow incluye logging detallado para facilitar el debugging:

- `🔍 Step 5.2.1: Validating email with validateEmail tool`
- `✅ Email is valid` / `❌ Email is invalid`
- `📱 Lead has WhatsApp: true/false`
- `📧🚫 Lead has WhatsApp, invalidating only email field`
- `🚫 Lead has no WhatsApp, using full lead invalidation workflow`

## Manejo de Errores

- **Timeout de validación:** 5 minutos con 3 reintentos
- **Servicio no disponible:** Fallback a envío normal
- **Error de API:** Se logea y continúa con envío
- **Error de invalidación:** Se logea pero no bloquea el workflow

## Testing

Se ha creado un script de prueba en `src/scripts/test-email-validation-workflow.ts` que permite:

- Probar la actividad de validación directamente
- Simular diferentes escenarios
- Verificar el comportamiento esperado

## Consideraciones de Rendimiento

- La validación se ejecuta solo cuando se va a enviar un email
- Se implementa antes del timer de 2 horas para evitar esperas innecesarias
- Fallback rápido si el servicio no está disponible
- No bloquea otros canales de comunicación (WhatsApp)

## Configuración Requerida

Asegúrese de que:
1. La API `/api/agents/tools/validateEmail` esté disponible
2. Las credenciales de NeverBounce estén configuradas
3. Los timeouts estén ajustados apropiadamente

## Mejoras Futuras

- Cache de validaciones para emails recurrentes
- Métricas de accuracy del servicio
- Configuración de diferentes niveles de validación
- Integración con otros servicios de validación como backup