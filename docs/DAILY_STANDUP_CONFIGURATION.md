# Daily Standup configuration

AI Activities stores the delivery days, execution-time choice, and report contents in the existing
`settings.activities` JSON field; no new database columns are required.

```json
{
  "daily_resume_and_stand_up": {
    "status": "active",
    "weekdays": [1, 3, 5],
    "start_time_mode": "custom",
    "start_time": "10:30",
    "report_sections": ["sales", "tasks", "orders", "inventory"]
  }
}
```

## Contract

- `status`: requires explicit `active`. Missing, `default`, or `inactive` does not
  enable delivery.
- `weekdays`: integer weekday numbers, Sunday `0` through Saturday `6`.
  Missing values preserve the previous Monday/Friday default (`[1, 5]`).
- `report_sections`: any selection of `sales`, `tasks`, `requirements`, `social`,
  `channels`, `records`, `orders`, `reservations`, and `inventory`.
  Missing values select all nine sections.
- `start_time_mode`: `business_opening` or `custom`. Opening resolves the selected
  day's business hours and ignores stale custom times retained by partial merges.
- `start_time`: site-local 24-hour `HH:mm` string (`00:00`–`23:59`), required for
  custom mode. Empty, null, malformed, padded, or non-string values block scheduling
  and execution unless opening mode is explicitly selected. A historical time
  without a mode remains custom; absence of both preserves legacy behavior.
- Active configurations need at least one valid day and one valid section.
  Explicit empty, null, or invalid selections never fall back to sending everything.
- Saving must retain report/day selections and neighboring activity settings.
  Returning to opening behavior saves `"start_time_mode": "business_opening"`;
  deleting the old time is not required. See [Activity execution times](./ACTIVITY_EXECUTION_TIMES.md)
  for the shared UI, persistence and scheduling contract.

## Scheduling and execution

The prioritization engine considers Daily Standup independently of the global
Monday/Friday and business-hours restrictions. Each site uses the next selected
weekday in its configured IANA timezone. Custom mode uses `start_time`, including
on explicitly selected closed days. Opening mode skips explicitly disabled days
and uses that day's opening or the `09:00` fallback if unavailable. Legacy
unconfigured schedules retain their previous per-day opening/fallback behavior.
Without a configured timezone, the existing
`America/Mexico_City` default is retained. Invalid timezones block scheduling.

Schedulers search actual UTC minutes, supporting fractional offsets and local date
rollover. A start in a spring-forward gap runs at the first valid minute after the
gap. A repeated fall-back time uses the first matching occurrence not before the
scheduler's current time, consistently with `nextDailyStandUpRun`.

Scheduling uses the latest site settings rather than a cached activity map. The
workflow reloads settings at execution, so a timer created before preferences
changed cannot bypass disabled activities, excluded weekdays, invalid section
selections, or a start moved later during the delay. Before the selected opening/custom time,
execution is skipped; the exact local minute and later times remain eligible on a
selected day. No new opening-time/09:00 runtime restriction is imposed when the
mode and time are both missing. The workflow passes `report_sections` to the wrap-up API and the
notification API. It revalidates immediately before notification; a report whose
section selection changed during generation is not delivered. A start moved later
during generation also blocks early notification.

The API restricts data collection, model context, generated section rendering,
and notification presentation to the selected report sections. It does not append
the previous generic business-health assessment to a scoped report.
New workflow executions require the API response to confirm the selected sections
and contain a nonempty message; an older API response that ignores the selection
is rejected rather than delivered.

The report retains the previous collector's previous-day UTC window for recent
records. Social metrics and inventory quantities are explicitly labeled current
snapshots, not daily changes. Dataset samples are bounded and identified as such.

## Rollout

Deploy the API report/notification support, the Workflows worker (including the
registered `getDailyStandUpConfigurationActivity`), and the AI Activities frontend
together. Deploy API support before workers start sending `report_sections`.
No production deployment, live notification, or database migration is performed by
the local implementation/tests.

The `daily-standup-configuration-v1` Temporal patch preserves historical command
sequences while new runs use configurable scheduling and execution validation.
Start-time validation extends the existing configuration activity response without
changing workflow commands or adding a patch marker. Recorded results replay
unchanged; historical pre-configuration paths retain their original behavior.
Existing timers are checked when they fire; changing settings does not synchronously
cancel or recreate Temporal timers from the frontend. The next prioritization run
schedules using the current preferences. A stale timer blocked by a later start is
skipped, not automatically slept/rescheduled. The existing per-site/day child ID
deduplication still applies, so same-day replacement after a completed skipped run
is not guaranteed.

## Validation

Run the Jest Daily Standup suites in Workflows, the settings component/save suites
in the frontend, and the scoped report/notification suites in the API. All use
mocked external services; they must not send notifications or call a live model.