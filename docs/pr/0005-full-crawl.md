# feat(timetable-lgu): full cartesian crawl (every semester, degree, section)

Targets `main`. No schema change, no migration. Adapter only.

## What

The LGU adapter's `crawl()` previously fetched a bounded slice (first semester →
first degree → up to 3 sections). This makes it walk the **full cartesian
product** the portal exposes, robustly.

- **Full crawl** (`fetch.ts`): every semester → every degree within it → every
  section within that → each section's `#table-time`. Returns
  `{ sections: RawSectionTimetable[], anomalies: CrawlAnomaly[] }`.
- **Robustness**: one bad section (or degree/section dropdown) is logged as an
  anomaly and skipped, never aborting the whole crawl; anomalies are emitted as
  unmapped records (normalize), never dropped. A real block (403/429/503) throws
  `PortalBlockedError` and aborts rather than hammering. In **fixture mode**, a
  not-recorded combo (`FixtureMissingError`) is skipped silently, so replaying a
  partial recorded slice yields exactly the recorded combos with no spurious
  anomalies.
- **Politeness**: the live client retries transient failures (incl. the flaky
  host's Vercel-edge 404 blips) with exponential backoff; optional caps
  (`LGU_MAX_SEMESTERS` / `LGU_MAX_DEGREES` / `LGU_MAX_SECTIONS`) bound a run.
- **Resilient session** (`session.ts`): `createAutonomousSession` now retries the
  mint GET through the host's intermittent bad bursts.
- **`normalize.ts`**: builds a batch across many semesters/degrees (not one), and
  maps crawl anomalies to unmapped records.
- **Recorder** (`record-fixtures.ts`): drives the same `crawl()` through a
  recording HTTP client, so the recorded fixture set always matches what fetch
  requests; scrubs session values and chrome PII; reports anomaly counts.

## ⚠️ Live full crawl + fresh full data: BLOCKED (host instability)

`timetable.lgu.edu.pk` intermittently round-robins between the real
Cloudflare-fronted PHP portal (200, sets `PHPSESSID`) and a Vercel edge that
404s, in bursts lasting minutes (confirmed by diagnostics; not a block, no
403/429/challenge). A full crawl spans multiple bad bursts, so a fresh full
recording and the real full ingest were **not** run (the overnight rules say stop
and report rather than hammer a failing host, and never fabricate data). Details
and the recommendation are in
[docs/overnight/DECISIONS.md](../overnight/DECISIONS.md). The crawler is ready and
resilient; run `record:fixtures` during a stable window to capture the full set.

## Data & migration impact

No schema change. No migration. Adapter is DB-pure.

## Tests

- `crawl.test.ts` (new): full cartesian traversal over a synthetic self-consistent
  fixture set; a not-recorded combo is skipped silently; a real (non-missing)
  fetch error becomes an anomaly and the crawl continues; politeness caps.
- `normalize.test.ts`: multi-semester/degree batch; anomalies → unmapped records.
- `source.test.ts`: fixture-mode source over the recorded real slice stays clean
  (three sections, zero anomalies, zero network).

```bash
pnpm --filter @campusos/adapter-timetable-lgu test   # 12 tests
pnpm turbo run typecheck lint format:check build test # all 22 tasks green
```

## Verification

Fixture-mode ingest into `campusos_dev` with the new crawl is unchanged from the
recorded slice (clean, no spurious anomalies):

```
persisting 41 entries (0 unknown)
inserted=41 closed=0 unchanged=0 unknown=56
```

The **real full ingest numbers are pending portal stability** (see the blocker
above). When the portal is stable: `record:fixtures` → `ingest:lgu` → map rooms
via the Phase 1 admin flow.

## Follow-ups

- Run the live full crawl + record the full fixture set once `timetable.lgu.edu.pk`
  stops flapping to the Vercel edge (likely an upstream LGU/DNS issue).
- Consider concurrency (bounded) for the full crawl once data volume is known.
