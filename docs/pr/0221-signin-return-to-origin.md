# fix(web): sign in returns you to where you were

Signing in from the sign-in page dropped the visitor on their account page (on a subdomain
deployment, effectively away from what they were reading), so a timetable reader who signed
in had to navigate back. This carries the origin through the flow and lands them where they
started. It also makes the "sign in to reply" prompt a real link that returns to the post,
with a reason instead of a generic ask.

## What

- The sign-in page honors a validated `next`: after signing in (and for an already
  signed-in visitor) it goes back to `next` when that is a safe same-tenant path, otherwise
  to the account page as before.
- The persistent top-bar sign-in control carries the current path as `next`, so the
  no-script / middle-click fallback (and the plain link shown when no provider is
  configured) returns the visitor to the page they were on. The direct in-place sign-in
  already stayed put.
- A gate can say _why_ it is asking: `?reason=reply|comment|message|post|save|vote` renders
  a one-line prompt above the card. The community post page uses it: the "sign in to reply"
  prompt is now a link (reason `reply`, `next` back to the post), and the read gate on a
  members-only community returns the visitor to the post after signing in.

`next` is attacker-influenced (it rides in the URL), so it is validated before any redirect:
root-relative only, inside the current tenant's base, never protocol-relative / absolute /
`\`-escaped, and never the sign-in page itself (no loop).

## Changes

- `apps/web/lib/sign-in-url.ts` (new, pure, unit-tested) — `signInPath(base, {next, reason})`,
  `safeReturnPath(next, base)`, and the `SignInReason` set.
- `apps/web/app/u/[slug]/signin/page.tsx` — read `next` + `reason`; redirect to the safe
  return path or the account page; render the reason line when present.
- `apps/web/app/_components/account-menu.tsx` — append `next=<pathname>` to the top-bar
  sign-in link (client `usePathname`), skipping it on the sign-in page itself.
- `apps/web/app/u/[slug]/c/[community]/post/[postId]/[[...title]]/page.tsx` — the read gate
  and the reply prompt link through `signInPath` with `next` (and `reason=reply` for the
  reply prompt).
- `apps/web/app/_components/communities/comment-thread.tsx` — render the composer hint as a
  link when a `hintHref` is given.
- `apps/web/messages/en.ts` — `signin.reason.*` copy; `comments.signInToComment` is now
  "Sign in to reply." (specific, not "join the conversation").

## Data & migration impact

No schema change.

## Tests

- `apps/web/test/sign-in-url.test.ts` (new, 9 cases) — `signInPath` encoding, `safeReturnPath`
  validation (keeps same-tenant paths; rejects empty, absolute, protocol-relative, `\`,
  `javascript:`, another tenant, and the sign-in loop), and `isSignInReason`.
- `apps/web/e2e/signin.spec.ts` — the two top-bar assertions now expect the `next`-carrying
  href and the resulting `/signin?next=...` URL.

Run: `pnpm --filter web test` (unit) and `pnpm --filter web typecheck lint`.

## Verification steps

- `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test`
- **Verified live** against the dev app (no provider configured, so the fallback link path
  is exercised): on `/u/lgu/timetable` the top-bar sign-in link is
  `/u/lgu/signin?next=%2Fu%2Flgu%2Ftimetable`; `/u/lgu/signin?reason=reply` renders "Sign in
  to reply." above the intro; on a members-only community post the read-gate "Sign in" link
  carries `next` back to that post. The post-sign-in redirect itself keys on the same
  validated `next` and could not complete a real Google popup locally (no provider in dev).

## Follow-ups

- The protected-page redirects to `/signin` (`/c/new`, `/notifications`, `/hidden`,
  `/blocked`, the account page) still land on the bare sign-in page. Threading `next`
  through those server redirects with `signInPath` is a natural follow-up; it was kept out
  here to keep the diff focused on the reported timetable case and avoid churning their e2e
  assertions.
- Other action gates (marketplace contact, lost-and-found, messages) can adopt
  `signInPath(base, {next, reason})` the same way the community reply prompt now does.
