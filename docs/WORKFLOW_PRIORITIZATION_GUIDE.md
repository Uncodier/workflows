# Workflow Prioritization Guide

This guide explains how to prioritize workflows in your Temporal system to ensure critical tasks run before less important ones.

## Overview

Workflow prioritization allows you to control the execution order of workflows based on their business importance, urgency, and resource requirements. This ensures that customer-facing operations, urgent fixes, and critical business processes get the resources they need first.

## Priority Levels

### 🚨 Critical Priority
- **Task Queue**: `critical-priority`
- **Timeout**: 2 minutes
- **Concurrency**: 50 tasks
- **Use Cases**: 
  - Customer support emergencies
  - System alerts requiring immediate attention
  - Failed workflows affecting customers

### ⚡ High Priority  
- **Task Queue**: `high-priority`
- **Timeout**: 5 minutes
- **Concurrency**: 30 tasks
- **Use Cases**:
  - Lead attention workflows
  - Email/WhatsApp sending
  - Customer-facing communications

### 📋 Normal Priority
- **Task Queue**: `default`  
- **Timeout**: 15 minutes
- **Concurrency**: 15 tasks
- **Use Cases**:
  - Daily operations
  - Lead generation
  - Regular business workflows

### 📊 Low Priority
- **Task Queue**: `low-priority`
- **Timeout**: 30 minutes  
- **Concurrency**: 8 tasks
- **Use Cases**:
  - Content generation
  - Campaign building
  - Batch operations

### 🔄 Background Priority
- **Task Queue**: `background-priority`
- **Timeout**: 60 minutes
- **Concurrency**: 5 tasks
- **Use Cases**:
  - System monitoring
  - Cleanup tasks
  - Reports and analytics

## Implementation Strategies

### 1. Task Queue-Based Prioritization (Recommended)

Different task queues with dedicated workers ensure resource isolation:

```typescript
import { executeCriticalWorkflow, executeHighPriorityWorkflow } from '../src/temporal/utils/priorityWorkflowExecutor';

// Critical workflow (customer support)
await executeCriticalWorkflow(
  'customerSupportMessageWorkflow',
  [emailData, { origin: 'email' }]
);

// High priority workflow (lead attention)
await executeHighPriorityWorkflow(
  'leadAttentionWorkflow', 
  [leadData]
);
```

### 2. API-Based Priority Execution

Use the enhanced API endpoint for priority control:

```bash
# Critical priority customer support
curl -X POST http://localhost:3000/api/execute-workflow-with-priority \
  -H "Content-Type: application/json" \
  -d '{
    "workflowType": "customerSupportMessageWorkflow",
    "args": [emailData, baseParams],
    "priority": "critical",
    "expedite": true
  }'

# Background processing
curl -X POST http://localhost:3000/api/execute-workflow-with-priority \
  -H "Content-Type: application/json" \
  -d '{
    "workflowType": "analyzeSiteWorkflow", 
    "args": [siteData],
    "priority": "background"
  }'
```

### 3. Smart Priority Assignment

Automatically determine priority based on context:

```typescript
import { shouldExpediteWorkflow } from '../src/temporal/utils/priorityWorkflowExecutor';

const priority = shouldExpediteWorkflow('customerSupportMessageWorkflow', {
  isFailedRetry: true,
  isCustomerFacing: true,
  hoursStuck: 12,
  businessImpact: 'high'
});
// Returns: 'critical'
```

### 4. Existing Priority Logic

Your project already implements smart prioritization in several places:

#### Email Sync Prioritization
```typescript
// In EmailSyncSchedulingService.ts (lines 217-227)
sitesToSchedule.sort((a, b) => {
  // Failed syncs have highest priority
  if (a.lastEmailSync?.status === 'FAILED' && b.lastEmailSync?.status !== 'FAILED') return -1;
  if (b.lastEmailSync?.status === 'FAILED' && a.lastEmailSync?.status !== 'FAILED') return 1;
  
  // Then by last run time (oldest first)
  const aLastRun = a.lastEmailSync?.last_run ? new Date(a.lastEmailSync.last_run).getTime() : 0;
  const bLastRun = b.lastEmailSync?.last_run ? new Date(b.lastEmailSync.last_run).getTime() : 0;
  
  return aLastRun - bLastRun;
});
```

## Worker Configuration

Configure workers for different priority levels:

