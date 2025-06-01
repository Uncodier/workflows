# WhatsApp Message Workflow Guide

## Descripción General

El `answerWhatsappMessageWorkflow` es un workflow de Temporal diseñado para automatizar el análisis y respuesta de mensajes de WhatsApp. Este workflow llama al API `/api/agents/whatsapp/analyze` para analizar mensajes entrantes y opcionalmente envía respuestas automáticas.

## Características Principales

### ✨ Funcionalidades

1. **Análisis Inteligente**: Analiza mensajes de WhatsApp usando IA para determinar:
   - **Intent**: `inquiry`, `complaint`, `purchase`, `support`, `greeting`, `follow_up`, `unknown`
   - **Priority**: `high`, `medium`, `low`
   - **Response Type**: `automated`, `human_required`, `information`, `commercial`
   - **Sentiment**: `positive`, `neutral`, `negative`

2. **Respuestas Automáticas**: Envía respuestas automáticas cuando es apropiado
3. **Procesamiento en Lotes**: Procesa múltiples mensajes con intervalos configurables
4. **Trazabilidad Completa**: Logs detallados y métricas de cada mensaje procesado

### 🔄 Workflows Disponibles

#### 1. `answerWhatsappMessageWorkflow`
Procesa un mensaje individual de WhatsApp.

#### 2. `processWhatsAppMessagesWorkflow`
Procesa múltiples mensajes de WhatsApp en lotes con intervalos.

## API Endpoints Utilizados

### 📥 Análisis de Mensajes
- **Endpoint**: `POST /api/agents/whatsapp/analyze`
- **Función**: Analiza el contenido del mensaje usando IA

### 📤 Envío de Respuestas
- **Endpoint**: `POST /api/agents/whatsapp/send`
- **Función**: Envía respuestas automáticas por WhatsApp

## Interfaces de Datos

### WhatsAppMessageData
```typescript
interface WhatsAppMessageData {
  message: string;
  phone: string;
  contact_name?: string;
  message_id?: string;
  conversation_id?: string;
  timestamp?: string;
  site_id: string;
  user_id: string;
  message_type?: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location';
  media_url?: string;
  is_from_business?: boolean;
}
```

### WhatsAppAnalysisResponse
```typescript
interface WhatsAppAnalysisResponse {
  success: boolean;
  analysis?: {
    intent: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'greeting' | 'follow_up' | 'unknown';
    priority: 'high' | 'medium' | 'low';
    response_type: 'automated' | 'human_required' | 'information' | 'commercial';
    sentiment: 'positive' | 'neutral' | 'negative';
    suggested_response?: string;
    requires_action: boolean;
    contact_info?: {
      name?: string;
      phone: string;
      email?: string;
      company?: string;
    };
    summary: string;
    keywords?: string[];
    analysis_id?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}
```

## Uso del Workflow

### 1. Mensaje Individual con Auto-Respuesta

```typescript
import { getTemporalClient } from '../temporal/client';

const client = await getTemporalClient();

const messageData = {
  message: "Hola, me interesa conocer más sobre sus servicios.",
  phone: "+573001234567",
  contact_name: "María González",
  site_id: "your-site-id",
  user_id: "your-user-id",
  message_type: "text"
};

const options = {
  autoRespond: true,
  agentId: 'whatsapp-agent-001'
};

const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
  args: [messageData, options],
  taskQueue: 'whatsapp-queue',
  workflowId: `whatsapp-message-${Date.now()}`,
});
```

### 2. Solo Análisis (Sin Respuesta Automática)

```typescript
const options = {
  autoRespond: false, // Solo analizar, no responder
  agentId: 'whatsapp-agent-002'
};

const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
  args: [messageData, options],
  taskQueue: 'whatsapp-queue',
  workflowId: `analysis-only-${Date.now()}`,
});
```

### 3. Procesamiento en Lotes

```typescript
const messages = [
  // Array de WhatsAppMessageData
];

const options = {
  autoRespond: true,
  agentId: 'batch-whatsapp-agent',
  intervalMinutes: 1 // 1 minuto entre mensajes
};

const result = await client.workflow.execute('processWhatsAppMessagesWorkflow', {
  args: [messages, options],
  taskQueue: 'whatsapp-queue',
  workflowId: `batch-whatsapp-${Date.now()}`,
});
```

## Estructura de Respuesta

