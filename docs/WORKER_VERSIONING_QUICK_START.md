# Worker Versioning - Quick Start Guide

## Minimum Required Configuration

To enable worker versioning, you only need to set **2 environment variables**:

```bash
TEMPORAL_WORKER_USE_VERSIONING=true
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker
```

That's it! The system will automatically:
- Use your `package.json` version as the Build ID
- Set behavior to `UNSPECIFIED` (each workflow specifies its own)

## What Each Variable Does

### Required Variables

#### `TEMPORAL_WORKER_USE_VERSIONING`
- **Required**: Yes
- **Default**: `false` (versioning disabled)
- **Value**: Must be `"true"` to enable worker versioning
- **What it does**: Enables the worker versioning feature

#### `TEMPORAL_WORKER_DEPLOYMENT_NAME`
- **Required**: Yes
- **Default**: `"workflows_worker"`
- **Value**: Any string identifier (e.g., `"workflows_worker"`, `"production-worker"`, `"llm_srv"`)
- **What it does**: This is the name that appears in Temporal UI. All workers with the same deployment name are part of the same deployment.

### Optional Variables (with defaults)

#### `TEMPORAL_WORKER_BUILD_ID`
- **Required**: No
- **Default**: Automatically uses `package.json` version (e.g., `"0.2.6"`)
- **Value**: Any string identifier (semantic version, commit hash, date, etc.)
- **What it does**: Identifies the specific build/version of your worker code
- **When to set**: Only if you want a different identifier than your package.json version

#### `TEMPORAL_WORKER_VERSIONING_BEHAVIOR`
- **Required**: No
- **Default**: `UNSPECIFIED` (no default behavior)
- **Values**: 
  - `UNSPECIFIED` - Each workflow specifies its own behavior (recommended for new deployments)
  - `PINNED` - All workflows stay on the same version until completion
  - `AUTO_UPGRADE` - All workflows automatically move to new versions
- **What it does**: Sets the default versioning behavior for all workflows
- **When to set**: Only if you want all workflows to have the same default behavior

## Example Configurations

### Minimal Configuration (Recommended for First Time)
```bash
TEMPORAL_WORKER_USE_VERSIONING=true
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker
# Build ID: auto-detected from package.json
# Behavior: UNSPECIFIED (each workflow specifies its own)
```

### Custom Build ID
```bash
TEMPORAL_WORKER_USE_VERSIONING=true
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker
TEMPORAL_WORKER_BUILD_ID=v1.2.3-production
# Behavior: UNSPECIFIED
```

### With Default Behavior
```bash
TEMPORAL_WORKER_USE_VERSIONING=true
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker
TEMPORAL_WORKER_BUILD_ID=0.2.6
TEMPORAL_WORKER_VERSIONING_BEHAVIOR=AUTO_UPGRADE
```

### Production Blue-Green Deployment
```bash
TEMPORAL_WORKER_USE_VERSIONING=true
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker
TEMPORAL_WORKER_BUILD_ID=0.2.6
TEMPORAL_WORKER_VERSIONING_BEHAVIOR=AUTO_UPGRADE
```

### Production Rainbow Deployment (with Pinning)
```bash
TEMPORAL_WORKER_USE_VERSIONING=true
TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker
TEMPORAL_WORKER_BUILD_ID=0.2.6
TEMPORAL_WORKER_VERSIONING_BEHAVIOR=PINNED
```

## Setting Variables in Render

### Option 1: Via render.yaml (Already Configured)
The `render.yaml` file already includes the required variables with defaults:
- `TEMPORAL_WORKER_USE_VERSIONING=true`
- `TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker`

### Option 2: Via Render Dashboard
1. Go to your Render service
2. Navigate to **Environment** tab
3. Add the variables:
   - `TEMPORAL_WORKER_USE_VERSIONING` = `true`
   - `TEMPORAL_WORKER_DEPLOYMENT_NAME` = `workflows_worker`
   - (Optional) `TEMPORAL_WORKER_BUILD_ID` = your build ID
   - (Optional) `TEMPORAL_WORKER_VERSIONING_BEHAVIOR` = `UNSPECIFIED`, `PINNED`, or `AUTO_UPGRADE`

## After Configuration

1. **Deploy** your worker with the environment variables set
2. **Check logs** for: `📦 Worker versioning enabled`
3. **Activate the version** in Temporal CLI:
   ```bash
   temporal worker deployment set-current-version \
       --deployment-name "workflows_worker" \
       --build-id "0.2.6"
   ```
4. **Verify** in Temporal UI that your deployment appears

## Troubleshooting

### Worker not appearing in Temporal UI?
- ✅ Check `TEMPORAL_WORKER_USE_VERSIONING=true` is set
- ✅ Check worker logs for versioning enabled message
- ✅ Activate the version using Temporal CLI (see above)

### Getting "Unknown versioning behavior" error?
- ✅ Don't set `TEMPORAL_WORKER_VERSIONING_BEHAVIOR` to `UNSPECIFIED` explicitly
- ✅ Leave it unset, or use `PINNED` or `AUTO_UPGRADE`
- ✅ The code automatically handles `UNSPECIFIED` by omitting the field

### Build ID not showing correctly?
- ✅ Check your `package.json` has a `version` field
- ✅ Or explicitly set `TEMPORAL_WORKER_BUILD_ID`


