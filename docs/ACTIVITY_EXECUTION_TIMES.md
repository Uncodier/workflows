# Activity execution times

Daily Standup, Leads Follow Up and Leads Initial Cold Outreach share an explicit
execution-time choice in AI Activities. The UI uses the existing settings JSON;
there is no schema migration or live settings rewrite.

```json
{
  "start_time_mode": "business_opening"
}
```

```json
{
  "start_time_mode": "custom",
  "start_time": "10:30"
}
```

## Contract and compatibility

- `business_opening` resolves each execution day's business opening. It ignores
  any stale `start_time` retained by a partial settings merge, including invalid
  values. Switching back from custom time therefore does not require deleting keys.
- `custom` requires a strict 24-hour `HH:mm` value from `00:00` through `23:59`.
  Empty, null, padded, malformed and non-string times fail closed. Unknown or null
  modes also fail closed for scheduling and execution.
- Historical settings without a mode but with a time use that custom time, now
  including Cold Outreach. Historical settings without either field retain their
  existing behavior until a choice is saved. No account or activity is enabled
  implicitly by selecting a time.
- The UI shows a time input only for custom mode and persists the selected mode
  when saving a timed activity. Previously stored custom times remain visible.

## Business hours and weekdays

All times use the first entry of `settings.business_hours` (or the object itself).
The timezone falls back to `America/Mexico_City` when missing; invalid supplied
timezones block execution. Day entries support both `days.tuesday` and legacy
`tuesday`, and opening fields `start` or `open`.

- Opening mode skips days explicitly marked `enabled: false`. When an otherwise
  eligible day has no usable opening, it uses the existing `09:00` fallback.
- Standup and Follow Up retain their selected weekdays. Custom time can run on
  those explicitly selected days even when the business is closed.
- Cold Outreach retains business operating days in both modes. Explicitly enabled
  weekend entries can run; missing day entries use Monday–Friday. Closed entries
  are skipped. A selected time replaces the old opening-plus-two-hours offset.
- ICP mining remains distributed across 24 hours. Continuous and event-driven
  activities do not acquire an unsupported fixed-time control.

## Scheduling, execution and delivery

The scheduling activities resolve current persisted preferences, not a cached
business-hours analysis or activity map. Configured Cold Outreach and Follow Up
are considered independently of the prioritization engine's general business-hours
decision. Legacy unconfigured Cold Outreach keeps its existing orchestration.

UTC-minute search respects the IANA timezone, fractional offsets and date rollover.
A nonexistent spring-forward time runs at the first valid minute after the gap.
Repeated fall-back times use the first occurrence not earlier than the scheduler.
Workflow IDs retain per-site/local-day deduplication, and timeouts cover weekly
waits across daylight-saving changes.

Workflows re-read settings before paid work; Standup also checks before notification.
The outreach API independently checks the mode, operating/selected day and current
local start before actual delivery. The exact start minute and later minutes are
eligible; this setting is a start-time floor, not a closing-time cutoff.

Changing settings does not synchronously cancel or recreate live timers. A stale
timer firing before the updated start is skipped; the next prioritization pass
uses current preferences. Existing child workflow deduplication still applies to
same-day replacement after a completed skipped run.

## Rollout and verification

Deploy the compatible API first, then the Workflows worker and frontend. The
`configured-outreach-scheduling-v1` Temporal patch isolates the new orchestration
from recorded histories. Existing configuration activity results replay unchanged.

Run the timing, scheduling, engine and workflow Jest suites in Workflows, settings
and persistence tests in the frontend, and policy/delivery tests in the API. All
external services are mocked. Local validation requires no real sends, workflow
starts, remote migrations or deployments.