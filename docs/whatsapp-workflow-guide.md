# WhatsApp Message Workflow Guide

## Descripción General

El `answerWhatsappMessageWorkflow` es un workflow de Temporal diseñado para procesar mensajes de WhatsApp entrantes a través de un flujo de customer support integrado. Este workflow delega todo el procesamiento al `customerSupportMessageWorkflow`, el cual automáticamente ejecuta el workflow de envío apropiado (`sendEmailFromAgent` o `sendWhatsappFromAgent`) según el origen del mensaje.

> **📧 Nota sobre Emails**: Para el procesamiento de emails con análisis de IA, consulta la [Sync Mails Workflow Guide](./sync-mails-workflow-guide.md).

## Arquitectura del Flujo

### 🔄 Flujo Simplificado

```
WhatsApp Message
       ↓
answerWhatsappMessageWorkflow
       ↓
customerSupportMessageWorkflow
   (customer support + envío automático)
       ↓ (automático basado en origen)
   ┌─ origin="email" → sendEmailFromAgent (ver sync-mails-workflow-guide.md)
   └─ origin="whatsapp" → sendWhatsappFromAgent
```

## Características Principales

### ✨ Funcionalidades

1. **Procesamiento Directo**: Los mensajes de WhatsApp se procesan directamente sin análisis previo
2. **Envío Automático**: `customerSupportMessageWorkflow` detecta el origen y ejecuta el workflow de envío apropiado
3. **Arquitectura Centralizada**: Lógica unificada para email y WhatsApp en un solo workflow
4. **Trazabilidad Completa**: IDs únicos para cada workflow hijo y logs detallados
5. **Procesamiento en Lotes**: Procesa múltiples mensajes con intervalos configurables
6. **Manejo Robusto de Errores**: Cada workflow falla independientemente

### 🔄 Workflows Involucrados

#### 1. `answerWhatsappMessageWorkflow` (Principal)
Orquesta todo el flujo de procesamiento de mensajes de WhatsApp.

#### 2. `customerSupportMessageWorkflow` (Centralizado)
- Maneja el procesamiento de customer support
- **Detecta automáticamente el origen** (email vs whatsapp)
- **Ejecuta automáticamente** el workflow de envío apropiado:
  - `origin="email"` → `sendEmailFromAgent`
  - `origin="whatsapp"` → `sendWhatsappFromAgent`

#### 3. `processWhatsAppMessagesWorkflow` (Batch)
Procesa múltiples mensajes de WhatsApp en lotes con intervalos.

## Lógica de Ejecución Centralizada

### Customer Support Workflow (Centralizado)
1. **Detecta el origen** basado en `baseParams.origin`
2. **Email Origin**: 
   - Procesa como email (con análisis existente)
   - Si exitoso → ejecuta `sendEmailFromAgent`
3. **WhatsApp Origin**:
   - Procesa directamente sin análisis
   - Si exitoso → ejecuta `sendWhatsappFromAgent`

### Beneficios de la Centralización
- ✅ **Lógica unificada** para ambos canales
- ✅ **Procesamiento directo** para WhatsApp (sin análisis innecesario)
- ✅ **Análisis inteligente** para Emails (ver [sync-mails-workflow-guide.md](./sync-mails-workflow-guide.md))
- ✅ **Mantenimiento simplificado** 
- ✅ **Consistencia** en el comportamiento
- ✅ **Trazabilidad centralizada**

## Diferencias con Sistema de Emails

| Aspecto | WhatsApp | Emails (syncMails) |
|---------|----------|-------------------|
| **Procesamiento** | Directo | Con análisis de IA |
| **Documentación** | Esta guía | [sync-mails-workflow-guide.md](./sync-mails-workflow-guide.md) |
| **APIs** | sendWhatsApp | sendEmail + análisis |
| **Priorización** | Tratamiento uniforme | Por sentiment/priority |

## Estructura de Respuesta

### Mensaje Individual
```typescript
{
  success: boolean;
  customerSupportTriggered?: boolean;
  customerSupportResult?: {
    success: boolean;
    processed: boolean;
    workflowId: string;
    reason: string;
    // Campos específicos según el origen
    emailSent?: boolean;        // Para origin="email"
    emailWorkflowId?: string;   // Para origin="email"
    whatsappSent?: boolean;     // Para origin="whatsapp"
    whatsappWorkflowId?: string; // Para origin="whatsapp"
  };
  error?: string;
  workflow_id: string;
}
```

### Procesamiento en Lotes
```typescript
{
  totalMessages: number;
  processed: number;
  customerSupportTriggered: number;
  whatsappSent: number;  // Solo para WhatsApp workflows
  failed: number;
  results: Array<{
    index: number;
    phone: string;
    success: boolean;
    customerSupportTriggered: boolean;
    whatsappSent: boolean;
    error?: string;
    workflowId: string;
  }>;
  executionTime: string;
}
```

## Configuración Automática de Envío

