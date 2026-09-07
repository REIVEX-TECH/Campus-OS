# fix(lost-found): "Post an item", not "Report an item"

**Bug (production browser pass):** the L&F create-a-listing flow is labelled
"Report an item". "Report" is reserved across the app for flagging content to
moderators, so the same word meant two different things in Lost & Found.

**Fix:** use "Post" for creating a listing everywhere, and keep "Report" only for
the flag-to-moderator action.

Copy changed to the post sense:

- `lostFound.post` (was `lostFound.report`): **Post an item** (the browse-page CTA).
- `lostFound.postHeading`: **Post an item (lost or found)** (the post-page heading).
- `lostFound.postWall`: "Verify your account to **post** a lost or found item."
- `lostFound.intro`: "... **Post** it here so it can find its way back."
- `lostFound.empty`: "Nothing **posted** yet."
- `lostFound.myEmpty`: "You have not **posted** anything yet."
- `lostFound.postedBy` (was `lostFound.reportedBy`): **Posted by {handle}**.
- `module.lostFound.desc`: "**Post** and recover lost items around campus."

Kept as-is (genuine flag-to-moderator sense): `lostFound.report.*` (the report
dialog), and the moderation queue's `lostFound.mod.*` including "Reported item",
"Reported claim", "Reported by {handle}" (who flagged it) and "Open reports ...".

Two i18n keys were renamed so the key name no longer says "report" for a post
action (`lostFound.report` → `lostFound.post`, `lostFound.reportedBy` →
`lostFound.postedBy`); their two usages (`lost-found/page.tsx`,
`lost-found/[itemId]/page.tsx`) are updated.

## Data & migration impact

No schema change. Copy only.

## Tests

`apps/web` suite green (typecheck + the no-dash copy guard + 120 tests). No stale
references to the old keys remain in source.

```bash
pnpm -C apps/web typecheck && pnpm -C apps/web test
```

## Verification

Grep confirms every post-sense "report"/"reported" in L&F copy is now "post"/
"posted", and every remaining "report" is the flag-to-moderator action. (Local
browser-view of the tenant pages is blocked by the same pre-existing local
tenant-resolution 404 noted on the styling PR; verified by grep + build.)
