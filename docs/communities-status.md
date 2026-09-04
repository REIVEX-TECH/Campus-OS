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
| B2   | Notifications, unread count in the top bar               | **In review** (this PR) |
| B3   | Search and the community directory                       | Not started             |
| B4   | Flairs, pinned ordering, crosspost, share                | Not started             |
| B5   | Profiles, karma toggle, saved and hidden, blocked list   | Not started             |
| B6   | Polish: counts, rules acceptance, archive after N months | Not started             |

Deferred on purpose (design §11): media uploads, direct messages, awards, wiki,
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