### Para WhatsApp (origin="whatsapp")
```typescript
// Automáticamente ejecutado por customerSupportMessageWorkflow
const whatsappParams = {
  phone_number: whatsappData.phoneNumber,
  message: response.data?.messages?.assistant?.content || 'Mensaje por defecto',
  site_id: whatsappData.siteId,
  from: 'Customer Support',
  agent_id: baseParams.agentId,
  conversation_id: whatsappData.conversationId,
  lead_id: whatsappData.messageId
};
```

### Para Email (origin="email")
```typescript
// Automáticamente ejecutado por customerSupportMessageWorkflow
const emailParams = {
  email: emailData.contact_info.email,
  subject: response.data?.conversation_title || 'Re: Your inquiry',
  message: response.data?.messages?.assistant?.content || 'Mensaje por defecto',
  site_id: emailData.site_id,
  agent_id: baseParams.agentId,
  lead_id: emailData.analysis_id
};
```

## Casos de Uso

### 1. **Flujo WhatsApp Completo**
```
Entrada: "Hola, quisiera información sobre sus productos"
↓
answerWhatsappMessageWorkflow
↓
customerSupportMessageWorkflow (origin="whatsapp")
  ├─ Procesamiento directo (sin análisis)
  ├─ Customer support
  └─ sendWhatsappFromAgent (automático)
↓
Resultado: WhatsApp de seguimiento enviado
```

### 2. **Flujo Email Completo**
```
Entrada: Email de consulta
↓
scheduleCustomerSupportMessagesWorkflow
↓
customerSupportMessageWorkflow (origin="email")
  ├─ Procesamiento con análisis existente
  ├─ Customer support
  └─ sendEmailFromAgent (automático)
↓
Resultado: Email de seguimiento enviado
```

## Integración con Otros Workflows

### Flujos de Entrada
1. **WhatsApp**: `answerWhatsappMessageWorkflow` → `customerSupportMessageWorkflow`
2. **Email**: `scheduleCustomerSupportMessagesWorkflow` → `customerSupportMessageWorkflow`
3. **API Directo**: Llamada directa a `customerSupportMessageWorkflow`

### Flujos de Salida (Automáticos)
1. **origin="whatsapp"** → `sendWhatsappFromAgent`
2. **origin="email"** → `sendEmailFromAgent`

### Data Flow Unificado
```
[WhatsApp | Email | API] → customerSupportMessageWorkflow → [sendWhatsappFromAgent | sendEmailFromAgent] → Analytics
```

## Monitoreo y Logs

### Logs del Workflow Principal
```
📱 Starting WhatsApp message workflow...
🎯 Triggering Customer Support workflow directly...
✅ Customer support workflow started: whatsapp-customer-support-{id}
📱 Starting sendWhatsappFromAgent workflow - customer support was successful...
✅ Follow-up WhatsApp sent via workflow: send-whatsapp-agent-{id}
✅ WhatsApp message workflow completed successfully
```

### Logs del Customer Support (WhatsApp)
```
🎯 Starting customer support message workflow...
📱 Detected WhatsApp message - processing directly
🔍 No analysis provided - analyzing WhatsApp message...
📞 Processing WhatsApp message for customer support...
📱 Starting sendWhatsappFromAgent workflow - customer support was successful...
✅ WhatsApp customer support message workflow completed successfully
```

### Métricas Unificadas
- **Customer Support Triggered**: Workflows de customer support iniciados
- **WhatsApp Sent**: Respuestas de WhatsApp enviadas (para workflows de WhatsApp)
- **Email Sent**: Emails enviados (para workflows de email)
- **Success Rate**: Porcentaje de mensajes procesados exitosamente
- **End-to-End Time**: Tiempo total desde entrada hasta envío

## Ventajas de la Arquitectura Simplificada

### 🚀 Beneficios Operacionales
- **Menos Complejidad**: Un solo punto de entrada para customer support
- **Mantenimiento Reducido**: Lógica centralizada para ambos canales
- **Consistencia**: Comportamiento uniforme entre email y WhatsApp
- **Escalabilidad**: Fácil agregar nuevos canales (SMS, etc.)

### 🔧 Beneficios Técnicos
- **Reducción de Código**: Eliminación de lógica duplicada
- **Trazabilidad Mejorada**: Flujo lineal más fácil de seguir
- **Testing Simplificado**: Menos paths de código para probar
- **Debugging Facilitado**: Un solo workflow para depurar

### 📊 Beneficios de Negocio
- **Respuestas Consistentes**: Misma calidad en ambos canales
- **Tiempo de Respuesta**: Procesamiento automático más rápido
- **Experiencia Unificada**: Comportamiento predecible para usuarios

## Migración desde Arquitectura Anterior

### Cambios en answerWhatsappMessageWorkflow
- ❌ **Eliminado**: Manejo directo de `sendWhatsappFromAgent`
- ✅ **Simplificado**: Delega todo a `customerSupportMessageWorkflow`
- ✅ **Mejorado**: Métricas más claras y consistentes

### Compatibilidad
- ✅ **API Compatible**: Misma interface externa
- ✅ **Métricas Compatible**: Acceso a través de `customerSupportResult`
- ✅ **Logs Compatible**: Información detallada mantenida

La nueva arquitectura mantiene toda la funcionalidad mientras simplifica significativamente el código y mejora la mantenibilidad. 🎉 