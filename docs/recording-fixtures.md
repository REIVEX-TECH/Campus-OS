# Recording LGU timetable fixtures

CI and tests **never** hit the network — they replay recorded fixtures.
Recording is a **manual, local** step **you** run against the live portal; the
agent never touches it (live sites are the human's side of the boundary).

> The public developer API (`lgutimetable.vercel.app`) is permanently dead (the
> site was sold — see `Zain-ul-din/LGU-Timetable#40`). Fixtures now come from the
> **real portal**, `https://timetable.lgu.edu.pk`. The wire protocol below was
> ported from the MIT-licensed `IIvexII/LGU-TimetableAPI` (see NOTICES.md).

## Wire protocol (what the recorder does)

All portal endpoints are **POST** with `Cookie: PHPSESSID=<session>` and a
form-urlencoded body; responses are **HTML**.

| Step      | Path                                             | Body                             | Response                          |
| --------- | ------------------------------------------------ | -------------------------------- | --------------------------------- |
| semesters | `Semesters/Semester_pannel.php`                  | _(none)_                         | page with `#semester` `<option>`s |
| degrees   | `Semesters/ajax.php`                             | `semester`                       | `<option>`s                       |
| sections  | `Semesters/ajax.php`                             | `semester`, `program`            | `<option>`s                       |
| timetable | `Semesters/semester_info/SEMESTER_TIMETABLE.php` | `semester`, `program`, `section` | `#table-time` table               |

The timetable table has one `<tr>` per weekday (`<th>` = day name); each `<td>`
is a 30-minute session and a class spans `colspan` sessions from 08:00, with
`span:nth-child(1|3|5)` = subject / room / teacher.

## The session (required)

The portal serves **nothing** without an authenticated login, so recording (and
live mode) need a real `PHPSESSID`:

1. Log in to `https://timetable.lgu.edu.pk` in a browser.
2. DevTools → Application → Cookies → copy the value of **`PHPSESSID`**.
3. Put it in `.env` as `LGU_PHPSESSID=…` (git-ignored; never paste it in chat).
   Sessions expire — re-copy when recording fails with "session invalid/expired".

## Record

```bash
LGU_PHPSESSID=<in .env>  SOURCE_MODE=live \
  pnpm --filter @campusos/adapter-timetable-lgu record:fixtures
```

The recorder reads `LGU_PHPSESSID` from `.env`, makes a small polite set of
requests (semester panel → one semester's degrees → one degree's sections →
2–3 section timetables), with an honest User-Agent and delays between requests,
and writes raw responses to:

```
packages/adapters/timetable-lgu/tests/fixtures/
  semester-panel.html
  degrees__<semester>.html
  sections__<semester>__<program>.html
  timetable__<semester>__<program>__<section>.html   # ×2–3
```

## Scrub before committing (required)

- The recorder redacts `PHPSESSID=…` and **aborts** if any session value would
  be committed.
- It cannot reliably detect **PII in the page chrome** (e.g. your name in a
  header/nav). **Review each `.html`** and delete any personal data before it is
  committed. Public course/teacher/room/section labels are fine to keep.

Grep as a sanity check:

```bash
grep -riE "phpsessid=(?!redacted)|logged in as|welcome," \
  packages/adapters/timetable-lgu/tests/fixtures
```

## Hand back → the agent reconciles (unattended)

Once recorded and reviewed, hand the results back. The agent then verifies the
files on disk and reconciles the adapter to the real shapes:

1. Replace the provisional JSON fixtures with the recorded HTML.
2. Update `schemas.ts` (HTML validation), `fetch.ts` (POST endpoints + params),
   `http.ts` (fixture lookup by path+params), and `normalize.ts` (parse
   `#table-time` → entries; map dropdowns → terms/programs/sections).
3. Update `normalize.test.ts` / `source.test.ts` to the HTML fixtures.
4. Run all gates and a fixture-mode ingest against `campusos_dev`.
