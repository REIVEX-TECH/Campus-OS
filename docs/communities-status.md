# Communities: phase status

Design: `docs/design-communities.md`.

| Item | What                                                     | State                   |
| ---- | -------------------------------------------------------- | ----------------------- |
| Doc  | Design                                                   | In review               |
| A1   | Schema, RLS, RBAC wiring, anonymity views, module shell  | Merged, `de2e2a0`       |
| A2   | Communities: create, settings, join, rules, rail         | Merged, `a2d49c6`       |
| A3   | Posts                                                    | Merged, `2218e04`       |
| A4   | Comments                                                 | Done (#94)              |
| A5   | Voting, ranking, feeds, pagination                       | Done (#95)              |
| A6   | Moderation, oversight, audited unmask                    | Done (#96)              |
| A7   | Anti-abuse                                               | Done (#97)              |
| A8   | UI and Playwright                                        | Done (#98)              |
| B1   | Polls                                                    | Done (#99)              |
| B2   | Notifications, unread count in the top bar               | Done                    |
| B3   | Search and the community directory                       | Done                    |
| B4   | Flairs, pinned ordering, crosspost, share                | Done                    |
| B5   | Profiles, karma toggle, saved and hidden, blocked list   | Done                    |
| B6   | Polish: counts, rules acceptance, archive after N months | **In review** (this PR) |

Deferred on purpose (design §14): media uploads, direct messages, awards, wiki,
email digests.

## Phase A: complete

Every step of Phase A is merged or in review: the schema and the anonymity
model (A1), communities and roles (A2), posts and votes (A3), comments (A4),
sorts and feeds (A5), moderation and oversight (A6), anti abuse (A7), and the
signed in journey under test (A8). Carried into Phase B, by design rather than
by omission: saved comments and the blocked list on a profile (B5), the
community icon and link on feed cards (B5), a tenant wide Held view for
oversight (B6), the audit line for a dissolution under test (B6), regular
expression filters (not planned).

## Phase B: complete

Polls (B1), notifications (B2), search and the directory (B3), flairs, pinned
order, crossposts and share (B4), profiles and private lists (B5), and the
polish step (B6: rules acceptance on a first post, the archive sweep and
reopen, flair pills on every feed, held items across the university) are
merged or in review. Left for later, by choice: user flairs, search over
comments, karma decay, comment paging on profiles, and email digests (design
§14). Live-database steps for each migration are in the PR bodies and
`docs/runbooks/`.
