# Search Attributes for Temporal Workflows

## Overview

Search attributes enable filtering and searching workflows in Temporal Cloud UI and programmatically via the SDK. This implementation automatically extracts common fields like `site_id`, `lead_id`, and `user_id` from workflow inputs, making them searchable without code duplication.

## Key Benefits

- 🔍 **Search workflows in Temporal UI** by site_id, lead_id, user_id, etc.
- 🚀 **Zero duplication** - attributes extracted automatically from existing inputs
- 🔄 **Backward compatible** - existing code continues working
- ⚙️ **Opt-out available** - can disable auto-extraction if needed
- 📊 **Better monitoring** - easily track workflows by business entities

## Available Search Attributes

The following search attributes are automatically extracted from workflow inputs:

| Search Attribute | Input Field Variants | Type | Description |
|-----------------|---------------------|------|-------------|
| `site_id` | site_id, siteId | Keyword | Site identifier |
| `user_id` | userId, user_id | Keyword | User identifier |
| `lead_id` | lead_id, leadId | Keyword | Lead identifier |
| `segment_id` | segmentId, segment_id | Keyword | Segment identifier |
| `campaign_id` | campaignId, campaign_id | Keyword | Campaign identifier |
| `person_id` | person_id, personId | Keyword | Person identifier |
| `icp_mining_id` | icp_mining_id | Keyword | ICP mining identifier |
| `command_id` | command_id | Keyword | Command identifier |
| `conversation_id` | conversation_id | Keyword | Conversation identifier |
| `instance_id` | instance_id | Keyword | Instance identifier |

## Searching in Temporal Cloud UI

### Basic Search

Navigate to your Temporal Cloud namespace and use the search bar:

```sql
-- Find all workflows for a specific site
site_id = "site-123"

-- Find workflows for a specific lead
lead_id = "lead-456"

-- Find workflows by user
user_id = "user-789"
```

### Advanced Queries

Combine search attributes with workflow metadata:

```sql
-- Active workflows for a site
site_id = "site-123" AND ExecutionStatus = "Running"

-- Failed workflows in the last 24 hours
site_id = "site-123" AND ExecutionStatus = "Failed" AND StartTime > "2026-01-06T00:00:00Z"

-- Specific workflow type for a site
site_id = "site-123" AND WorkflowType = "leadGenerationWorkflow"

-- Multiple sites
(site_id = "site-123" OR site_id = "site-456") AND ExecutionStatus = "Running"

-- Lead workflows that completed recently
lead_id = "lead-789" AND ExecutionStatus = "Completed" AND CloseTime > "1 hour ago"
```

### Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equals | `site_id = "site-123"` |
| `!=` | Not equals | `site_id != "site-test"` |
| `>` | Greater than | `StartTime > "2026-01-01T00:00:00Z"` |
| `<` | Less than | `CloseTime < "1 hour ago"` |
| `>=` | Greater or equal | `StartTime >= "2026-01-01T00:00:00Z"` |
| `<=` | Less or equal | `CloseTime <= "now"` |
| `AND` | Logical AND | `site_id = "site-123" AND ExecutionStatus = "Running"` |
| `OR` | Logical OR | `site_id = "site-123" OR site_id = "site-456"` |
| `()` | Grouping | `(site_id = "site-123" OR site_id = "site-456") AND ExecutionStatus = "Running"` |

### Built-in Attributes

In addition to custom search attributes, you can filter by these built-in attributes:

- `WorkflowType` - Type of workflow (e.g., "leadGenerationWorkflow")
- `WorkflowId` - Unique workflow identifier
- `ExecutionStatus` - Running, Completed, Failed, Terminated, TimedOut, Canceled
- `StartTime` - When workflow started
- `CloseTime` - When workflow completed/failed
- `TaskQueue` - Task queue name

## Searching Programmatically

### Using the SDK

```typescript
import { getTemporalClient } from '@/temporal/client';

const client = await getTemporalClient();

// Search for workflows
const workflows = client.workflow.list({
  query: 'site_id = "site-123" AND ExecutionStatus = "Running"'
});

// Iterate through results
for await (const workflow of workflows) {
  console.log(`Workflow ID: ${workflow.workflowId}`);
  console.log(`Type: ${workflow.workflowType}`);
  console.log(`Status: ${workflow.status.name}`);
  console.log(`Search Attributes:`, workflow.searchAttributes);
}
```

### Example: Monitor Failed Workflows

