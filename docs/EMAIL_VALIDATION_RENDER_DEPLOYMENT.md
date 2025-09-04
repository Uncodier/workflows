# Email Validation Workflow - Render Deployment Guide

## Overview

This document describes the email validation workflow that runs on Render to bypass Vercel's port 25 restrictions. The workflow provides comprehensive SMTP email validation using the same battle-tested code from the main API project.

## Architecture

```
Vercel (Main App) --> Render (Email Validation Service) --> SMTP Servers (Port 25)
```

**Why Render?**
- Vercel doesn't allow outbound connections on port 25 (SMTP)
- This causes email validation to fail or return false positives
- Render provides full network access including port 25
- Dedicated service ensures reliable email validation

## Files Included

### Email Validation Library
- `src/lib/email-validation/index.ts` - Main exports
- `src/lib/email-validation/utils.ts` - Utility functions and types
- `src/lib/email-validation/dns.ts` - DNS resolution and domain checks
- `src/lib/email-validation/smtp.ts` - SMTP validation logic
- `src/lib/email-validation/reputation.ts` - Domain reputation analysis

### Temporal Workflow Components
- `src/temporal/activities/validateEmailActivities.ts` - Email validation activity
- `src/temporal/workflows/validateEmailWorkflow.ts` - Email validation workflow
- `src/temporal/config/taskQueues.ts` - Updated with email validation queue

### API Endpoint
- `api/validate-email.js` - HTTP endpoint for email validation

## Environment Variables

Configure these environment variables in Render:

### Required Variables
```bash
# Temporal Configuration
TEMPORAL_ADDRESS=your-temporal-cloud-address
TEMPORAL_NAMESPACE=your-namespace
TEMPORAL_CLIENT_CERT=your-client-cert
TEMPORAL_CLIENT_KEY=your-client-key

# Database Configuration
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
```

### Email Validation Specific (Optional)
```bash
# SMTP Validation Configuration
EMAIL_VALIDATOR_EHLO_DOMAIN=validator.uncodie.com
EMAIL_VALIDATOR_MAIL_FROM=validate@uncodie.com
EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS=20000
EMAIL_VALIDATOR_TLS_TIMEOUT_MS=8000

# Network Optimization
NODE_OPTIONS=--dns-result-order=ipv4first
```

### Default Values
If not provided, the following defaults are used:
- `EMAIL_VALIDATOR_EHLO_DOMAIN`: `validator.uncodie.com`
- `EMAIL_VALIDATOR_MAIL_FROM`: `validate@uncodie.com`
- `EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS`: `20000` (20 seconds)
- `EMAIL_VALIDATOR_TLS_TIMEOUT_MS`: `8000` (8 seconds)

## API Usage

### Endpoint
```
POST https://your-render-app.onrender.com/api/validate-email
```

### Request Body
```json
{
  "email": "test@example.com",
  "aggressiveMode": false
}
```

### Response Format
```json
{
  "success": true,
  "data": {
    "email": "test@example.com",
    "isValid": true,
    "deliverable": true,
    "result": "valid",
    "flags": ["smtp_validation"],
    "suggested_correction": null,
    "execution_time": 2500,
    "message": "Email address is valid",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "bounceRisk": "low",
    "reputationFlags": [],
    "riskFactors": [],
    "confidence": 85,
    "confidenceLevel": "high",
    "reasoning": [
      "SMTP server accepts email (+30)",
      "Low bounce risk domain (+10)"
    ],
    "aggressiveMode": false
  }
}
```

## Validation Results

