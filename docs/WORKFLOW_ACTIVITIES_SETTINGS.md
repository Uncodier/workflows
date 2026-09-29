# Workflow Activities Settings

## Overview

This document describes the workflow scheduling control system using `settings.activities` in site configuration.

For the account, audience, weekday, and daily delivery controls on Cold Outreach and
Follow Up, see [Outreach configuration](./OUTREACH_CONFIGURATION.md). Both activities
are opt-in: absent, `default`, or `inactive` status does not permit execution.

## Feature Description

The system now checks `settings.activities` object in site settings to determine which workflows should be scheduled for each site. This allows granular control over which automated workflows run for specific sites.

## Settings Structure

```json
{
  "settings": {
    "activities": {
      "email_sync": {
        "status": "default"
      },
      "leads_follow_up": {
        "status": "default"
      },
      "icp_lead_generation": {
        "status": "default"
      },
      "local_lead_generation": {
        "status": "inactive"
      },
      "daily_resume_and_stand_up": {
        "status": "default"
      },
      "leads_initial_cold_outreach": {
        "status": "inactive"
      }
    }
  }
}
```

## Activity Keys and Corresponding Workflows

| Activity Key | Workflow | Description |
|--------------|----------|-------------|
| `daily_resume_and_stand_up` | `dailyStandUpWorkflow` | Daily summary and stand-up meetings |
| `leads_follow_up` | `leadQualificationWorkflow` | Follow-up on configured weekdays (initial selection: Tue/Wed/Thu) |
| `icp_lead_generation` | `idealClientProfileMiningWorkflow` | ICP-based lead generation |
| `leads_initial_cold_outreach` | `leadFollowUpWorkflow` (daily prospection) | Initial cold outreach to leads |
| `email_sync` | `emailSyncWorkflow` | Email synchronization |
| `local_lead_generation` | (Future) | Local lead generation |

## Status Values

- **`active`**: Explicitly enable the activity, subject to its configuration and safety checks
- **`default`**: Uses the activity default; Cold Outreach and Follow Up default to inactive
- **`inactive`**: Workflow is **NOT** scheduled for this site

## Behavior

### Backward Compatibility

If `settings.activities` object doesn't exist:
- Opt-in workflows, including Cold Outreach and Follow Up, are not scheduled.
- Other workflows retain their existing defaults.

### Active Control

If `settings.activities` exists:
1. Check each workflow's activity key
2. If activity key doesn't exist → use its default (inactive for outreach)
3. If `status === "inactive"` → **SKIP** scheduling for that site
4. `active` explicitly enables scheduling; `default` follows the activity default.

## Implementation Details

### Helper Function

```typescript
function shouldScheduleWorkflow(site: any, activityKey: string): boolean {
  const optIn = new Set([
    'supervise_conversations', 'assign_leads_to_team', 'local_lead_generation',
    'icp_lead_generation', 'daily_resume_and_stand_up',
    'leads_initial_cold_outreach', 'leads_follow_up',
  ]);
  const status = site.settings?.activities?.[activityKey]?.status;
  if (status === 'active') return true;
  if (status === 'inactive') return false;
  return !optIn.has(activityKey);
}
```

### Modified Activities

The following scheduling activities now check `settings.activities`:

1. **`scheduleIndividualDailyStandUpsActivity`**
   - Checks: `daily_resume_and_stand_up`
   - Schedules daily stand-up workflows

2. **`scheduleIndividualLeadGenerationActivity`**
   - Checks: `icp_lead_generation`
   - Schedules ICP lead generation workflows

3. **`scheduleIndividualDailyProspectionActivity`**
   - Checks: `leads_initial_cold_outreach`
   - Schedules daily prospection (lead follow-up) workflows

4. **`scheduleLeadQualificationActivity`**
   - Checks: `leads_follow_up`
   - Schedules lead qualification workflows on the selected weekdays

5. **`executeDailyProspectionWorkflowsActivity`**
   - Checks: `leads_initial_cold_outreach`
   - Executes daily prospection workflows immediately

## Logging

When a workflow is skipped due to inactive status:

```
⏭️ SKIPPING - '{activity_key}' is inactive in site settings
```

Example:
```
📋 Processing site: Example Site (abc-123)
   ⏭️ SKIPPING - 'icp_lead_generation' is inactive in site settings
```

## Database Requirements

The `settings` field must be included when fetching sites:

```typescript
// Correct - includes settings
const sites = await supabaseService.fetchSites(); // Uses SELECT *

// Or explicitly
.select('id, name, url, user_id, business_hours, settings')
```

## Use Cases

### Disable ICP Lead Generation for Specific Site

```json
{
  "settings": {
    "activities": {
      "icp_lead_generation": {
        "status": "inactive"
      }
    }
  }
}
```

### Disable All Cold Outreach

```json
{
  "settings": {
    "activities": {
      "leads_initial_cold_outreach": {
        "status": "inactive"
      },
      "leads_follow_up": {
        "status": "inactive"
      }
    }
  }
}
```

### Keep Only Daily Summaries

```json
{
  "settings": {
    "activities": {
      "daily_resume_and_stand_up": {
        "status": "default"
      },
      "leads_follow_up": {
        "status": "inactive"
      },
      "icp_lead_generation": {
        "status": "inactive"
      },
      "leads_initial_cold_outreach": {
        "status": "inactive"
      }
    }
  }
}
```

## Testing

To test this feature:

1. Update a site's settings in the database:
```sql
UPDATE sites 
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{activities}',
  '{
    "icp_lead_generation": {"status": "inactive"}
  }'::jsonb
)
WHERE id = 'your-site-id';
```

2. Trigger the activity prioritization engine
3. Check logs for skip messages
4. Verify that workflow was not scheduled for that site

## Future Enhancements

Potential additions to the `activities` configuration:

- **`priority`**: Set workflow execution priority
- **`schedule`**: Custom scheduling times per workflow
- **`max_items`**: Limit number of items processed per workflow
- **`filters`**: Additional filtering criteria

Example:
```json
{
  "icp_lead_generation": {
    "status": "default",
    "priority": "high",
    "max_items": 50,
    "schedule": "10:00"
  }
}
```

