# Daily Standup configuration

AI Activities stores the delivery days and report contents in the existing
`settings.activities` JSON field; no new database columns are required.

```json
{
  "daily_resume_and_stand_up": {
    "status": "active",
    "weekdays": [1, 3, 5],
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
- Active configurations need at least one valid day and one valid section.
  Explicit empty, null, or invalid selections never fall back to sending everything.
- Saving a status change must retain the selection and neighboring activity settings.

## Scheduling and execution

The prioritization engine considers Daily Standup independently of the global
Monday/Friday and business-hours restrictions. Each site uses the next selected
weekday in its configured IANA timezone. The configured opening time for that
day is used where available; otherwise delivery is scheduled at 09:00, including
explicitly selected weekends. Without a configured timezone, the existing
`America/Mexico_City` default is retained. Invalid timezones block scheduling.

Scheduling uses the latest site settings rather than a cached activity map. The
workflow reloads settings at execution, so a timer created before preferences
changed cannot bypass disabled activities, excluded weekdays, or invalid section
selections. The workflow passes `report_sections` to the wrap-up API and the
notification API. It revalidates immediately before notification; a report whose
section selection changed during generation is not delivered.

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
Existing timers are checked when they fire; changing settings does not synchronously
cancel or recreate Temporal timers from the frontend. The next prioritization run
schedules any newly selected delivery date.

## Validation

Run the Jest Daily Standup suites in Workflows, the settings component/save suites
in the frontend, and the scoped report/notification suites in the API. All use
mocked external services; they must not send notifications or call a live model.