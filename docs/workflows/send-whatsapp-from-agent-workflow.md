# Send WhatsApp From Agent Workflow

## Descripción General

El `sendWhatsappFromAgent` es un workflow de Temporal diseñado para enviar mensajes de WhatsApp a través del API de agentes. Este workflow proporciona una interfaz confiable y trazable para el envío de mensajes de WhatsApp desde agentes o sistemas automatizados.

## Características Principales

### ✨ Funcionalidades

1. **Envío Directo**: Envía mensajes de WhatsApp usando el endpoint `/api/agents/tools/sendWhatsApp`
2. **Validación de Parámetros**: Valida parámetros requeridos antes del envío
3. **Trazabilidad Completa**: Logs detallados y métricas de tiempo de ejecución
4. **Manejo de Errores**: Gestión robusta de errores con mensajes descriptivos
5. **Flexibilidad**: Soporte para parámetros opcionales como agent_id, conversation_id, lead_id

## API Endpoint Utilizado

### 📤 Envío de WhatsApp
- **Endpoint**: `POST /api/agents/tools/sendWhatsApp`
- **Función**: Envía mensajes de WhatsApp a través del sistema de agentes

## Interfaces de Datos

### SendWhatsAppFromAgentParams
```typescript
interface SendWhatsAppFromAgentParams {
  phone_number: string;    // Requerido: Número de teléfono en formato internacional
  message: string;         // Requerido: Contenido del mensaje
  site_id: string;         // Requerido: ID del sitio para configuración de WhatsApp
  from?: string;           // Opcional: Nombre del remitente (default: "AI Assistant")
  agent_id?: string;       // Opcional: ID del agente que envía el mensaje
  conversation_id?: string; // Opcional: ID de la conversación
  lead_id?: string;        // Opcional: ID del lead asociado
}
```

### SendWhatsAppFromAgentResult
```typescript
interface SendWhatsAppFromAgentResult {
  success: boolean;        // Indica si el envío fue exitoso
  messageId: string;       // ID del mensaje enviado
  recipient: string;       // Número de teléfono del destinatario
  executionTime: string;   // Tiempo de ejecución del workflow
  timestamp: string;       // Timestamp del envío
}
```

## Uso del Workflow

### 1. Mensaje Básico con Parámetros Mínimos

```typescript
import { getTemporalClient } from '../temporal/client';

const client = await getTemporalClient();

const params = {
  phone_number: "+573001234567",
  message: "Hola! Gracias por contactarnos. Un miembro de nuestro equipo se pondrá en contacto contigo pronto.",
  site_id: "your-site-id"
};

const result = await client.workflow.execute('sendWhatsappFromAgent', {
  args: [params],
  taskQueue: 'default',
  workflowId: `send-whatsapp-${Date.now()}`,
});
```

### 2. Mensaje Completo con Todos los Parámetros

```typescript
const params = {
  phone_number: "+573001234567",
  message: "Estimado cliente, hemos recibido tu consulta y nuestro equipo está revisando tu caso.",
  site_id: "your-site-id",
  from: "Customer Support",
  agent_id: "agent-123",
  conversation_id: "conv-456",
  lead_id: "lead-789"
};

const result = await client.workflow.execute('sendWhatsappFromAgent', {
  args: [params],
  taskQueue: 'default',
  workflowId: `send-whatsapp-support-${Date.now()}`,
});
```

### 3. Uso via API Endpoint

**POST** `/api/execute-workflow`

```json
{
  "workflowType": "sendWhatsappFromAgent",
  "args": [{
    "phone_number": "+573001234567",
    "message": "¡Hola! Te confirmamos que tu cita ha sido programada para mañana a las 10:00 AM.",
    "site_id": "site_123456",
    "from": "AI Assistant",
    "agent_id": "agent_789",
    "conversation_id": "conv_456",
    "lead_id": "lead_123"
  }],
  "options": {
    "timeout": "5m"
  }
}
```

### Response

