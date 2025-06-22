# Sync Mails Workflow Guide

## Descripción General

El sistema `syncMails` es responsable del procesamiento y análisis automático de emails entrantes. A diferencia de WhatsApp que procesa mensajes directamente, el sistema de emails utiliza análisis de IA para determinar la intención, prioridad y tipo de respuesta necesaria antes del procesamiento de customer support.

## Arquitectura del Flujo

### 🔄 Flujo de Emails con Análisis

```
Email Entrante
       ↓
   Análisis de IA
   (intent, priority, sentiment)
       ↓
scheduleCustomerSupportMessagesWorkflow
       ↓
customerSupportMessageWorkflow (origin="email")
   (procesamiento + customer support + sendEmailFromAgent automático)
```

## Componentes del Sistema

### 📧 Análisis de Emails

#### API de Análisis
- **Endpoint**: `POST /api/agents/email/analyze`
- **Función**: Analiza el contenido del email usando IA
- **Campos analizados**:
  - Intent (inquiry, complaint, purchase, support, etc.)
  - Priority (high, medium, low)
  - Sentiment (positive, neutral, negative)
  - Suggested responses automáticas

#### Interface EmailAnalysisResponse
```typescript
interface EmailAnalysisResponse {
  success: boolean;
  analysis?: {
    intent: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
    priority: 'high' | 'medium' | 'low';
    response_type: 'automated' | 'human_required' | 'information' | 'commercial';
    sentiment: 'positive' | 'neutral' | 'negative';
    suggested_response?: string;
    requires_action: boolean;
    summary: string;
    keywords?: string[];
    analysis_id?: string;
  };
}
```

### 📋 Procesamiento de Emails

#### EmailData Interface
```typescript
interface EmailData {
  summary: string;
  original_subject: string;
  contact_info: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
  };
  site_id: string;
  user_id: string;
  lead_notification: 'email' | 'none';
  analysis_id?: string;
  priority: 'high' | 'medium' | 'low';
  intent: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request';
  potential_value: 'high' | 'medium' | 'low';
  conversation_id?: string;
  visitor_id?: string;
}
```

## Workflows del Sistema

### 1. `scheduleCustomerSupportMessagesWorkflow`
- **Función**: Procesa múltiples emails en lotes
- **Características**:
  - Intervalos de 1 minuto entre emails
  - Análisis automático si no existe
  - Delegación a `customerSupportMessageWorkflow`

### 2. `emailCustomerSupportMessageWorkflow`
- **Función**: Procesa un email individual
- **Flujo**:
  1. Valida si requiere procesamiento (`processAnalysisDataActivity`)
  2. Envía a customer support si necesario
  3. Ejecuta `sendEmailFromAgent` automáticamente si exitoso

### 3. `sendEmailFromAgent`
- **Función**: Envía emails de seguimiento
- **API**: `POST /api/agents/tools/sendEmail`
- **Parámetros**:
  - email, subject, message
  - site_id, agent_id, lead_id

## Lógica de Decisión

### processAnalysisDataActivity
Determina si un email requiere procesamiento basado en:
- **Priority**: emails de alta prioridad se procesan
- **Intent**: ciertos tipos requieren atención humana
- **Sentiment**: emails negativos se priorizan
- **Keywords**: palabras clave específicas del negocio

### Mapping de Intents
El sistema mapea intents específicos de email:
```typescript
// Email intents más específicos que WhatsApp
'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request'
```

## Diferencias con WhatsApp

| Aspecto | Emails (syncMails) | WhatsApp |
|---------|-------------------|----------|
| **Análisis** | ✅ Requerido (IA) | ❌ No usado |
| **Procesamiento** | Basado en análisis | Directo |
| **Respuestas** | Automáticas inteligentes | Basadas en customer support |
| **Priorización** | Por sentiment/priority | Tratamiento uniforme |
| **Lead Notification** | 'email' o 'none' | Siempre 'none' |

## APIs Utilizados

### 📞 Customer Support
- **Endpoint**: `POST /api/agents/customerSupport/message`
- **Función**: Crea interacciones de customer support
- **Usado por**: Ambos sistemas (email y WhatsApp)

### 📧 Análisis de Email
- **Endpoint**: `POST /api/agents/email/analyze`
- **Función**: Analiza el contenido del email usando IA
- **Usado por**: Solo sistema de emails

### 📤 Envío de Email
- **Endpoint**: `POST /api/agents/tools/sendEmail`
- **Función**: Envía emails a través del sistema de agentes
- **Usado por**: Solo sistema de emails

