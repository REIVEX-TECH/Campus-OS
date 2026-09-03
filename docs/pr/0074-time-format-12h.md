# feat(web): one time formatter, 12 hour by default, per tenant

Targets `main`. Presentation only: storage, ingestion, `content_hash`, the ICS
feed and JSON-LD are untouched.

## What

Times were rendered in 24 hour form in most places ("08:00 to 09:30", "13:00")
while the free-rooms picker showed "09:30 AM". They now agree, site wide, in the
form the tenant chooses.

- **One formatter**, `formatTime` / `formatHourLabel` / `formatTimeRange` in
  `@campusos/core/time`. Every time that becomes text goes through it: the list
  rows, the weekly grid and timeline blocks, both grid gutters, the course page,
  the free-slot chips and their intro, and the free-rooms summary. The old
  `hhmm` display helper is deleted, in both places it had been copied to, so
  there is nothing left to drift.
- **The form is a tenant setting**: `timeFormat: '12h' | '24h'`, defaulting to
  `12h`, set explicitly for LGU. It rides beside `locale` through the same
  props; nothing is hardcoded and a future tenant that wants "13:30" sets one
  field.
- **"8:00 AM to 9:30 AM", "1:00 PM to 2:30 PM"**: no leading zero on the hour,
  "to" from the i18n catalogue rather than a dash. Gutter labels read "8 AM, 9
  AM, 12 PM, 1 PM": no minutes, because a ruler is read at a glance and every
  label on it is on the hour.
- The native `<input type="time">` controls display per browser locale and
  keep the wire format as their value, by design. The text around them is what
  changed.

## Data & migration impact

No schema change. `tenantConfigSchema` gains `timeFormat` with a default, so no
other tenant config changes.

## Tests

- Unit, formatter: 8:00 AM, 9:30 AM, 1:00 PM, 2:30 PM; midnight as 12:00 AM,
  noon as 12:00 PM, 12:30 in each half, 11:59 in each half; database seconds
  accepted; 24 hour mode keeps the padded clock and never adds a period; hour
  labels including 0 and 24 as "12 AM"; malformed input throws rather than
  rendering nonsense.
- e2e, `time-format.spec.ts`: a teacher page, a room page and the section
  timetable's weekly grid render a 12 hour time and **no 24 hour time anywhere
  in the main content** (inputs excluded); the free-rooms summary reads
  "9:30 AM to 11:00 AM". The 24 hour detector deliberately has no word boundary
  after AM/PM, because `textContent` runs adjacent chips together and a boundary
  there would fail to exclude "11:30" in "11:30 AM1:00 PM".
- `pnpm turbo run typecheck lint test` (23 tasks), `pnpm --filter web build` and
  `pnpm --filter web test:e2e` pass.

## Verification steps

On any LGU page with a schedule: every time reads like "8:00 AM to 9:30 AM";
the weekly grid gutter reads "8 AM … 4 PM"; the free-rooms summary reads
"N free, Monday 9:30 AM to 11:00 AM". Set `timeFormat: '24h'` on a tenant and
the same pages read "08:00 to 09:30" and "08:00 … 16:00".

## Follow-ups

- `minutes()` in `views/time-scale.ts` and `toMinutes()` in the module are the
  same function; the grid still uses the local one for layout maths. Folding it
  is a small cleanup, deliberately not mixed into a presentation change.
- `toHHMM` in `tenant-time.ts` and `timetable-stats.ts` emit the wire format on
  purpose (URLs, keys, input values), not display text; they are not
  stragglers.
