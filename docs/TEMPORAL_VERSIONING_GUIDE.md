# Temporal Workflow Versioning Guide

## Overview

This guide explains how to handle non-deterministic errors in Temporal workflows, specifically addressing the `[TMPRL1100] Nondeterminism error` that occurs when workflow code changes without proper versioning.

## What is a Non-Deterministic Error?

Temporal requires workflows to be deterministic - they must execute the same sequence of activities in the same order every time. When you modify a workflow that has already started executing, Temporal can detect these changes and throw a non-deterministic error.

### Example Error
```
[TMPRL1100] Nondeterminism error: Activity type of scheduled event 'leadFollowUpActivity' does not match activity type of activity command 'getLeadActivity'
```

This error indicates that:
1. A workflow was expecting to execute `leadFollowUpActivity` 
2. But the current code wants to execute `getLeadActivity` at that position
3. This breaks the deterministic execution guarantee

## Common Causes

1. **Adding new activities** in the middle of existing workflows
2. **Changing the order** of activity execution
3. **Removing activities** that were previously executed
4. **Modifying conditional logic** that affects activity execution
5. **Changing activity names** or function signatures

## Solution: Workflow Versioning

Temporal provides versioning mechanisms to handle non-compatible changes safely:

### 1. Using `patched()` for New Features

```typescript
import { patched, deprecatePatch } from '@temporalio/workflow';

export async function myWorkflow() {
  // Check if this workflow supports the new feature
  const shouldExecuteNewFeature = patched('new-feature-v1');
  
  if (shouldExecuteNewFeature) {
    // New code path - execute new activities
    await newActivity();
  } else {
    // Legacy code path - maintain old behavior
    console.log('Running legacy path for old workflows');
  }
  
  // Continue with common logic
  await commonActivity();
}
```

### 2. Deprecating Patches

```typescript
// Mark the patch for future removal
deprecatePatch('new-feature-v1');
```

### 3. Real Example: leadFollowUpWorkflow Fix

The `leadFollowUpWorkflow` had a non-deterministic error when `getLeadActivity` was added. Here's how it was fixed:

```typescript
// Before (caused error):
export async function leadFollowUpWorkflow(options: LeadFollowUpOptions) {
  await getSiteActivity(site_id);
  await getLeadActivity(lead_id); // <- This was added, breaking determinism
  await leadFollowUpActivity(request);
}

// After (with versioning):
export async function leadFollowUpWorkflow(options: LeadFollowUpOptions) {
  await getSiteActivity(site_id);
  
  const shouldGetLeadInfo = patched('add-lead-info-check-v1');
  deprecatePatch('add-lead-info-check-v1');
  
  if (shouldGetLeadInfo) {
    // New workflows: get lead info and potentially do research
    const leadResult = await getLeadActivity(lead_id);
    if (shouldExecuteLeadResearch(leadResult.lead)) {
      await startChild(leadResearchWorkflow, options);
    }
  } else {
    // Legacy workflows: skip lead info check
    console.log('Running legacy path - skipping lead info check');
  }
  
  await leadFollowUpActivity(request);
}
```

## Monitoring and Cleanup

### 1. Monitor Active Workflows

Use the monitoring script to check when versioning can be safely removed:

```bash
npm run monitor-workflows
```

This script will:
- List all active `leadFollowUpWorkflow` instances
- Check if any old workflows (pre-patch) are still running
- Provide recommendations on when to remove versioning code

### 2. Safe Removal Timeline

1. **Deploy the versioned fix** - All new workflows use the new code path
2. **Wait for old workflows to complete** - Usually 24-48 hours for most workflows
3. **Monitor using the script** - Check that no old workflows are active
4. **Remove versioning code** - Clean up patches and conditional logic

### 3. Cleanup Process

When the monitoring script indicates it's safe:

1. Remove the versioning imports:
```typescript
// Remove these
import { patched, deprecatePatch } from '@temporalio/workflow';
```

2. Remove the patch logic:
```typescript
// Remove these lines
const shouldGetLeadInfo = patched('add-lead-info-check-v1');
deprecatePatch('add-lead-info-check-v1');
```

3. Always execute the new code path:
```typescript
// Replace conditional with direct execution
// Before:
if (shouldGetLeadInfo) {
  await getLeadActivity(lead_id);
}

// After:
await getLeadActivity(lead_id);
```

## Best Practices

### 1. Prevention
- **Plan workflow changes carefully** - Consider the impact on running workflows
- **Use child workflows** for new complex logic that might change
- **Design workflows to be extensible** from the start

### 2. Development
- **Test versioning locally** - Start a workflow, modify code, continue execution
- **Use meaningful patch names** - Include version and description (e.g., 'add-payment-validation-v2')
- **Document versioning decisions** - Comment why patches were added

### 3. Deployment
- **Deploy versioned code first** - Don't break running workflows
- **Monitor after deployment** - Watch for new non-deterministic errors
- **Schedule cleanup** - Set reminders to remove old versioning code

### 4. Long-term Maintenance
- **Regular cleanup** - Remove old patches periodically
- **Version documentation** - Keep track of active patches and their purpose
- **Team communication** - Ensure all developers understand versioning requirements

## Troubleshooting

### Error: "Activity type does not match"
- **Solution**: Add versioning around the changed activity sequence
- **Prevention**: Use the monitoring script before making changes

### Error: "Event type does not match"
- **Solution**: Version any changes to workflow structure (sleep, child workflows, etc.)
- **Prevention**: Always consider running workflows when modifying code

### Multiple Patches Needed
- **Solution**: Each breaking change needs its own patch
- **Best Practice**: Group related changes into a single version when possible

## Monitoring Script Usage

```bash
# Check current workflow status
npm run monitor-workflows

# Example output:
# 🟢 Active workflows: 5
# ✅ Completed workflows: 127
# ❌ Failed/Terminated workflows: 2
# 
# ⚠️ KEEP PATCH: Old workflows still active
# Found 2 active workflows that started before patch deployment
```

## Emergency Procedures

If you encounter non-deterministic errors in production:

1. **Immediate Response**:
   - Don't panic - running workflows are not affected
   - Stop new workflow executions if possible
   - Deploy the versioned fix as soon as possible

2. **Investigation**:
   - Check the error message for the specific mismatch
   - Identify what changed in the workflow code
   - Determine the appropriate versioning strategy

3. **Recovery**:
   - Implement versioning as shown in examples above
   - Test the fix in staging first if possible
   - Deploy and monitor for resolution

Remember: Temporal versioning is designed to handle these situations gracefully. With proper versioning, you can modify workflows while keeping existing executions running smoothly. 