# Recording LGU timetable fixtures

CI and tests **never** hit the live network — they replay recorded fixtures.
Recording is a **manual, local, one-time-ish** step that **you** run; the agent
never touches the university's servers. This doc is the exact procedure.

> The wire shapes currently in the adapter (`src/schemas.ts`, the endpoints in
> `src/fetch.ts`, and the URL→file mapping in `src/http.ts`) were **hand-written**
> from the documented behaviour, not from live traffic. Treat them as provisional
> until you record real responses and reconcile (Step 5).

## 0. Look at the developer API first

Open <https://lgutimetable.vercel.app/developer> and note the real endpoints and
response shapes (paths, query params, JSON structure). The adapter assumes:

- `GET {LGU_BASE_URL}/api/metadata` → `{ "combos": [{ semester, program, section }] }`
- `GET {LGU_BASE_URL}/api/timetable?semester=&program=&section=` → `{ "slots": [...] }`

If reality differs, you'll adjust the adapter in Step 5 — that's expected.

## 1. Record

From the repo root:

```bash
SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures
```

Optional overrides (env or `.env`):

```bash
LGU_BASE_URL=https://lgutimetable.vercel.app \
LGU_PHPSESSID=<only if the portal requires a session> \
SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures
```

The recorder establishes a session (bootstrap → env fallback → abort), fetches
metadata, then each combo's timetable with the bounded queue, and writes raw
responses to disk. It prints the session path it used and one line per combo.

## 2. Where the files land

```
packages/adapters/timetable-lgu/tests/fixtures/
  metadata.json
  timetable-<semester>-<program>-<section>.json   # one per combo
```

The per-combo filename is the sanitized `semester__program__section` key
(lowercased, non-alphanumerics collapsed to `-`) — see `fixtureFileFor` in
`src/http.ts`. The hand-written placeholders already there will be overwritten /
joined by your recorded ones.

## 3. Scrub before committing (required)

Fixtures are committed to the repo, so they must contain **no secrets and no
PII**:

- **Session values** — remove any `PHPSESSID`, cookies, `Authorization`/`token`
  fields, or CSRF values if they appear in a response body. (Never commit your
  `.env`; it's git-ignored.)
- **PII** — teacher emails, phone numbers, CNIC/ID numbers, or any personal
  contact detail. Keep names only if they're already public on the portal;
  otherwise replace with a placeholder (e.g. `Teacher A`). We store the minimum
  (CLAUDE.md §8).
- Prefer a **small, representative** slice (a few combos) over a full dump — big
  enough to cover lecture/lab/tutorial/exam and a missing teacher/room.

Grep to sanity-check:

```bash
grep -riE "phpsessid|authorization|token|cookie|@.*\.(edu|com)" \
  packages/adapters/timetable-lgu/tests/fixtures
```

## 4. Re-run the offline tests

```bash
pnpm --filter @campusos/adapter-timetable-lgu test
```

These run in `SOURCE_MODE=fixture` and assert zero network calls. If they pass,
the recorded shapes match the parser.

## 5. Reconcile the parser with reality (only if Step 4 fails)

Recorded responses usually reveal shape differences. Update, in order:

1. `src/schemas.ts` — the zod shapes for `metadata` and `timetable` responses.
2. `src/fetch.ts` — endpoint paths / query params, if different.
3. `src/http.ts` (`fixtureFileFor`) — the URL→fixture mapping, if endpoints changed.
4. `src/normalize.ts` — the mapping onto our terms/programs/sections/entries
   (e.g. how `type` maps to `kind`, how course codes/teachers are derived).

Re-run Step 4 until green, then run the full end-to-end against your local DB:

```bash
pnpm db:migrate:all && pnpm db:seed
SOURCE_MODE=fixture pnpm ingest:lgu   # then again → inserted=0 closed=0
```

Check `unmapped_source_values` for anything the normalizer couldn't map — those
are created `pending` for admin review, not dropped.

## 6. Commit

```bash
git add packages/adapters/timetable-lgu/tests/fixtures src/…   # + any parser changes
git commit -m "test(adapter-timetable-lgu): record real LGU fixtures"
```
