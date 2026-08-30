# Third-Party Notices

Campus OS is MIT-licensed (see [LICENSE](LICENSE)). This file records
attributions for external work incorporated into or informing the project.

## LGU timetable portal — ported wire protocol (MIT)

`@campusos/adapter-timetable-lgu` interoperates with Lahore Garrison
University's timetable portal (`https://timetable.lgu.edu.pk`). Its wire
protocol — the POST endpoints (`Semester_pannel.php`, `Semesters/ajax.php`,
`SEMESTER_TIMETABLE.php`), the form-encoded request shapes, the PHPSESSID
session behaviour, and the `#table-time` HTML structure with 30-minute
`colspan` sessions — is **ported from**
[`IIvexII/LGU-TimetableAPI`](https://github.com/IIvexII/LGU-TimetableAPI),
which is **MIT-licensed**. Copyright © its authors; used under the MIT License.

We are grateful to that project for mapping the portal.

## `Zain-ul-din/lgu-crawler` — not used

The sibling project
[`Zain-ul-din/lgu-crawler`](https://github.com/Zain-ul-din/lgu-crawler)
covers similar ground but publishes **no licence** (all rights reserved by
default). Its source is **not** read, copied, ported, or vendored here. If it
later adopts an OSI licence this note will be revisited; nothing depends on that.
