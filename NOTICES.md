# Third-Party Notices

Campus OS is MIT-licensed (see [LICENSE](LICENSE)). This file records
attributions for external work that informed the project.

## LGU timetable — prior art

The `@campusos/adapter-timetable-lgu` package interoperates with Lahore Garrison
University's public timetable source. Its design was **informed by** the
community project [`Zain-ul-din/lgu-crawler`](https://github.com/Zain-ul-din/lgu-crawler),
which first documented the portal's behaviour (the PHPSESSID session
requirement, the dropdown metadata endpoint, and the
`sha256("{semester} {program} {section}")` keying scheme).

**Attribution is a courtesy, not a licence grant.** At the time of writing that
repository publishes **no licence**, which under default copyright law reserves
all rights to its author. Accordingly:

- No source code from `lgu-crawler` has been copied, ported, adapted, or
  vendored into this repository.
- Our adapter is a clean-room implementation written against **publicly
  observable behaviour** — the public developer API response shapes and the
  live HTTP responses of the portal — which are functional facts, not
  copyrightable expression.

If the upstream project later adopts an OSI-approved licence (e.g. MIT), this
notice will be updated; our implementation does not depend on that happening.

We are grateful to the upstream author for mapping the portal's quirks.
