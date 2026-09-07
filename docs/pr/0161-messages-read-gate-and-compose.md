# fix(messages): serve the client reads and fix compose from a profile

After the widget and two-pane landed, `/u/lgu/messages` showed "No messages yet"
in the list with no Requests section, a deep link to a real thread rendered "No
messages yet. Say hello.", and the compose sheet's recipient search returned "No
one found." for a handle on the page. All three are the same cause; a fourth,
separate bug affected compose from a profile.

## Root cause

The three empty reads share one gate. `messagesReadGate` guarded the GET routes
(inbox, thread, recipient search) with `isSameOrigin`, which refuses a request
that carries no `Origin` header. That check is right for a POST (a browser always
sends `Origin` on one), but a browser sends **no `Origin` on a same origin GET
`fetch`**. So every one of the page's own polls was refused with 403 `{error:
'origin'}`, and each client fell back to its empty state. The POST routes were
never affected, which is why sending worked while nothing could be read back.

Compose from a profile was a second, unrelated bug: the sheet seeded its
`recipient` from `fixedRecipient` into state and then reset it from an effect,
and the `MessageButton` passes a fresh `fixedRecipient` object on every render, so
the state could fall back to null and show the recipient search with no body
field instead of the fixed "To: handle" and the message box.

## What

- **`lib/same-origin.ts`** gains `isNotCrossOrigin`, the read side counterpart of
  `isSameOrigin`: it allows a missing `Origin` (a same origin GET) and refuses only
  an `Origin` that is present and points at another host. That is safe for a read:
  the `SameSite=Lax` session cookie is not sent on a cross site fetch, so a cross
  origin caller is unauthenticated, and the same origin policy hides the response
  from any cross origin script. `isSameOrigin` is unchanged and still guards every
  mutation.
- **`lib/messages-route.ts`** `messagesReadGate` uses `isNotCrossOrigin`. The three
  GET routes now serve the signed in page's own reads. The mutation gate
  (`messagesGate`) is untouched.
- **`app/_components/messages/compose-sheet.tsx`** derives `recipient` as
  `fixedRecipient ?? picked` instead of holding it in resettable state. A fixed
  recipient is now authoritative: the sheet always shows "To: handle" plus the body
  field and never the search, regardless of effect timing or object identity. The
  picker path (the widget's "new message") is unchanged.
- **`tenants/lgu/tenant.config.ts`** enables the `messages` module for LGU. It was
  live in production through the tenant's database config row but the file default
  never caught up, so the module was unreachable in a fresh checkout and in CI.
  That gap is why none of this was covered by a test. A database config row still
  wins over the file, so this does not change production.

## Data & migration impact

No schema change.

## Tests

- **Unit** (`test/same-origin.test.ts`): `isNotCrossOrigin` accepts a same origin
  GET with no `Origin` (the exact case that broke the reads) and a present same
  host `Origin`, and refuses a present cross origin `Origin`.
- **E2E** (`e2e/messages.spec.ts`): a signed in, end to end journey. An owner opens
  compose from a member's profile and the sheet shows the fixed recipient and body
  (not the search), then sends; the member sees the request and its message in the
  list and accepts; the thread renders for the recipient; and the recipient search
  finds a member by handle. Every step reads through a GET route, so the read
  regression fails the suite and compose from a profile is covered.

Run:

```bash
pnpm --filter @campusos/web test -- same-origin
pnpm --filter @campusos/web test:e2e -- messages
```

Typecheck, lint, format and the web unit suite are green locally. Integration and
e2e are CI only.

## Verification

1. Sign in on `lgu`, open `/u/lgu/messages`: the active chats and the Requests
   section render; a deep link to a thread shows its messages.
2. `GET /api/messages?tenant=lgu` returns 200 with the inbox, not 403 `{error:
'origin'}`.
3. Open compose from a member's profile: it shows "To: handle" and the message
   box, and the recipient search finds a member by handle.

## Follow-ups

None.
