# Workflow Usage Examples

## sendEmailFromAgent Workflow

This workflow sends an email via the agent API endpoint.

### Parameters

```typescript
{
  email: string;           // Dirección de correo electrónico del destinatario (requerido)
  from: string;            // Dirección de correo electrónico del remitente (requerido)
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
    "email": "no-email@example.com",
    "from": "agent@company.com",
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

- ✅ Validates all required parameters (email, from, subject, message, site_id)
- ✅ Calls the `/api/agents/tools/sendEmail` endpoint
- ✅ Includes proper error handling
- ✅ Returns detailed execution results
- ✅ Supports timeout configuration
- ✅ Automatic retries on transient failures
- ✅ Optional logging parameters for tracking (agent_id, conversation_id, lead_id)
- ✅ Message content automatically converted to HTML by the API 