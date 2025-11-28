# Worker Versioning Setup Guide

This guide explains how to configure and activate Worker Versioning in Temporal.

## Prerequisites

- Temporal Cloud account or self-hosted Temporal server
- Temporal CLI installed and configured
- Worker deployed with versioning enabled

## Configuration

### 1. Environment Variables

The worker versioning is controlled by these environment variables:

```bash
# Enable worker versioning
TEMPORAL_WORKER_USE_VERSIONING=true

# Deployment name (identifies your worker deployment)
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker

# Build ID (defaults to package.json version if not set)
TEMPORAL_WORKER_BUILD_ID=0.2.6

# Default versioning behavior: PINNED, or AUTO_UPGRADE
# If not set or set to UNSPECIFIED, no default behavior is set (each workflow specifies its own)
TEMPORAL_WORKER_VERSIONING_BEHAVIOR=UNSPECIFIED
```

These are already configured in `render.yaml` for the worker service.

### 2. Verify Worker is Running with Versioning

After deploying, check the worker logs to confirm versioning is enabled:

```bash
# Look for this log message:
📦 Worker versioning enabled: {
  buildId: '0.2.6',
  deploymentName: 'workflows_worker',
  defaultVersioningBehavior: 'not set (UNSPECIFIED)'  # or 'PINNED' or 'AUTO_UPGRADE'
}
```

## Activating Worker Versioning in Temporal

**Important**: After deploying your worker with versioning enabled, you need to activate the version in Temporal using the CLI. The worker will poll and register, but the version won't be active until you set it.

### Step 1: Check Current Deployment Status

First, verify that your worker deployment exists:

```bash
temporal worker deployment describe --name="workflows_worker"
```

This will show you all versions that are part of the deployment, including their status (Inactive, Active, Draining, Drained).

### Step 2: Set Current Version

Activate your deployment version as the current version:

```bash
temporal worker deployment set-current-version \
    --deployment-name "workflows_worker" \
    --build-id "0.2.6"
```

Replace `0.2.6` with your actual build ID (from `TEMPORAL_WORKER_BUILD_ID` or package.json version).

### Step 3: (Optional) Set Ramping Version

If you want to gradually roll out a new version, you can set it as a ramping version:

```bash
temporal worker deployment set-ramping-version \
    --deployment-name "workflows_worker" \
    --build-id "0.2.6" \
    --percentage=5
```

This routes 5% of new workflows to this version. You can gradually increase the percentage.

### Step 4: Verify in Temporal UI

After setting the current version, you should see your worker deployment in the Temporal UI:

1. Go to your Temporal Cloud dashboard
2. Navigate to **Workers** or **Deployments**
3. You should see your deployment named `workflows_worker`
4. The version should show as **Active** or **Current**

## Troubleshooting

### Worker Not Appearing in Temporal UI

1. **Check if versioning is enabled**: Look for the log message `📦 Worker versioning enabled` in your worker logs
2. **Verify environment variables**: Ensure `TEMPORAL_WORKER_USE_VERSIONING=true` is set
3. **Check worker is polling**: The worker must be actively polling task queues to register
4. **Activate the version**: Use `temporal worker deployment set-current-version` to activate it

### Version Status: Inactive

If your version shows as "Inactive", it means:
- The worker has polled and registered the version
- But the version hasn't been set as Current or Ramping
- **Solution**: Run `temporal worker deployment set-current-version` to activate it

### Checking Workflow Version

To see which version a workflow is running on:

```bash
temporal workflow describe -w YourWorkflowID
```

Look for the "Versioning Info" section in the output.

## Deployment Workflow

### Initial Deployment

1. Deploy worker with `TEMPORAL_WORKER_USE_VERSIONING=true`
2. Wait for worker to start and poll
3. Activate version: `temporal worker deployment set-current-version`
4. Verify in Temporal UI

### Updating to New Version

1. Update `TEMPORAL_WORKER_BUILD_ID` to new version (e.g., `0.2.7`)
2. Deploy new worker version
3. Set new version as ramping: `temporal worker deployment set-ramping-version --percentage=10`
4. Gradually increase percentage or set as current
5. Monitor old version drainage
6. Once drained, you can shut down old workers

### Monitoring Version Drainage

Check when an old version is fully drained:

```bash
temporal worker deployment describe-version \
    --deployment-name "workflows_worker" \
    --build-id "0.2.5"
```

Look for `DrainageStatus: drained` - this means all pinned workflows on that version have completed.

## Best Practices

1. **Use meaningful build IDs**: Use semantic versioning or commit hashes
2. **Start with UNSPECIFIED**: Let workflows specify their own behavior initially
3. **Monitor drainage**: Don't shut down old versions until they're drained
4. **Use ramping for gradual rollouts**: Start with small percentages and increase gradually
5. **Document version changes**: Keep track of what changed in each build ID

## References

- [Temporal Worker Versioning Documentation](https://docs.temporal.io/dev-guide/typescript/features#worker-versioning)
- [Temporal CLI Reference](https://docs.temporal.io/cli)