```typescript
async function monitorFailedWorkflows(siteId: string) {
  const client = await getTemporalClient();
  
  const failedWorkflows = client.workflow.list({
    query: `site_id = "${siteId}" AND ExecutionStatus = "Failed" AND StartTime > "1 hour ago"`
  });
  
  const failures = [];
  for await (const workflow of failedWorkflows) {
    failures.push({
      workflowId: workflow.workflowId,
      workflowType: workflow.workflowType,
      startTime: workflow.startTime,
      error: workflow.status.message
    });
  }
  
  return failures;
}
```

### Example: Count Active Workflows by Site

```typescript
async function countActiveWorkflowsBySite(siteId: string): Promise<number> {
  const client = await getTemporalClient();
  
  const workflows = client.workflow.list({
    query: `site_id = "${siteId}" AND ExecutionStatus = "Running"`
  });
  
  let count = 0;
  for await (const _ of workflows) {
    count++;
  }
  
  return count;
}
```

## How It Works

### Automatic Extraction

When you start a workflow with `executeWorkflow` or `executeWorkflowWithPriority`, search attributes are automatically extracted from the first argument:

```typescript
// Your workflow input
const input = {
  site_id: 'site-123',
  userId: 'user-456',
  lead_id: 'lead-789'
};

// Start workflow - searchAttributes extracted automatically
await executeWorkflow('leadFollowUpWorkflow', [input]);

// Temporal receives:
// searchAttributes: {
//   site_id: ['site-123'],
//   user_id: ['user-456'],
//   lead_id: ['lead-789']
// }
```

### Manual Override

You can provide custom search attributes or add additional ones:

```typescript
await executeWorkflow(
  'myWorkflow',
  [{ site_id: 'site-123' }],
  'my-workflow-id',
  'default',
  {
    searchAttributes: {
      site_id: ['site-123'],
      workflow_category: ['critical']  // Custom attribute
    }
  }
);
```

### Disable Auto-Extraction

If needed, you can disable automatic extraction:

```typescript
await executeWorkflow(
  'myWorkflow',
  [{ site_id: 'site-123' }],
  'my-workflow-id',
  'default',
  {
    autoExtractSearchAttributes: false
  }
);
```

## Setup Requirements

### 1. Register Search Attributes in Temporal Cloud

Search attributes must be registered in your Temporal namespace before use. You can do this via:

#### Option A: Temporal Cloud UI