```typescript
// src/temporal/workers/priorityWorkers.ts
import { TASK_QUEUES, TASK_QUEUE_CONFIG } from '../config/taskQueues';

// High concurrency for critical workflows
const criticalWorker = await TemporalWorker.create({
  connection,
  namespace: temporalConfig.namespace,
  taskQueue: TASK_QUEUES.CRITICAL,
  workflowsPath: require.resolve('../workflows/worker-workflows'),
  activities,
  ...TASK_QUEUE_CONFIG[TASK_QUEUES.CRITICAL]
});

// Lower concurrency for background tasks  
const backgroundWorker = await TemporalWorker.create({
  connection,
  namespace: temporalConfig.namespace,
  taskQueue: TASK_QUEUES.BACKGROUND,
  workflowsPath: require.resolve('../workflows/worker-workflows'),
  activities,
  ...TASK_QUEUE_CONFIG[TASK_QUEUES.BACKGROUND]
});
```

## Best Practices

### 1. Automatic Priority Assignment
- Use the `getTaskQueueForWorkflow()` function for consistent priority assignment
- Customer-facing workflows should default to high/critical priority
- Background operations should use low/background priority

### 2. Escalation Strategy
- Automatically escalate failed workflows to higher priority
- Consider time stuck when determining escalation level
- Implement retry logic with increased priority

### 3. Resource Management
- Monitor task queue performance and adjust concurrency limits
- Use separate workers for different priority levels
- Implement circuit breakers for critical workflows

### 4. Monitoring and Alerting
- Track workflow execution times by priority level
- Alert on critical workflow failures or delays
- Monitor resource utilization across task queues

## Priority Assignment Rules

### Automatic Assignment by Workflow Type

| Workflow Type | Auto Priority | Reason |
|---------------|---------------|---------|
| `customerSupportMessageWorkflow` | High | Customer-facing, important but not critical |
| `leadAttentionWorkflow` | High | Business opportunity, timely response important |
| `dailyStandUpWorkflow` | Normal | Regular operations, not time-critical |
| `buildCampaignsWorkflow` | Low | Batch operation, can be delayed |
| `dailyOperationsWorkflow` | Background | System maintenance, lowest priority |

### Context-Based Escalation

- **Failed Retry + Customer Facing** → Critical
- **Stuck > 24 hours** → Critical  
- **High Business Impact** → Critical
- **Customer Facing** → High
- **Failed Retry** → High
- **Stuck > 6 hours** → High

## Usage Examples

### Example 1: Emergency Customer Support
```typescript
await executeEmergencyCustomerSupport(emailData, 'Customer complaint - billing issue');
```

### Example 2: Failed Workflow Retry
```typescript  
await retryFailedWorkflowWithPriority(
  'leadGenerationWorkflow',
  [originalArgs],
  {
    originalWorkflowId: 'lead-gen-123',
    failureCount: 2,
    lastError: 'Timeout error',
    hoursStuck: 8
  }
);
```

### Example 3: Batch Processing with Priorities
```typescript
await executeMixedPriorityBatch([
  { type: 'customerSupportMessageWorkflow', args: [urgentEmail], priority: 'critical' },
  { type: 'leadGenerationWorkflow', args: [leadData], priority: 'normal' },
  { type: 'analyzeSiteWorkflow', args: [siteData], priority: 'background' }
]);
```

## Migration from Current System

If you're currently using the basic `execute-workflow.js` endpoint:

### Before (No Priority)
```javascript
await fetch('/api/execute-workflow', {
  method: 'POST',
  body: JSON.stringify({
    workflowType: 'customerSupportMessageWorkflow',
    args: [emailData]
  })
});
```

### After (With Priority)
```javascript
await fetch('/api/execute-workflow-with-priority', {
  method: 'POST', 
  body: JSON.stringify({
    workflowType: 'customerSupportMessageWorkflow',
    args: [emailData],
    priority: 'critical',    // NEW: Explicit priority
    expedite: true          // NEW: Force urgent execution
  })
});
```

## Troubleshooting

### High Priority Workflows Still Slow
- Check if workers are configured for high priority task queues
- Verify worker concurrency settings
- Monitor resource utilization

### Background Tasks Not Running
- Ensure background workers are running
- Check if high priority tasks are consuming all resources
- Consider adjusting concurrency limits

### Inconsistent Priority Assignment
- Use the centralized `getTaskQueueForWorkflow()` function
- Avoid hardcoding task queue names
- Implement logging to track priority decisions

## Monitoring

Track these metrics for effective priority management:

- **Execution time by priority level**
- **Queue depth by task queue**
- **Worker utilization by priority**
- **Escalation frequency**
- **Failed workflow retry patterns**

With this prioritization system, your critical customer support workflows will always execute before less important batch operations, ensuring optimal resource allocation and customer experience.
