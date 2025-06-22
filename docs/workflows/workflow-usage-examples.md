# Workflow Usage Examples

## sendEmailFromAgent Workflow

This workflow sends an email via the agent API endpoint.

### Parameters

```typescript
{
  email: string;           // Dirección de correo electrónico del destinatario (requerido)
  from?: string;           // Dirección de correo electrónico del remitente (opcional)
  subject: string;         // Asunto del correo electrónico (requerido)
  message: string;         // Contenido del mensaje - se convierte automáticamente a HTML (requerido)
  site_id: string;         // ID del sitio para obtener la configuración SMTP (requerido)
  agent_id?: string;       // ID del agente que envía el email - para logging (opcional)
  conversation_id?: string; // ID de la conversación relacionada - para logging (opcional)
  lead_id?: string;        // ID del lead relacionado - para logging (opcional)
}
```

### Usage via API Endpoint

**POST** `/api/execute-workflow`

```json
{
  "workflowType": "sendEmailFromAgent",
  "args": [{
    "email": "lead@example.com",
    "from": "agent@company.com", 
    "subject": "Follow-up on your inquiry",
    "message": "Hello! Thank you for your interest. We would like to schedule a call to discuss your needs further.",
    "site_id": "site_123456",
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
  "workflowId": "sendEmailFromAgent-1703123456789-xyz123",
  "workflowType": "sendEmailFromAgent",
  "status": "started",
  "message": "Workflow started successfully",
  "duration": "250ms",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Example with minimal required parameters

```json
{
  "workflowType": "sendEmailFromAgent",
  "args": [{
    "email": "customer@example.com",
    "subject": "Important Update",
    "message": "This is an important update about your account.",
    "site_id": "site_123456"
  }]
}
```

### Example with all parameters (for full logging)

```json
{
  "workflowType": "sendEmailFromAgent",
  "args": [{
    "email": "customer@example.com",
    "from": "support@company.com",
    "subject": "Support Response",
    "message": "Thank you for contacting us. Here's the information you requested...",
    "site_id": "site_123456",
    "agent_id": "agent_sarah_123",
    "conversation_id": "conv_support_456",
    "lead_id": "lead_customer_789"
  }]
}
```

### Features

- ✅ Validates all required parameters (email, subject, message, site_id)
- ✅ Calls the `/api/agents/tools/sendEmail` endpoint
- ✅ Includes proper error handling
- ✅ Returns detailed execution results
- ✅ Supports timeout configuration
- ✅ Automatic retries on transient failures
- ✅ Optional logging parameters for tracking (agent_id, conversation_id, lead_id)
- ✅ Optional sender email (from parameter)
- ✅ Message content automatically converted to HTML by the API

## sendWhatsappFromAgent Workflow

This workflow sends a WhatsApp message via the agent API endpoint.

### Parameters

```typescript
{
  phone_number: string;    // Número de teléfono del destinatario en formato internacional (requerido)
  message: string;         // Contenido del mensaje de WhatsApp (requerido)
  site_id: string;         // ID del sitio para obtener la configuración de WhatsApp (requerido)
  from?: string;           // Nombre del remitente (opcional, default: "AI Assistant")
  agent_id?: string;       // ID del agente que envía el mensaje - para logging (opcional)
  conversation_id?: string; // ID de la conversación relacionada - para logging (opcional)
  lead_id?: string;        // ID del lead relacionado - para logging (opcional)
}
```

### Usage via API Endpoint

**POST** `/api/execute-workflow`

```json
{
  "workflowType": "sendWhatsappFromAgent",
  "args": [{
    "phone_number": "+573001234567",
    "message": "¡Hola! Gracias por tu interés en nuestros servicios. Un miembro de nuestro equipo se pondrá en contacto contigo pronto.",
    "site_id": "site_123456",
    "from": "Support Team",
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

### Example with minimal required parameters

```json
{
  "workflowType": "sendWhatsappFromAgent",
  "args": [{
    "phone_number": "+573001234567",
    "message": "Mensaje de prueba con parámetros mínimos requeridos.",
    "site_id": "site_123456"
  }]
}
```

### Example with all parameters (for full logging)

```json
{
  "workflowType": "sendWhatsappFromAgent",
  "args": [{
    "phone_number": "+573009876543",
    "message": "Estimado Carlos, hemos recibido tu reporte sobre el producto dañado. Nuestro equipo de soporte está revisando tu caso.",
    "site_id": "site_123456",
    "from": "Customer Support",
    "agent_id": "agent_sarah_123",
    "conversation_id": "conv_support_456",
    "lead_id": "lead_customer_789"
  }]
}
```

### Features

- ✅ Validates all required parameters (phone_number, message, site_id)
- ✅ Calls the `/api/agents/tools/sendWhatsApp` endpoint
- ✅ Includes proper error handling
- ✅ Returns detailed execution results
- ✅ Supports timeout configuration
- ✅ Automatic retries on transient failures
- ✅ Optional logging parameters for tracking (agent_id, conversation_id, lead_id)
- ✅ International phone number format support
- ✅ Default sender name ("AI Assistant") when not specified 