1. Go to [cloud.temporal.io](https://cloud.temporal.io)
2. Navigate to your namespace
3. Go to **Settings** → **Search Attributes**
4. Click **Add Custom Search Attribute**
5. Add each attribute:
   - Name: `site_id`, Type: `Keyword`
   - Name: `user_id`, Type: `Keyword`
   - Name: `lead_id`, Type: `Keyword`
   - Name: `segment_id`, Type: `Keyword`
   - Name: `campaign_id`, Type: `Keyword`
   - Name: `person_id`, Type: `Keyword`
   - Name: `icp_mining_id`, Type: `Keyword`
   - Name: `workflow_category`, Type: `Keyword`

#### Option B: Using tctl (Temporal CLI)

```bash
# Install tctl
brew install temporal

# Register search attributes
tctl --namespace <your-namespace> \
     --address <your-server>.tmprl.cloud:7233 \
     --tls \
     --tls-cert-path /path/to/cert.pem \
     --tls-key-path /path/to/key.pem \
     admin cluster add-search-attributes \
     --name site_id --type Keyword \
     --name user_id --type Keyword \
     --name lead_id --type Keyword \
     --name segment_id --type Keyword \
     --name campaign_id --type Keyword \
     --name person_id --type Keyword \
     --name icp_mining_id --type Keyword \
     --name workflow_category --type Keyword
```

### 2. Verify Registration

After registering, verify in Temporal Cloud UI:

1. Go to **Settings** → **Search Attributes**
2. Confirm all custom attributes are listed
3. Try a test search: `site_id = "test"`

## Best Practices

### 1. Use Consistent Field Names

Always use the same field names in your workflow inputs:
- ✅ `site_id` (consistent)
- ❌ Sometimes `site_id`, sometimes `siteID`, sometimes `site`

### 2. Don't Include Sensitive Data

Search attributes are **NOT encrypted**. Never include:
- Passwords
- API keys
- Personal identification numbers
- Credit card information
- Any sensitive user data

### 3. Keep Values Short

Search attribute values should be identifiers, not large text:
- ✅ `site_id: "site-123"`
- ❌ `description: "This is a very long description..."`

### 4. Use Workflow Categories for Grouping

Add a `workflow_category` for easier filtering:

```typescript
import { addWorkflowCategory } from '@/temporal/utils/searchAttributes';

const searchAttrs = extractSearchAttributesFromInput(input);
const withCategory = addWorkflowCategory(searchAttrs, 'lead-generation');
```

### 5. Monitor Search Performance

If searches become slow:
- Reduce the time range in queries
- Use more specific filters
- Consider pagination for large result sets

## Troubleshooting

### Search Returns No Results

1. **Verify attribute registration**: Check Temporal Cloud UI → Settings → Search Attributes
2. **Check attribute name**: Ensure exact match (case-sensitive)
3. **Verify workflow has attributes**: View a workflow in UI and check Summary section
4. **Check time range**: Add `StartTime > "YYYY-MM-DD"` to narrow search

### Workflow Missing Search Attributes

1. **Check if auto-extraction is enabled**: Default is `true`
2. **Verify input format**: First argument must be an object
3. **Check field names**: Must match supported variants (e.g., `site_id` or `siteId`)
4. **Review logs**: Look for "Search Attributes:" in workflow start logs

### "Search attribute not found" Error

The attribute is not registered in your Temporal namespace. Follow the setup instructions above to register it.

### Search Syntax Error

- Ensure proper quoting: `site_id = "value"` (not `site_id = value`)
- Check operator spacing: `site_id = "value"` (not `site_id="value"`)
- Validate parentheses: Every `(` must have a matching `)`

## Examples

### Example 1: Debug Site Issues

```typescript
// Find all failed workflows for a site in the last hour
const query = `
  site_id = "site-problematic" 
  AND ExecutionStatus = "Failed" 
  AND StartTime > "1 hour ago"
`;

const workflows = await client.workflow.list({ query });
```

### Example 2: Monitor Lead Processing

```typescript
// Check if a lead is currently being processed
const query = `
  lead_id = "lead-123" 
  AND ExecutionStatus = "Running"
`;

const workflows = await client.workflow.list({ query });
const isProcessing = (await workflows.next()).value !== undefined;
```

### Example 3: Bulk Operations

```typescript
// Find and terminate all stuck workflows for a site
const query = `
  site_id = "site-123" 
  AND ExecutionStatus = "Running" 
  AND StartTime < "24 hours ago"
`;

const workflows = client.workflow.list({ query });

for await (const workflow of workflows) {
  const handle = client.workflow.getHandle(workflow.workflowId);
  await handle.terminate('Stuck workflow cleanup');
  console.log(`Terminated: ${workflow.workflowId}`);
}
```

## API Reference

### `extractSearchAttributesFromInput(input)`

Extracts search attributes from a workflow input object.

**Parameters:**
- `input` (Record<string, any>): Workflow input object

**Returns:**
- `Record<string, string[]>`: Search attributes formatted for Temporal

**Example:**
```typescript
const input = { site_id: 'site-123', userId: 'user-456' };
const attrs = extractSearchAttributesFromInput(input);
// Returns: { site_id: ['site-123'], user_id: ['user-456'] }
```

### `mergeSearchAttributes(...attributes)`

Merges multiple search attributes objects. Later objects take precedence.

**Parameters:**
- `...attributes` (Record<string, string[]>[]): Search attributes to merge

**Returns:**
- `Record<string, string[]>`: Merged search attributes

**Example:**
```typescript
const auto = { site_id: ['site-123'] };
const manual = { site_id: ['site-456'], workflow_category: ['critical'] };
const merged = mergeSearchAttributes(auto, manual);
// Returns: { site_id: ['site-456'], workflow_category: ['critical'] }
```

### `addWorkflowCategory(attributes, category)`

Adds a workflow category to search attributes.

**Parameters:**
- `attributes` (Record<string, string[]>): Existing search attributes
- `category` (string): Category name

**Returns:**
- `Record<string, string[]>`: Search attributes with category added

**Example:**
```typescript
const attrs = { site_id: ['site-123'] };
const withCategory = addWorkflowCategory(attrs, 'lead-generation');
// Returns: { site_id: ['site-123'], workflow_category: ['lead-generation'] }
```

## Related Documentation

- [Temporal Search Attributes Official Docs](https://docs.temporal.io/docs/typescript/search-attributes)
- [Temporal Visibility Guide](https://docs.temporal.io/visibility)
- [Workflow Priority Configuration](./WORKFLOW_PRIORITIZATION_GUIDE.md)

## Support

For issues or questions:
1. Check Temporal Cloud UI for workflow details
2. Review workflow logs for search attribute extraction
3. Verify search attribute registration in namespace settings
4. Test queries in Temporal Cloud UI before using in code

