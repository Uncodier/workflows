# Workflow Activities Settings

## Overview

This document describes the workflow scheduling control system using `settings.activities` in site configuration.

Daily Standup supports selected delivery weekdays, an optional `start_time`
(`HH:mm` in the site's timezone), and report sections in AI
Activities. See [Daily Standup configuration](./DAILY_STANDUP_CONFIGURATION.md)
for defaults, validation, scheduling, and deployment details.

For the account, audience, weekday, start-time, and daily delivery controls on Cold Outreach and
Follow Up, see [Outreach configuration](./OUTREACH_CONFIGURATION.md). Both activities
are opt-in: absent, `default`, or `inactive` status does not permit execution.

ICP mining is the exception: it is always enabled, independent of outreach and
outbound-channel health. AI Activities configures `target_leads` (1–3000, default
150), `research_enabled` (default false), and the pending-list scope (`all_lists`
defaults to true; otherwise use `list_ids`), not activation. See
[ICP mining configuration](./ICP_MINING_CONFIGURATION.md) for deployment and cursor details.
Daily mining is distributed per site across 24 hours, independently of business
hours; it has no fixed-time control. Standup and Follow Up support optional
`start_time` alongside weekdays. Missing times preserve their previous behavior
(Standup opening time/09:00 fallback, Follow Up 09:00); invalid supplied times block
execution rather than falling back silently.

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
        "status": "active",
        "target_leads": 150,
        "research_enabled": false,
        "all_lists": true,
        "list_ids": []
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
- **`inactive`**: Workflow is **NOT** scheduled for this site, except always-on ICP mining

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
  if (activityKey === 'icp_lead_generation') return true;
  const optIn = new Set([
    'supervise_conversations', 'assign_leads_to_team', 'local_lead_generation',
    'daily_resume_and_stand_up',
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

2. **`scheduleIcpMiningWorkflowsActivity` / `scheduleIndividualLeadGenerationActivity`**
   - The dedicated ICP scheduler spreads daily mining across 24h independently of business hours and activation/outreach; reads mining parameters at execution time
   - Local lead generation retains its existing activation check and business-hours schedule

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
   ⏭️ SKIPPING - 'local_lead_generation' is inactive in site settings
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

### Configure ICP Lead Generation for a Specific Site

```json
{
  "settings": {
    "activities": {
      "icp_lead_generation": {
        "status": "active",
        "target_leads": 25,
        "research_enabled": true
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

### Keep Daily Summaries and Mining Without Outreach

```json
{
  "settings": {
    "activities": {
      "daily_resume_and_stand_up": {
        "status": "active"
      },
      "leads_follow_up": {
        "status": "inactive"
      },
      "icp_lead_generation": {
        "status": "active"
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
UPDATE settings
SET activities = jsonb_set(
  COALESCE(activities, '{}'::jsonb),
  '{local_lead_generation}',
  '{"status": "inactive"}'::jsonb
)
WHERE site_id = 'your-site-id';
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
    "status": "active",
    "priority": "high",
    "target_leads": 50,
    "schedule": "10:00"
  }
}
```

