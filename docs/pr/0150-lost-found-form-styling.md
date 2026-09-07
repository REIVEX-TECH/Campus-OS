# fix(lost-found): style forms to the app field vocabulary

**Bug (production browser pass):** the Lost & Found forms render as raw inputs,
native select and date picker, with no radius or focus ring, unlike the rest of
the app.

**Root cause:** the L&F inputs carried only `className="ios-field"`. `ios-field`
is a plain-CSS component class (`packages/ui/src/styles/globals.css`) that sets
only the filled background and text colour, so the fields had a fill but no
radius, padding, height or focus ring. Those come from Tailwind utilities the
community post form applies alongside `ios-field` and the L&F forms did not. It
is **not** a Tailwind content-glob problem: those utilities are generated (the
community forms use them) and `ios-field`/`ios-card` are compiled from the
imported UI stylesheet regardless of scanning; the L&F markup simply lacked the
classes.

**Fix:** give every L&F field the same class string the community post form uses
(`ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none
focus-visible:ring-2 focus-visible:ring-ring`, textareas `min-h-* py-2.5`):

- `post-item-form.tsx` — title, description, category, location, building, date
  fields; the lost/found toggle gains `ios-pressable`.
- `claim-area.tsx` — the claim message textarea and the thread reply input.
- `report-button.tsx` — the report dialog's note field and radio accent.
- `mod-queue.tsx` — the removal reason was a native `window.prompt`; it becomes
  an inline `ios-field` reason form (Remove / Cancel), and the queue's buttons
  gain `ios-pressable`. New labels `removeConfirm` + `cancel` (reusing
  `comments.cancel`).

## Data & migration impact

No schema change. UI only.

## Tests

`apps/web` unit suite green (typecheck + no-dash + i18n-plural + 120 tests). No
new unit test: these are class-string and one small stateful-form change, both
covered by typecheck and the existing render tests.

```bash
pnpm -C apps/web typecheck && pnpm -C apps/web test
```

## Verification

The field classes are a **verbatim copy** of the community post form's field
vocabulary, which renders correctly in production. Local browser-view of the
tenant pages was blocked by a pre-existing local tenant-resolution 404 (the
tenant pages 404 at `requireTenant` in local dev though metadata resolves; the
app is confirmed working in production), so rendering is verified by class-parity
and the CI build, not a local screenshot.

## Follow-ups

- The local dev tenant-resolution 404 (metadata resolves, RSC body 404s) is worth
  a look so future UI can be browser-verified locally; not in scope here.
