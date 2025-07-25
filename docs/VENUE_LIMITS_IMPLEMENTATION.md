# Venue Limits Implementation

## Overview

This document explains the implementation of dynamic venue limits based on billing plans and channel configuration in the Lead Generation Workflow.

## Business Rules

The venue limits are determined by the following rules:

| Billing Plan | Channels Configured | Max Venues |
|-------------|-------------------|------------|
| Free        | No                | 2          |
| Free        | Yes               | 4          |
| Commission  | No                | 2          |
| Commission  | Yes               | 4          |
| Startup     | Any               | 20         |
| Enterprise  | Any               | 60         |

## Implementation

### New Activity: `determineMaxVenuesActivity`

**Location:** `src/temporal/activities/leadGenerationActivities.ts`

**Purpose:** Determines the maximum number of venues allowed based on billing plan and channel configuration.

**Parameters:**
```typescript
{
  site_id: string;
  userId?: string;
}
```

**Returns:**
```typescript
{
  success: boolean;
  maxVenues?: number;
  plan?: string;
  hasChannels?: boolean;
  error?: string;
}
```

### Integration in Lead Generation Workflow

**Location:** `src/temporal/workflows/leadGenerationWorkflow.ts`

The function is called before `callRegionVenuesApiActivity` to dynamically determine the venue limit:

```typescript
// Step 2b: Determine maximum venues based on billing plan
console.log(`🔢 Determining venue limits based on billing plan...`);
const maxVenuesResult = await determineMaxVenuesActivity({
  site_id: site_id,
  userId: options.userId || site.user_id
});

let maxVenues = 1; // Default fallback
if (maxVenuesResult.success && maxVenuesResult.maxVenues) {
  maxVenues = maxVenuesResult.maxVenues;
  console.log(`✅ Venue limits determined: ${maxVenues} venues (Plan: ${maxVenuesResult.plan}, Channels: ${maxVenuesResult.hasChannels ? 'Yes' : 'No'})`);
} else {
  console.log(`⚠️ Failed to determine venue limits, using default: ${maxVenues} venues. Error: ${maxVenuesResult.error}`);
}

// Use the determined limit in region venues API call
const regionVenuesOptions: RegionVenuesApiOptions = {
  // ... other options
  maxVenues: maxVenues, // ✅ Use dynamically determined venue limit
  // ... rest of options
};
```

## Database Dependencies

### Billing Table
- **Table:** `billing`
- **Key Field:** `plan` (values: 'free', 'startup', 'enterprise')
- **Relationship:** `site_id` foreign key to `sites` table

### Settings Table
- **Table:** `settings`
- **Key Field:** `channels` (jsonb)
- **Structure:** 
```json
{
  "email": {
    "enabled": true,
    "email": "support@company.com",
    // ... other email config
  },
  "whatsapp": {
    "enabled": true,
    "number": "+1234567890",
    // ... other whatsapp config
  }
}
```

## Channel Configuration Detection

The function checks if channels are configured by:

1. Verifying the `channels` object exists and is not empty
2. Checking if at least one channel has `enabled: true`

```typescript
const hasChannels = channels && typeof channels === 'object' && Object.keys(channels).length > 0 &&
  Object.values(channels).some((channel: any) => 
    channel && typeof channel === 'object' && channel.enabled === true
  );
```

## Testing

### Test Script

**Location:** `src/scripts/test-determine-max-venues.ts`

**Usage:**
```bash
# Replace TEST_SITE_ID with actual site ID in the test file
npx tsx src/scripts/test-determine-max-venues.ts
```

### Test Cases

1. **Free Plan Without Channels** → 1 venue
2. **Free Plan With Channels** → 2 venues  
3. **Startup Plan** → 10 venues
4. **Enterprise Plan** → 30 venues
5. **Unknown Plan** → 1 venue (default)

## Example Output

When the workflow runs, you'll see output like:

```
🔢 Determining venue limits based on billing plan...
📊 Venue limits determined for site abc-123:
   💳 Billing plan: startup
   📡 Channels configured: Yes (2 total)
   🏢 Max venues allowed: 10
✅ Venue limits determined: 10 venues (Plan: startup, Channels: Yes)
```

## Error Handling

- **Database Connection Issues:** Falls back to 1 venue
- **Missing Billing Data:** Falls back to 1 venue  
- **Missing Settings Data:** Falls back to 1 venue
- **Unknown Plans:** Falls back to 1 venue with warning

## Migration Notes

### Before
- Fixed `maxVenues: 10` for all users regardless of plan

### After  
- Dynamic venue limits based on billing plan
- Enhanced functionality for free users with channel configuration
- Proper enterprise scaling with 30 venues

## Benefits

1. **Fair Usage:** Free users get appropriate limits
2. **Incentivized Upgrades:** More venues for paid plans
3. **Channel Integration Bonus:** Free users get extra venue if they configure channels
4. **Scalability:** Enterprise users get maximum venues for large operations
5. **Cost Control:** Prevents excessive API usage for free accounts

## Future Enhancements

1. **Custom Limits:** Allow manual venue limit overrides per site
2. **Usage Tracking:** Track venue usage against limits
3. **Notifications:** Alert users when approaching limits
4. **Analytics:** Report on venue usage patterns by plan type 