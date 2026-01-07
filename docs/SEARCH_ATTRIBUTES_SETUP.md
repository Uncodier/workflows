# Search Attributes Setup Guide

## Overview

This guide walks you through registering custom search attributes in your Temporal Cloud namespace. This is a **one-time setup** required before search attributes can be used.

## Prerequisites

- Access to Temporal Cloud account
- Namespace already created
- Admin permissions for the namespace

## Option 1: Register via Temporal Cloud UI (Recommended)

### Step 1: Access Temporal Cloud

1. Navigate to [cloud.temporal.io](https://cloud.temporal.io)
2. Log in with your credentials
3. Select your namespace from the dashboard

### Step 2: Navigate to Search Attributes

1. Click on **Settings** in the left sidebar
2. Select **Search Attributes** from the settings menu
3. You'll see a list of existing search attributes (built-in ones)

### Step 3: Add Custom Search Attributes

For each attribute below, click **Add Custom Search Attribute** and enter:

| Attribute Name | Type | Description |
|---------------|------|-------------|
| `site_id` | Keyword | Site identifier for filtering workflows by site |
| `user_id` | Keyword | User identifier for filtering workflows by user |
| `lead_id` | Keyword | Lead identifier for filtering lead-related workflows |
| `segment_id` | Keyword | Segment identifier for filtering segment workflows |
| `campaign_id` | Keyword | Campaign identifier for filtering campaign workflows |
| `person_id` | Keyword | Person identifier for filtering person-related workflows |
| `icp_mining_id` | Keyword | ICP mining identifier for filtering ICP workflows |
| `command_id` | Keyword | Command identifier for filtering command workflows |
| `conversation_id` | Keyword | Conversation identifier for filtering conversation workflows |
| `instance_id` | Keyword | Instance identifier for filtering robot instance workflows |
| `workflow_category` | Keyword | Category for grouping related workflows |

**Important Notes:**
- Type must be **Keyword** for all string identifiers
- Names are case-sensitive
- Once created, search attributes cannot be deleted (only deprecated)

### Step 4: Verify Registration

1. After adding all attributes, refresh the page
2. Confirm all custom attributes appear in the list
3. Each should show:
   - ✅ Status: Active
   - Type: Keyword
   - Namespace: Your namespace name

### Step 5: Test Search

1. Go to **Workflows** in the left sidebar
2. In the search bar, try: `site_id = "test"`
3. If no error appears, registration was successful (even if no results found)

## Option 2: Register via tctl (Temporal CLI)

### Step 1: Install tctl

**macOS:**
```bash
brew install temporal
```

**Linux:**
```bash
# Download latest release
curl -sSf https://temporal.download/cli.sh | sh

# Add to PATH
export PATH="$HOME/.temporalio/bin:$PATH"
```

**Windows:**
```powershell
# Download from GitHub releases
# https://github.com/temporalio/cli/releases
```

### Step 2: Configure Connection

Set environment variables for your Temporal Cloud connection:

```bash
export TEMPORAL_ADDRESS="<your-namespace>.tmprl.cloud:7233"
export TEMPORAL_NAMESPACE="<your-namespace>"
export TEMPORAL_TLS_CERT="/path/to/your/cert.pem"
export TEMPORAL_TLS_KEY="/path/to/your/key.pem"
```

### Step 3: Register Search Attributes

Run this command to register all search attributes at once:

```bash
tctl --namespace $TEMPORAL_NAMESPACE \
     --address $TEMPORAL_ADDRESS \
     --tls \
     --tls-cert-path $TEMPORAL_TLS_CERT \
     --tls-key-path $TEMPORAL_TLS_KEY \
     admin cluster add-search-attributes \
     --name site_id --type Keyword \
     --name user_id --type Keyword \
     --name lead_id --type Keyword \
     --name segment_id --type Keyword \
     --name campaign_id --type Keyword \
     --name person_id --type Keyword \
     --name icp_mining_id --type Keyword \
     --name command_id --type Keyword \
     --name conversation_id --type Keyword \
     --name instance_id --type Keyword \
     --name workflow_category --type Keyword
```

**Note:** If you get an error about attributes already existing, that's fine - it means they're already registered.

### Step 4: Verify Registration

List all search attributes to verify:

```bash
tctl --namespace $TEMPORAL_NAMESPACE \
     --address $TEMPORAL_ADDRESS \
     --tls \
     --tls-cert-path $TEMPORAL_TLS_CERT \
     --tls-key-path $TEMPORAL_TLS_KEY \
     admin cluster get-search-attributes
```

You should see your custom attributes listed along with the built-in ones.

## Option 3: Register via API (Advanced)

If you need to automate registration or integrate it into your deployment pipeline:

```typescript
import { Connection, Client } from '@temporalio/client';

async function registerSearchAttributes() {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS,
    tls: {
      clientCertPair: {
        crt: Buffer.from(process.env.TEMPORAL_TLS_CERT || ''),
        key: Buffer.from(process.env.TEMPORAL_TLS_KEY || '')
      }
    }
  });

  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE
  });

  // Note: Search attribute registration requires admin API
  // This is typically done via tctl or UI
  // Programmatic registration requires using the gRPC admin service directly
  
  console.log('Search attributes must be registered via Temporal Cloud UI or tctl');
  console.log('See: https://docs.temporal.io/visibility#custom-search-attributes');
}
```

## Verification Checklist

After registration, verify everything is working:

- [ ] All 11 search attributes registered in Temporal Cloud
- [ ] Each attribute shows "Active" status
- [ ] Test search in UI returns no syntax errors
- [ ] Start a test workflow with search attributes
- [ ] Search for test workflow by custom attribute
- [ ] Workflow appears in search results
- [ ] Search attributes visible in workflow Summary section

## Testing the Implementation

### Test 1: Start a Workflow with Search Attributes

```typescript
import { executeWorkflow } from '@/temporal/client';

// Start a test workflow
const handle = await executeWorkflow(
  'buildSegmentsWorkflow',
  [{
    site_id: 'test-site-123',
    userId: 'test-user-456'
  }],
  'test-search-attrs-' + Date.now()
);

console.log('Test workflow started:', handle.workflowId);
```

### Test 2: Search for the Workflow

1. Go to Temporal Cloud UI → Workflows
2. Search: `site_id = "test-site-123"`
3. Your test workflow should appear in results
4. Click on it and verify search attributes in Summary section

### Test 3: Programmatic Search

```typescript
import { getTemporalClient } from '@/temporal/client';

const client = await getTemporalClient();

const workflows = client.workflow.list({
  query: 'site_id = "test-site-123"'
});

for await (const workflow of workflows) {
  console.log('Found workflow:', workflow.workflowId);
  console.log('Search attributes:', workflow.searchAttributes);
}
```

## Common Issues

### Issue: "Search attribute not found"

**Cause:** Attribute not registered in namespace

**Solution:**
1. Check Temporal Cloud UI → Settings → Search Attributes
2. Verify attribute name matches exactly (case-sensitive)
3. Re-register if missing

### Issue: "Invalid search attribute type"

**Cause:** Wrong type specified during registration

**Solution:**
- All identifier fields should be type **Keyword**
- Cannot change type after registration
- Must use different name if type is wrong

### Issue: Search returns no results but workflow exists

**Cause:** Workflow started before search attributes were added

**Solution:**
- Search attributes only apply to workflows started AFTER registration
- Old workflows won't have search attributes
- Start new test workflow to verify

### Issue: "Permission denied" when using tctl

**Cause:** Insufficient permissions or wrong credentials

**Solution:**
1. Verify you have admin access to namespace
2. Check TLS certificate paths are correct
3. Ensure certificates haven't expired
4. Try using Temporal Cloud UI instead

## Rollback / Deprecation

If you need to deprecate a search attribute:

1. **Via UI:**
   - Go to Settings → Search Attributes
   - Find the attribute
   - Click **Deprecate** (not Delete - deletion not supported)

2. **Via tctl:**
   ```bash
   tctl admin cluster remove-search-attributes \
     --name attribute_name
   ```

**Note:** Deprecated attributes:
- Can no longer be used in new workflows
- Remain visible on old workflows
- Cannot be deleted completely
- Name cannot be reused with different type

## Production Deployment Checklist

Before deploying to production:

- [ ] All search attributes registered in production namespace
- [ ] Tested in staging/development environment first
- [ ] Verified auto-extraction works with real workflow inputs
- [ ] Documented which workflows use which attributes
- [ ] Team trained on how to search in Temporal UI
- [ ] Monitoring/alerting set up using search queries
- [ ] Backup plan if search performance degrades

## Next Steps

After completing setup:

1. Read [SEARCH_ATTRIBUTES.md](./SEARCH_ATTRIBUTES.md) for usage guide
2. Test searching in Temporal Cloud UI
3. Try programmatic searches via SDK
4. Set up monitoring dashboards using search queries
5. Train team on search capabilities

## Support Resources

- [Temporal Search Attributes Docs](https://docs.temporal.io/visibility#custom-search-attributes)
- [Temporal Cloud Console](https://cloud.temporal.io)
- [Temporal CLI Documentation](https://docs.temporal.io/cli)
- [Temporal Community Slack](https://temporal.io/slack)

## Troubleshooting Commands

```bash
# List all search attributes
tctl admin cluster get-search-attributes

# Test connection to Temporal Cloud
tctl namespace describe

# Check workflow details
tctl workflow describe --workflow-id <workflow-id>

# List recent workflows
tctl workflow list --query "ExecutionStatus = 'Running'"
```

