# feat(identity): Google sign in, sessions, and the current actor

Targets `main`. Identity PR 2. Sign in exists and creates an account; **it gates
nothing**. Timetables, free rooms, search and the directories stay open to
everyone, signed in or not, and an e2e test pins that.

## What

- **Provider behind an interface.** `@campusos/core/auth` defines
  `IdentityTokenVerifier`: given a token, return a verified subject and email, or
  refuse. Nothing outside the identity module's implementation imports a vendor
  SDK (CLAUDE.md 2).
- **Server-side verification with `jose` (MIT), not the Firebase Admin SDK.**
  Verifying an ID token needs only Google's published keys and the project id,
  which is itself public, so there is **no service account key to hold, rotate or
  leak**. Audience and issuer are pinned to the project, so a token minted for a
  different Firebase project cannot be replayed. An unverified email is refused
  outright, since the membership model keys off the email domain.
- **Sessions are opaque random tokens, not JWTs**, stored only as a sha256 hash,
  so a database dump yields no usable session and signing out is immediate rather
  than "wait for the token to expire".
- **`currentActor()`** resolves the session on every call, so a revoked session
  dies on the next request. With no cookie it does not touch the database at all,
  so a public page pays nothing for it.
- **Sign in page** at `/u/[slug]/signin`, plus an account row in the sidebar foot
  showing the handle (or "Sign in"). Handles are a placeholder here
  (`Member_<id>`); the real generator and the change flow are PR 3, as planned.
- `pageMetadata` gains `noIndex`, used by the account page.

## Two decisions worth flagging

**The Firebase SDK is loaded from Google's own ESM build on click, not bundled.**
`pnpm add firebase` pulls a very large dependency for exactly one interaction;
bundling it would put roughly a hundred kilobytes in front of every reader of a
public timetable to serve the few who sign in. Loading it on demand costs the
signer one fetch and everyone else nothing, and signing in already requires
reaching Google. The signin route's First Load JS is **104 kB**, unchanged from a
normal page. The version is pinned in one constant.

**Sign in degrades rather than breaks when unconfigured.** With no Firebase
project set, the page says so plainly and the endpoint returns 503. That is the
state CI runs in, and it is asserted, because the public site must never depend
on an identity provider existing.

## Data & migration impact

One migration, `0003_resolve_user`: a second `SECURITY DEFINER` function,
`auth_resolve_user_by_subject`. Sign in has the same shape as session
resolution: we hold a verified token naming a Google subject but not yet a user
id, so the read cannot satisfy the own-row policy. It is a single exact-match
lookup that returns nothing without the exact subject from a token Google signed,
so it cannot enumerate users. These two functions are the only privileged reads
in the system.

## Tests

- Unit (8): the verifier is absent when unconfigured, refuses an empty and a
  malformed token, and never echoes the token back in its error; token hashing is
  deterministic and never contains the token.
- Integration (6): first sign in creates a user, a second finds the same one, an
  upstream email change follows the subject rather than creating a duplicate, a
  session resolves back to its user, an unknown token resolves to nothing, a
  revoked session stops working immediately, and the table stores only a hash.
- e2e (5, 40 total): the page reports the unconfigured provider, the sidebar
  offers sign in, **the public site works with no session at all**, signing out
  with no session is accepted, and the endpoint refuses an unverifiable token
  without setting a cookie.
- `pnpm turbo run typecheck lint build test` (24 tasks) passes.

The identity integration suite runs only against a split database, by design, so
CI is where it is verified.

## Verification steps

Open `/u/lgu/signin` with no Firebase configured: it says so. Configure the three
`NEXT_PUBLIC_FIREBASE_*` values and sign in: the page shows your placeholder
handle and the sidebar foot shows it too. Sign out and the session is dead.

## Follow-ups

- PR 3 replaces the placeholder handle with the real generator and the change
  flow.
- The session cookie is host-scoped, so it does not yet carry across tenant
  subdomains. Cross-subdomain sign in wants a parent-domain cookie, which is a
  deployment decision rather than a code one.
