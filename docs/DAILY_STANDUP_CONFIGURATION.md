# Daily Standup configuration

AI Activities stores the delivery days, optional start time, and report contents in the existing
`settings.activities` JSON field; no new database columns are required.

```json
{
  "daily_resume_and_stand_up": {
    "status": "active",
    "weekdays": [1, 3, 5],
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
- `start_time`: optional site-local 24-hour `HH:mm` string (`00:00`–`23:59`).
  A supplied valid value overrides business opening times on every selected weekday.
  Missing preserves the existing per-day opening time / `09:00` fallback. Empty,
  null, malformed, whitespace-padded, or non-string values block scheduling and execution;
  they do not reset the time or fall back. Internal configuration responses expose
  the validated value as optional `startTime`.
- Active configurations need at least one valid day and one valid section.
  Explicit empty, null, or invalid selections never fall back to sending everything.
- Saving a status change must retain the selection, start time, and neighboring activity settings.
  Untouched missing times must remain missing. A fixed `09:00` reset saves `"09:00"`;
  for Standup this is not a return to business-opening behavior. Restoring that legacy
  behavior requires removing the key through a persistence path that supports deletion;
  omitting it from a partial merge does not delete an existing value.

## Scheduling and execution

The prioritization engine considers Daily Standup independently of the global
Monday/Friday and business-hours restrictions. Each site uses the next selected
weekday in its configured IANA timezone. The activity's `start_time` takes precedence.
When it is absent, the configured opening time for that day is used where available;
otherwise delivery is scheduled at 09:00, including
explicitly selected weekends. Without a configured timezone, the existing
`America/Mexico_City` default is retained. Invalid timezones block scheduling.

Schedulers search actual UTC minutes, supporting fractional offsets and local date
rollover. A start in a spring-forward gap runs at the first valid minute after the
gap. A repeated fall-back time uses the first matching occurrence not before the
scheduler's current time, consistently with `nextDailyStandUpRun`.

Scheduling uses the latest site settings rather than a cached activity map. The
workflow reloads settings at execution, so a timer created before preferences
changed cannot bypass disabled activities, excluded weekdays, invalid section
selections, or a start moved later during the delay. Before an explicit start time,
execution is skipped; the exact local minute and later times remain eligible on a
selected day. No new opening-time/09:00 runtime restriction is imposed when the
field is missing. The workflow passes `report_sections` to the wrap-up API and the
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