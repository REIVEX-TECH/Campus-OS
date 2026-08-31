# Recording LGU timetable fixtures

CI and tests **never** hit the network — they replay recorded fixtures.
Recording is a deliberate step run against the **live portal**; CI never records.

> The public developer API (`lgutimetable.vercel.app`) is permanently dead (the
> site was sold — see `Zain-ul-din/LGU-Timetable#40`). Fixtures now come from the
> **real portal**, `https://timetable.lgu.edu.pk`. The wire protocol below was
> ported from the MIT-licensed `IIvexII/LGU-TimetableAPI` (see NOTICES.md).

## The session is autonomous (no human credential)

The portal no longer sits behind a login. `index.php` is a **landing page** with
a single "Continue to Home Page" button — a `<form method="POST" action="index.php">`
whose submit is named `login-btn`. The recorder mints its own session:

1. `GET index.php` → receive a fresh anonymous `PHPSESSID` cookie.
2. `POST index.php` with body `login-btn=` → activates that session.
3. The activated `PHPSESSID` is then accepted by all data endpoints.

No human cookie is needed. `LGU_PHPSESSID` in `.env` is only an **optional
override** (e.g. to reuse a browser session); leave it unset for the normal
autonomous flow. `createAutonomousSession()` (`src/session.ts`) implements this.

## Wire protocol (what the recorder does)

All data endpoints are **POST** with `Cookie: PHPSESSID=<session>` and a
form-urlencoded body; responses are **HTML**.

| Step      | Path                                             | Body                             | Response                          |
| --------- | ------------------------------------------------ | -------------------------------- | --------------------------------- |
| semesters | `Semesters/Semester_pannel.php`                  | _(none)_                         | page with `#semester` `<option>`s |
| degrees   | `Semesters/ajax.php`                             | `semester`                       | `<option>`s                       |
| sections  | `Semesters/ajax.php`                             | `semester`, `program`            | `<option>`s                       |
| timetable | `Semesters/semester_info/SEMESTER_TIMETABLE.php` | `semester`, `program`, `section` | `#table-time` table               |

The `#table-time` table has one `<tr>` per weekday (`<th>` = day name). Each
class `<td>` holds `<span>`s in order **subject / room / teacher / section /
time**, where the time span is an explicit `"HH:MM - HH:MM"` — the parser
prefers it and falls back to `colspan`-derived time (each `colspan` = a 30-minute
session from 08:00). Free slots render as `X` / "All slots are free" (no spans).
Course titles containing "lab" (case-insensitive) are classified `lab`, else
`lecture`.

## Record (full crawl)

```bash
SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures
```

The recorder mints an autonomous session, then drives the **full** `crawl()`
(every semester × degree × section) through a recording HTTP client that writes
every response to its fixture file. It is polite (honest User-Agent, delay,
backoff), skips and logs one bad section rather than aborting, and stops on a
real block. It prints the section and anomaly counts at the end. Files written:

```
packages/adapters/timetable-lgu/tests/fixtures/
  semester-panel.html
  degrees__<semester>.html                            # per semester
  sections__<semester>__<program>.html                # per (semester, program)
  timetable__<semester>__<program>__<section>.html    # per (semester, program, section)
```

Politeness caps (`LGU_MAX_SEMESTERS` / `LGU_MAX_DEGREES` / `LGU_MAX_SECTIONS`)
can bound a recording run.

> **Host stability.** `timetable.lgu.edu.pk` intermittently round-robins to a
> Vercel edge that 404s in bursts (not a block). The session mint and live client
> retry through the blips, but a full crawl during a bad burst will accumulate
> anomalies. Record during a stable window; a genuine 403/429/503 aborts the run.

## Scrub before committing (required)

- The recorder redacts `PHPSESSID=…` / `cf_clearance=…` and **aborts** if any
  live session value would be committed.
- It cannot reliably detect **PII in the page chrome** (e.g. a staff name in the
  nav/footer). **Review each `.html`** and redact incidental personal data before
  committing — the recorded fixtures here have the "Project Incharge" credit
  replaced with `REDACTED`. Public course/teacher/room/section labels _are_ the
  product data and stay.

Grep as a sanity check:

```bash
grep -riE "phpsessid=(?!redacted)|cf_clearance=[a-z0-9]" \
  packages/adapters/timetable-lgu/tests/fixtures
```

Recorded HTML is treated as a byte-for-byte artifact: it is excluded from
Prettier (`.prettierignore`) because the portal markup is intentionally malformed.
