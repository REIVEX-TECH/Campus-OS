# Overnight run — paused decisions

Any irreversible / high-consequence fork that must NOT be guessed is recorded
here with a recommendation, and the phase is paused rather than guessed.

## Phase 2 — live full crawl paused (host instability)

**Status:** PAUSED the live portion. The full-crawl CODE and tests ship; the
fresh full real fixtures and the real full ingest numbers do NOT (blocked).

**What I observed (diagnostics, not a full crawl):**

- `https://timetable.lgu.edu.pk` intermittently round-robins between two very
  different origins, in bursts lasting minutes:
  - the real portal: `server: cloudflare`, `/index.php` -> 200 "Login Page"
    with `Set-Cookie: PHPSESSID`, the `login-btn` continue form present. Good.
  - a Vercel edge: `server: Vercel`, `/index.php` -> 404 "404: NOT_FOUND", no
    cookie. Bad.
- In a good burst, a raw GET returned PHPSESSID 5/5. Minutes later, both a raw
  GET and the adapter session mint failed 3/3 in lockstep (a bad burst). So it
  is genuine upstream flakiness, not our code (confirmed by an interleaved
  raw-vs-adapter test that tracked together). No 403/429/challenge: not a block,
  but not stable enough to crawl.

**Why paused (not guessed):** a full cartesian crawl is hundreds of requests
over many minutes and would span multiple bad bursts, producing heavily
incomplete data and forcing retry volume that approaches hammering a failing
host. The overnight rules say STOP and report on repeated portal errors rather
than hammer. Fabricating "real" data is not acceptable.

**What shipped instead (safe):** the full-crawl code is done and tested:
`crawl()` walks the full semester x degree x section product, logs one bad
section as an anomaly and continues, aborts only on a real block
(PortalBlockedError), and the live client retries transient failures (incl. the
Vercel-404 blips) with backoff. `createAutonomousSession` is now resilient
(retries the mint GET through bad bursts). The recorder captures the full set
via a recording HTTP client. A deterministic synthetic multi-combo fixture set
proves the traversal + anomaly handling.

**Recommendation (morning / when the host is stable):**

1. Run `SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures`
   during a stable window (it retries the session through blips). It records the
   FULL fixture set and prints anomaly counts; review the pages for chrome PII
   before committing.
2. `SOURCE_MODE=fixture pnpm ingest:lgu` (or `SOURCE_MODE=live`) for the real
   full ingest, then map rooms via the Phase 1 admin flow.
3. If the flakiness persists, it is an upstream LGU/DNS issue to raise with the
   university; our crawler is ready and resilient.

The app remains deployable with the Phase 1 data slice (1 semester, mappable
rooms); full data is pending portal stability, not pending our code.
