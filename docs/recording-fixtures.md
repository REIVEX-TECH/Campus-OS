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

## Record

```bash
SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures
```

The recorder mints an autonomous session, then makes a small polite set of
requests (semester panel → first semester's degrees → first degree's sections →
first 2–3 section timetables), with an honest User-Agent and delays between
requests, and writes raw responses to:

```
packages/adapters/timetable-lgu/tests/fixtures/
  semester-panel.html
  degrees__<semester>.html
  sections__<semester>__<program>.html
  timetable__<semester>__<program>__<section>.html   # ×2–3
```

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