## Configuración de Envío

### Para Emails (origin="email")
```typescript
// Automáticamente ejecutado por customerSupportMessageWorkflow
const emailParams = {
  email: emailData.contact_info.email,
  subject: response.data?.conversation_title || 'Re: Your inquiry',
  message: response.data?.messages?.assistant?.content || 'Mensaje por defecto',
  site_id: emailData.site_id,
  agent_id: baseParams.agentId,
  lead_id: emailData.analysis_id // Incluye analysis_id para trazabilidad
};
```

## Casos de Uso

### 1. **Email de Consulta (High Priority)**
```
Entrada: "Urgent: Need pricing for enterprise solution"
↓
Análisis: intent=inquiry, priority=high, sentiment=neutral
↓
customerSupportMessageWorkflow: ✅ Procesa (alta prioridad)
↓
sendEmailFromAgent: Respuesta personalizada inmediata
```

### 2. **Email de Queja (Negative Sentiment)**
```
Entrada: "Very disappointed with your service"
↓
Análisis: intent=complaint, priority=high, sentiment=negative
↓
customerSupportMessageWorkflow: ✅ Procesa (sentimiento negativo)
↓
sendEmailFromAgent: Respuesta de disculpa y solución
```

### 3. **Email Automático (Low Priority)**
```
Entrada: "Thanks for the information"
↓
Análisis: intent=follow_up, priority=low, sentiment=positive
↓
customerSupportMessageWorkflow: ⏭️ Skip (no requiere acción)
↓
No se envía respuesta automática
```

## Métricas del Sistema

### Análisis
- **Analysis Success Rate**: Porcentaje de emails analizados exitosamente
- **Intent Distribution**: Distribución de tipos de intent detectados
- **Priority Breakdown**: Distribución por niveles de prioridad

### Procesamiento
- **Emails Processed**: Cantidad de emails que requirieron customer support
- **Emails Skipped**: Cantidad de emails que no requirieron acción
- **Response Rate**: Porcentaje de emails que resultaron en respuesta automática

### Rendimiento
- **Analysis Time**: Tiempo promedio de análisis por email
- **End-to-End Time**: Tiempo total desde análisis hasta envío de respuesta
- **Error Rate**: Porcentaje de fallos en el pipeline completo

## Monitoreo y Logs

### Logs de Análisis
```
📧 Analyzing email message...
📤 Sending email for analysis: {subject, sender, priority}
✅ Email analysis completed successfully
📊 Analysis result: {intent, priority, sentiment, requires_action}
```

### Logs de Procesamiento
```
📧 Processing email - sending customer support message
✅ Email customer support message sent successfully
📧 Starting sendEmailFromAgent workflow - customer support was successful...
✅ Follow-up email sent successfully
```

## Integración con Sistema Unificado

### Compatibilidad con customerSupportMessageWorkflow
El sistema de emails se integra perfectamente con el workflow centralizado:
- **Detección automática**: `origin="email"` activa el flujo de análisis
- **Procesamiento especializado**: Usa la lógica específica de `emailCustomerSupportMessageWorkflow`
- **Envío automático**: Ejecuta `sendEmailFromAgent` tras customer support exitoso

### Trazabilidad
- **Email Analysis ID**: `analysis_id` único para cada email analizado
- **Workflow IDs**: `customer-support-message-{analysis_id}` y `send-email-agent-{analysis_id}`
- **Cross-reference**: Conexión completa entre análisis, customer support y respuesta

## Configuración y Setup

### Variables de Entorno
```bash
# APIs de análisis
EMAIL_ANALYSIS_API_URL=/api/agents/email/analyze
EMAIL_SEND_API_URL=/api/agents/tools/sendEmail

# Configuración de análisis
ANALYSIS_TIMEOUT=30s
MAX_ANALYSIS_RETRIES=3
```

### Worker Configuration
```typescript
// Queue específica para emails
const emailWorker = Worker.create({
  workflowsPath: require.resolve('./workflows'),
  activitiesPath: require.resolve('./activities'),
  taskQueue: 'email-queue',
  activities: {
    analyzeEmailActivity,
    sendEmailFromAgentActivity,
    processAnalysisDataActivity
  }
});
```

El sistema de emails (syncMails) representa un pipeline completo de análisis inteligente y procesamiento automatizado, diferenciándose claramente del procesamiento directo de WhatsApp. 📧🤖 