```json
{
  "success": true,
  "workflowId": "sendWhatsappFromAgent-1703123456789-xyz123",
  "workflowType": "sendWhatsappFromAgent",
  "status": "started",
  "message": "Workflow started successfully",
  "duration": "180ms",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Validación de Parámetros

### Parámetros Requeridos
- `phone_number`: Debe estar en formato internacional (ej: +573001234567)
- `message`: No puede estar vacío
- `site_id`: Requerido para la configuración de WhatsApp

### Parámetros Opcionales
- `from`: Si no se proporciona, usa "AI Assistant" por defecto
- `agent_id`: Para trazabilidad y logging
- `conversation_id`: Para asociar con conversaciones existentes
- `lead_id`: Para asociar con leads específicos

## Casos de Uso

### 1. Notificaciones Automáticas
```typescript
const notificationParams = {
  phone_number: "+573001234567",
  message: "Tu pedido #12345 ha sido enviado y llegará mañana entre 9:00 AM y 6:00 PM.",
  site_id: "ecommerce-site",
  from: "E-commerce Bot"
};
```

### 2. Seguimiento de Customer Support
```typescript
const supportParams = {
  phone_number: "+573001234567",
  message: "Hemos recibido tu reporte de problema. Nuestro equipo técnico está trabajando en una solución.",
  site_id: "support-site",
  from: "Technical Support",
  agent_id: "support-agent-001",
  conversation_id: "support-conv-123"
};
```

### 3. Confirmaciones de Citas
```typescript
const appointmentParams = {
  phone_number: "+573001234567",
  message: "Te recordamos tu cita médica programada para mañana a las 3:00 PM. Por favor confirma tu asistencia.",
  site_id: "medical-clinic",
  from: "Clínica Médica",
  lead_id: "patient-456"
};
```

## Testing

### Script de Pruebas
- **Archivo**: `src/scripts/test-send-whatsapp-from-agent.ts`
- **Comando**: `npm run test:send-whatsapp`

### Casos de Prueba Incluidos
1. **Mensaje único**: Prueba envío de un mensaje individual
2. **Parámetros mínimos**: Prueba con solo los campos requeridos
3. **Validación**: Prueba manejo de errores con parámetros faltantes
4. **Lote de mensajes**: Prueba envío de múltiples mensajes con intervalos

## Manejo de Errores

### Errores Comunes
- **Parámetros faltantes**: `Missing required WhatsApp parameters`
- **API failure**: `Failed to send WhatsApp message: [error details]`
- **Network issues**: `WhatsApp sending failed: [network error]`

### Logs de Ejemplo
```
📱 Starting send WhatsApp from agent workflow...
📤 Sending WhatsApp via agent API: {
  recipient: "+573001234567",
  from: "AI Assistant",
  messageLength: 85,
  site_id: "site_123",
  agent_id: "agent_456"
}
✅ WhatsApp sent successfully via agent API: {
  messageId: "whatsapp_msg_789",
  recipient: "+573001234567",
  executionTime: "245ms"
}
```

## Integración con Otros Workflows

### Customer Support Integration
El workflow puede ser llamado desde `customerSupportMessageWorkflow` para enviar notificaciones de WhatsApp:

```typescript
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';

// En customer support workflow
if (contactInfo.phone && shouldSendWhatsApp) {
  const whatsappParams = {
    phone_number: contactInfo.phone,
    message: "Hemos recibido tu consulta y te contactaremos pronto.",
    site_id: siteId,
    from: "Customer Support",
    agent_id: agentId,
    lead_id: leadId
  };
  
  await startChild(sendWhatsappFromAgent, {
    args: [whatsappParams],
    workflowId: `whatsapp-followup-${leadId}`,
  });
}
```

## Configuración y Deployment

### Variables de Entorno
El workflow utiliza la configuración del `apiService` que requiere:
- API base URL configurada
- Autenticación apropiada para el endpoint de WhatsApp

### Task Queue
- **Default**: `default`
- **Timeout**: 2 minutos para la actividad
- **Retry**: Configuración estándar de Temporal

## Ventajas del Workflow

1. **Confiabilidad**: Temporal garantiza la ejecución y reintentos automáticos
2. **Trazabilidad**: Logs completos y métricas de tiempo de ejecución
3. **Escalabilidad**: Puede manejar múltiples mensajes concurrentemente
4. **Flexibilidad**: Soporte para diferentes tipos de mensajes y contextos
5. **Integración**: Fácil integración con otros workflows y sistemas

## Archivos Relacionados

- `src/temporal/workflows/sendWhatsappFromAgentWorkflow.ts` - Workflow principal
- `src/temporal/activities/whatsappActivities.ts` - Actividad de envío
- `src/scripts/test-send-whatsapp-from-agent.ts` - Script de pruebas
- `package.json` - Script npm `test:send-whatsapp`

## Compatibilidad

✅ **Type Safe**: Interfaces TypeScript completamente tipadas

✅ **Error Handling**: Manejo robusto de errores y validaciones

✅ **Logging**: Logs detallados para debugging y monitoreo

✅ **Testing**: Suite completa de pruebas incluida 