### Result Types
- `valid`: Email passes all checks and is deliverable
- `invalid`: Email fails validation (doesn't exist, domain issues)
- `risky`: Email technically valid but high bounce risk
- `catchall`: Domain accepts all emails (delivery uncertain)
- `disposable`: From a disposable email provider
- `unknown`: Validation inconclusive due to server issues

### Confidence Levels
- `very_high` (85-100): Very confident in the result
- `high` (70-84): High confidence
- `medium` (50-69): Moderate confidence
- `low` (0-49): Low confidence, manual review recommended

## Features

### SMTP Validation
- Full SMTP protocol handshake
- TLS/STARTTLS support
- Multiple MX record testing
- Catchall domain detection
- Anti-spam policy detection

### Domain Analysis
- MX record validation
- Domain existence checks
- DNS fallback methods
- Reputation analysis
- Bounce risk prediction

### Advanced Detection
- Disposable email providers
- Corporate vs consumer domains
- High-bounce provider identification
- IP reputation handling

### Fallback Methods
When SMTP validation fails due to IP blocks or other issues:
- Basic DNS validation
- TXT record analysis (SPF/DMARC/DKIM)
- Mail subdomain detection
- CNAME analysis for mail services
- Nameserver provider detection

## Deployment Steps

### 1. Render Service Setup
1. Create new Web Service on Render
2. Connect to this repository
3. Set build command: `npm install && npm run build`
4. Set start command: `npm start`

### 2. Environment Variables
Configure all required environment variables in Render dashboard

### 3. Worker Configuration
Ensure Temporal worker is configured to handle the `email-validation-queue`:

```typescript
// In your worker configuration
import { taskQueues } from './src/temporal/config/taskQueues';

const worker = await Worker.create({
  connection,
  namespace: 'your-namespace',
  taskQueue: taskQueues.EMAIL_VALIDATION, // 'email-validation-queue'
  workflowsPath: require.resolve('./src/temporal/workflows'),
  activitiesPath: require.resolve('./src/temporal/activities'),
});
```

### 4. Network Requirements
Ensure Render service allows:
- Outbound TCP connections on port 25 (SMTP)
- Outbound TCP connections on port 587 (SMTP submission)
- Outbound TCP connections on port 465 (SMTPS)
- DNS resolution (UDP port 53)

## Testing

### Manual Testing
```bash
curl -X POST https://your-render-app.onrender.com/api/validate-email \
  -H "Content-Type: application/json" \
  -d '{"email": "test@gmail.com", "aggressiveMode": false}'
```

### Integration Testing
Use the workflow directly in your main application:

```typescript
import { executeWorkflow } from './path/to/temporal/client';

const result = await executeWorkflow({
  workflowType: 'validateEmailWorkflow',
  workflowId: `validate-email-${email}-${Date.now()}`,
  input: {
    email: 'test@example.com',
    aggressiveMode: false
  },
  taskQueue: 'email-validation-queue'
});
```

## Monitoring

### Metrics to Watch
- Email validation success rate
- Average validation time
- SMTP connection failures
- Fallback validation usage
- Worker queue depth

### Logging
All validation steps are logged with prefixes:
- `[VALIDATE_EMAIL]` - Main validation process
- `[FALLBACK_VALIDATION]` - Fallback validation attempts
- `[CATCHALL_TEST]` - Catchall domain testing
- `[VALIDATE_EMAIL_WORKFLOW]` - Workflow execution
- `[VALIDATE_EMAIL_API]` - API endpoint

## Troubleshooting

### Common Issues

1. **Port 25 Blocked**
   - Verify Render allows outbound SMTP connections
   - Check with Render support if needed

2. **DNS Timeouts**
   - Increase timeout values in environment variables
   - Consider using `NODE_OPTIONS=--dns-result-order=ipv4first`

3. **IP Reputation Issues**
   - Monitor for IP blocks in logs
   - Fallback validation should handle most cases
   - Consider IP warming if necessary

4. **High Validation Times**
   - Reduce timeout values for faster responses
   - Monitor MX record response times
   - Consider caching domain results

### Performance Optimization

1. **Timeout Tuning**
   ```bash
   EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS=15000  # Reduce from 20s
   EMAIL_VALIDATOR_TLS_TIMEOUT_MS=5000       # Reduce from 8s
   ```

2. **Worker Scaling**
   - Increase concurrent executions in taskQueues.ts
   - Monitor worker performance and scale accordingly

3. **Caching Strategy**
   - Consider implementing domain-level caching
   - Cache MX record lookups for frequently validated domains

## Security Considerations

1. **Rate Limiting**
   - Implement rate limiting on the API endpoint
   - Monitor for abuse patterns

2. **Input Validation**
   - Email format validation before processing
   - Sanitize all inputs

3. **Network Security**
   - Monitor outbound connections
   - Implement IP allowlisting if needed

4. **Data Privacy**
   - Don't log sensitive email addresses in production
   - Implement data retention policies

## Cost Optimization

1. **Resource Sizing**
   - Monitor CPU and memory usage
   - Adjust Render service size as needed

2. **Validation Efficiency**
   - Use aggressive mode judiciously
   - Implement early validation exits
   - Cache validation results when appropriate

## Support

For issues or questions:
1. Check the logs for detailed error messages
2. Review the troubleshooting section
3. Contact the development team
4. Check Render service status

## Related Documentation
- [Email Validation Implementation Guide](./EMAIL_VALIDATION_IMPLEMENTATION.md)
- [Temporal Workflow Guide](./TEMPORAL_VERSIONING_GUIDE.md)
- [Render Deployment Guide](./RENDER_DEPLOYMENT.md)
