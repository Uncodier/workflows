# Workflow Usage Examples

## sendEmailFromAgent Workflow

This workflow sends an email via the agent API endpoint.

### Parameters

```typescript
{
  email: string;    // Recipient email address
  from: string;     // Sender email address  
  subject: string;  // Email subject
  message: string;  // Email message content
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
    "message": "Hello! Thank you for your interest. We would like to schedule a call to discuss your needs further."
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

### Example with fallback email

```json
{
  "workflowType": "sendEmailFromAgent",
  "args": [{
    "email": "no-email@example.com",
    "from": "agent@company.com",
    "subject": "Important Update",
    "message": "This is an important update about your account."
  }]
}
```

### Features

- ✅ Validates all required parameters
- ✅ Calls the `/api/agents/tools/sendEmail` endpoint
- ✅ Includes proper error handling
- ✅ Returns detailed execution results
- ✅ Supports timeout configuration
- ✅ Automatic retries on transient failures 