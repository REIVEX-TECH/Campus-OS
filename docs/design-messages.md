# Design: Direct messages

Private 1:1 messaging between two members of one tenant. A new `messages` module,
opt-in per tenant, built on the same tenancy/RLS discipline as the rest of the
platform. This document is the agreed design; the decisions below are settled.

## Scope

- **1:1 only.** No group threads. A conversation is exactly two participants.
- **New module `packages/modules/messages`** with its own migration, its own
  `__drizzle_migrations_messages` bookkeeping table, a manifest, and a tenant
  opt-in via `enabledModules`. A disabled tenant contributes zero routes, nav, or
  queries (the module discipline in CLAUDE.md §4).
- **Calls are out of scope** — see `docs/design-calls.md`.

## Who can message whom

- A tenant setting `whoCanMessage`: `verified` (default) | `anyone` | `nobody`.
  - `verified`: only verified members may be messaged, and only a verified member
    may start a conversation.
  - `anyone`: any member may message any member.
  - `nobody`: messaging is effectively off for the tenant (the module may be
    enabled but no one can start a thread).
- **Initiating requires a verified membership** regardless (a spam-control floor),
  enforced in the write path (`isVerifiedMember`), not through
  `auth_effective_permissions` (which encodes status/standing, not `verified_at`).
- **Blocks are honored both ways.** If either party has blocked the other
  (`user_blocks`, either direction), a send is refused and no conversation opens.
  This reuses the communities block, checked in both directions.

## Data model

Module tables, all tenant-scoped (`tenant_id`), all under RLS:

- **`msg_conversations`**: `id`, `tenant_id`, the two participants
  (`participant_a`, `participant_b`, ordered so a pair maps to one row — a partial
  unique on the ordered pair), `ephemerality` (`never` | `after_24h` |
  `after_viewing`, per-conversation, default `never`), `created_at`,
  `last_message_at` (for inbox ordering).
- **`msg_participants`** (or per-participant state on the conversation): each
  participant's `last_read_at` (read receipts) and a `cleared_at` (delete-for-me).
  Two rows per conversation, keyed `(conversation_id, participant_id)`.
- **`msg_messages`**: `id`, `tenant_id`, `conversation_id`, `sender_id`, `body`
  (text), `reply_to_id` (nullable self-FK, reply-to), `created_at`, `edited_at`,
  `deleted_at` (delete-for-everyone tombstone), `deleted_for` (delete-for-me: the
  participant who cleared it), `expires_at` (ephemerality; null = never),
  `first_viewed_at` (for `after_viewing`).

## RLS (the boundary, §4/§8)

- **Participant-only, FORCE on.** Every row (conversation, participant state,
  message) is visible only to a participant: the RLS policy keys on
  `participant_id = current_setting('app.user_id')` (for participant/message rows,
  the message's conversation must have the caller as a participant). FORCE is on
  so the guarantee binds the owner too; the application role is a non-owner and
  stays confined regardless.
- **Moderation reads go through an owner-run definer**, gated on a new
  `messages.moderate` permission via `auth_effective_permissions` — never a bare
  tenant read. The definer is the ONLY cross-participant reader. This is the
  lost-found-claims pattern; because a definer must read across, the moderated
  read table(s) are **NO FORCE** while the app role stays confined by policy (the
  documented FORCE/NO FORCE trade-off), OR FORCE stays on and the moderator read
  is served from a report snapshot (see Moderation). §6 the concrete SQL.
- Writes are the sender's own: a RESTRICTIVE insert-as-self policy
  (`sender_id = app.user_id`) plus the participant/tenant policy, so a message can
  only be written by its sender into a conversation they belong to.

## Message lifecycle

- **Body + reply-to**: plain text; `reply_to_id` references another message in the
  same conversation.
- **Read receipts**: a participant's `last_read_at` advances when they open the
  thread; the other side sees "read".
- **Edit within 5 minutes** of sending (`created_at + 5 min`), sets `edited_at`.
- **Delete-for-me** any time (`deleted_for` / per-participant clear) and
  **delete-for-everyone within 1 hour** (`deleted_at` tombstone; the row stays as
  "deleted" so the thread does not renumber).
- **Ephemerality per conversation** (`never` | `after_24h` | `after_viewing`):
  - `after_24h`: `expires_at = created_at + 24h`.
  - `after_viewing`: on first view by the recipient, `expires_at = now() + 60s`
    (a grace window so it does not vanish mid-read).
  - Read queries filter out `expires_at <= now()`; a **cleanup script**
    (`scripts/cron-messages-cleanup.sh`, every 15 min) HARD-deletes expired rows
    so they do not linger in the table.

## Moderation

- Reuse the existing polymorphic reports concern. A report on a message stores a
  **snapshot** of the reported message plus the surrounding ~5 messages for
  context, readable by a moderator through an owner-run definer gated on
  `messages.moderate`. The reporting UI says plainly: **"Reporting saves a copy
  for moderators."**
- If `itemType` on the shared reports table cannot take `'message'` (it may be a
  fixed enum), the messages module keeps its **own** `msg_reports` table with the
  snapshot (the same §4 call the L&F module made for `lf_reports`), and a
  `messages.moderate` definer reads the queue. Decided at build time from the
  reports schema; either way the moderator path is a definer, not a bare read.
- Ships **with** the feature, not later (CLAUDE.md §8: threat-model
  user-to-user features; reporting + blocking + a moderation queue in the same
  release).

## Delivery + UI

- **Polling, not websockets** (no realtime infra dependency, §2): the open thread
  polls every ~3s, the inbox every ~15s, and both back off when the tab is hidden.
- **Optimistic send**: the composer shows the message immediately and reconciles
  on the response.
- **Notification + unread count**: reuse the existing notifications surface for a
  new-message notification and the sidebar unread count. (If writing the
  communities `notifications` table cross-module is disallowed by §4, this is the
  same shared-notifications gap L&F flagged; messages either writes through a core
  notifications seam if one exists, or surfaces unread from its own tables and the
  cross-module notification is deferred — decided at build time from the
  notifications ownership.)
- **Routes**: `/u/[slug]/messages` (inbox) and `/u/[slug]/messages/[id]` (thread).

## Rate limits

- 30 messages/minute per sender; 20 new conversations/day per initiator. Enforced
  in the write path (the `rate-limit` seam), on top of RLS.

## Permissions

- Sending/reading are gated on membership + the `whoCanMessage` setting + blocks,
  not a role permission (any verified member may message). The only role
  permission is **`messages.moderate`** (the reports queue + snapshot read), added
  to the `tenant_admin` template with the moderation migration that checks it.

## PR sequence (estimate)

1. Module scaffold + migration (tables, participant RLS FORCE, insert-as-self),
   manifest, `whoCanMessage` setting. §6.
2. Send/read services (start conversation, send, read receipts, edit/delete
   windows, ephemerality), the gate + rate limits, blocks + verified checks.
3. Moderation: report-with-snapshot + `messages.moderate` definer + queue. §6.
4. UI: inbox + thread, polling, optimistic send, unread surfacing.
5. Cleanup cron + runbook; enable for LGU (config change).
