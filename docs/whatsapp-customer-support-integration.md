# WhatsApp Customer Support Integration

## Descripción General

Se ha implementado la integración entre el workflow de WhatsApp (`answerWhatsappMessageWorkflow`) y el workflow de Customer Support (`customerSupportMessageWorkflow`). Esta integración permite que los mensajes de WhatsApp que requieren atención humana o tienen alta prioridad activen automáticamente el flujo de customer support.

## Cambios Realizados

### 1. Parámetro `origin` Opcional

Se ha agregado un parámetro opcional `origin` en todo el flujo de customer support para identificar el origen del mensaje:

#### CustomerSupportMessageRequest
```typescript
export interface CustomerSupportMessageRequest {
  // ... campos existentes
  origin?: string; // "whatsapp" | "email" | etc.
}
```

#### Actividades Modificadas
- **`sendCustomerSupportMessageActivity`**: Ahora acepta y envía el parámetro `origin`
- **`customerSupportMessageWorkflow`**: Acepta `origin` en `baseParams`
- **`scheduleCustomerSupportMessagesWorkflow`**: Acepta `origin` y lo pasa a workflows hijos

### 2. Integración en WhatsApp Workflow

#### Nuevo Step 3: Customer Support Trigger
El `answerWhatsappMessageWorkflow` ahora incluye un **Step 3** que:

1. **Evalúa si el mensaje requiere customer support**:
   - `analysis.requires_action === true`
   - `analysis.priority === 'high'`
   - `analysis.intent === 'complaint'`

2. **Mapea datos de WhatsApp a formato EmailData**:
   - Convierte `WhatsAppAnalysisResponse` a `EmailData`
   - Mapea intents de WhatsApp a intents de EmailData
   - Incluye información de contacto extraída del análisis

3. **Inicia workflow de customer support como child workflow**:
   - Con `origin: "whatsapp"`
   - Policy: `PARENT_CLOSE_POLICY_ABANDON`
   - Espera el resultado pero no falla si customer support falla

#### Función Helper: mapWhatsAppIntentToEmailIntent
```typescript
function mapWhatsAppIntentToEmailIntent(
  whatsappIntent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'greeting' | 'follow_up' | 'unknown'
): 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request' | undefined
```

Mapea los intents de WhatsApp a los intents válidos de EmailData.

### 3. Integración en Email Workflow

El `syncEmailsWorkflow` ahora pasa `origin: "email"` cuando llama al customer support:

```typescript
const scheduleParams = {
  // ... otros parámetros
  origin: "email" // Indica que el origen es email (syncMails)
};
```

### 4. Nuevos Campos de Respuesta

El `answerWhatsappMessageWorkflow` ahora retorna:

```typescript
{
  success: boolean;
  analyzed: boolean;
  responded: boolean;
  customerSupportTriggered?: boolean; // NUEVO
  analysis?: WhatsAppAnalysisResponse['analysis'];
  response?: { message_id?: string; sent_message?: string; };
  customerSupportResult?: { // NUEVO
    success: boolean;
    processed: boolean;
    workflowId?: string;
  };
  error?: string;
  workflow_id: string;
}
```

## Flujo de Integración

### Secuencia Completa

1. **WhatsApp Message** → `answerWhatsappMessageWorkflow`
2. **Step 1**: Análisis del mensaje via `/api/agents/whatsapp/analyze`
3. **Step 2**: Respuesta automática (si está habilitada)
4. **Step 3**: Evaluación para customer support
   - Si requiere atención → Inicia `customerSupportMessageWorkflow`
   - Con `origin: "whatsapp"`
   - Mapea datos a formato `EmailData`
5. **Customer Support**: Llama a `/api/agents/customerSupport/message` con `origin`

### Parámetros Enviados a Customer Support API

```typescript
{
  message: string; // Summary del análisis de WhatsApp
  phone: string; // Teléfono de WhatsApp
  name?: string; // Nombre del contacto (si disponible)
  email?: string; // Email del contacto (si disponible del análisis)
  site_id: string;
  userId: string;
  agentId?: string;
  lead_id?: string; // analysis_id si está disponible
  lead_notification: "none", // Para evitar duplicar notificaciones
  origin: "whatsapp" // NUEVO - identifica el origen
}
```

## Criterios de Activación

El customer support se activa cuando:

```typescript
analysis && (
  analysis.requires_action || 
  analysis.priority === 'high' || 
  analysis.intent === 'complaint'
)
```

## Testing

### Script de Pruebas
- **Archivo**: `src/scripts/test-whatsapp-customer-support.ts`
- **Comando**: `npm run test:whatsapp-cs`

### Casos de Prueba
1. **Mensaje urgente**: Debe activar customer support
2. **Mensaje simple**: NO debe activar customer support  
3. **Verificación de origin**: Verifica que `origin: "whatsapp"` se envía correctamente

## Configuración de Orígenes

| Origen | Workflow | Parámetro Origin |
|--------|----------|------------------|
| WhatsApp | `answerWhatsappMessageWorkflow` | `"whatsapp"` |
| Email | `syncEmailsWorkflow` → `scheduleCustomerSupportMessagesWorkflow` | `"email"` |

## Ventajas de la Integración

1. **Trazabilidad**: El API de customer support conoce el origen del mensaje
2. **Automatización**: Mensajes urgentes se escalan automáticamente
3. **Flexibilidad**: Cada origen puede tener lógica específica
4. **Escalabilidad**: Fácil agregar nuevos orígenes en el futuro
5. **Robustez**: Fallas en customer support no afectan el workflow principal

## Archivos Modificados

- `src/temporal/activities/customerSupportActivities.ts`
- `src/temporal/workflows/scheduleCustomerSupportMessagesWorkflow.ts`
- `src/temporal/workflows/syncEmailsWorkflow.ts`
- `src/temporal/workflows/answerWhatsappMessageWorkflow.ts`
- `src/scripts/test-whatsapp-customer-support.ts` (nuevo)
- `package.json`
- `docs/whatsapp-customer-support-integration.md` (nuevo)

## Compatibilidad

✅ **Backward Compatible**: Todos los cambios son opcionales y no rompen funcionalidad existente.

✅ **Type Safe**: Todos los tipos están definidos correctamente en TypeScript.

✅ **Error Handling**: Fallas en customer support no afectan el workflow principal de WhatsApp. 