### Mensaje Individual
```typescript
{
  success: boolean;
  analyzed: boolean;
  responded: boolean;
  analysis?: {
    intent: string;
    priority: string;
    response_type: string;
    sentiment: string;
    suggested_response?: string;
    requires_action: boolean;
    summary: string;
    // ... más campos
  };
  response?: {
    message_id?: string;
    sent_message?: string;
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
  analyzed: number;
  responded: number;
  failed: number;
  results: Array<{
    index: number;
    phone: string;
    success: boolean;
    analyzed: boolean;
    responded: boolean;
    error?: string;
    workflowId: string;
  }>;
  executionTime: string;
}
```

## Lógica de Auto-Respuesta

El workflow envía respuestas automáticas **SOLO** cuando:

1. `autoRespond: true` está habilitado
2. El análisis fue exitoso
3. `analysis.response_type === 'automated'`
4. Existe una `suggested_response` del análisis
5. El mensaje tiene un número de teléfono válido

### Casos que NO generan respuesta automática:
- `response_type === 'human_required'` → Requiere intervención humana
- `autoRespond: false` → Auto-respuesta deshabilitada
- No hay `suggested_response` → IA no sugirió respuesta
- Error en el análisis → Fallo en el procesamiento

## Casos de Uso Típicos

### 1. **Consultas Comerciales**
- **Intent**: `inquiry`
- **Response Type**: `automated`
- **Acción**: Respuesta automática con información básica

### 2. **Quejas o Problemas**
- **Intent**: `complaint`
- **Priority**: `high`
- **Response Type**: `human_required`
- **Acción**: Solo análisis, escalado a humano

### 3. **Saludos**
- **Intent**: `greeting`
- **Response Type**: `automated`
- **Acción**: Respuesta de bienvenida automática

### 4. **Solicitudes de Soporte**
- **Intent**: `support`
- **Response Type**: `information` o `human_required`
- **Acción**: Información básica o escalado

## Testing

### Ejecutar Pruebas
```bash
# Ejecutar pruebas del workflow
npm run test:whatsapp

# O ejecutar el script directamente
npx ts-node src/scripts/test-whatsapp-workflow.ts
```

### Tipos de Pruebas Incluidas
1. **Mensaje Individual con Auto-Respuesta**
2. **Solo Análisis (sin respuesta)**
3. **Procesamiento en Lotes**

## Configuración de Colas

### Queue: `whatsapp-queue`
```typescript
// Worker configuration
const worker = Worker.create({
  workflowsPath: require.resolve('./workflows'),
  activitiesPath: require.resolve('./activities'),
  taskQueue: 'whatsapp-queue',
});
```

## Monitoreo y Logs

### Logs Importantes

```
📱 Starting WhatsApp message workflow...
🔍 Step 1: Analyzing WhatsApp message...
📊 Analysis summary: { intent, priority, response_type, sentiment }
📤 Step 2: Sending automated WhatsApp response...
✅ WhatsApp message workflow completed successfully
```

### Métricas Clave
- **Mensajes Analizados**: Cantidad de mensajes procesados
- **Respuestas Enviadas**: Cantidad de respuestas automáticas
- **Tasa de Éxito**: Porcentaje de mensajes procesados exitosamente
- **Tiempo de Ejecución**: Duración total del procesamiento

## Integración con Otros Workflows

El workflow de WhatsApp puede integrarse con:

1. **Customer Support Workflows**: Para escalado de casos complejos
2. **Email Workflows**: Para seguimiento por email
3. **CRM Workflows**: Para actualización de contactos
4. **Analytics Workflows**: Para reporte de métricas

## Consideraciones de Rendimiento

- **Intervalos entre mensajes**: Configurable para evitar límites de rate
- **Timeouts**: 2 minutos por actividad con 3 reintentos
- **Procesamiento asíncrono**: Cada mensaje se procesa independientemente
- **Escalabilidad**: Soporta procesamiento en paralelo de múltiples conversaciones

## Troubleshooting

### Errores Comunes

1. **"Analysis failed"**: Verificar conectividad con API de análisis
2. **"Response sending failed"**: Verificar configuración de WhatsApp API
3. **"Invalid phone number"**: Validar formato de números telefónicos
4. **"Timeout"**: Aumentar timeout si el análisis toma más tiempo

### Debug Mode
Para debugging, revisar logs con formato estructurado que incluyen todos los parámetros y respuestas del API. 