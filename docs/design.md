# Campus OS design language

The visual law for every screen. Tokens and components live in `packages/ui`;
this document is the source of intent. Read it before building UI.

## Principles

1. **iOS grouped, light, calm.** The reference sensibility is Apple's iOS
   Settings: white cards floating on a light-grey grouped background, generous
   whitespace, a tight SF-style type scale, and one accent colour pulled from the
   tenant's branding config. Content first, quiet, fast.
2. **Flat elevation, not neumorphism.** Grouped cards and pressable controls get
   a single subtle drop shadow (`--shadow-card`), the way an iOS grouped cell
   sits just above the page. This is a light, flat elevation. There is no
   dual-shadow "soft UI", no embossing, no pressed-in insets.
3. **Static content stays flat and high contrast.** The timetable, all badges
   (Unverified, TBA), and any text a low vision student must read are flat with
   strong contrast. Elevation is decoration around a block; it never sits under
   readable text (see "How it stays AA" below).
4. **Mobile first, full width.** Layouts are mobile-first and use the whole
   viewport inside the app shell (no narrow centred column); grids and tables
   breathe across the width, with narrow internal max-widths only where reading
   comfort needs them.
5. **Light and dark.** Both themes ship and must both be correct (see "Dark
   mode"). Light is the default; design tokens carry the theme, so components are
   written once against the tokens, never per-theme.

## Tokens

All tokens are CSS custom properties in `packages/ui/src/styles/globals.css`,
mapped to Tailwind utilities through `@theme inline`. Tailwind v4, CSS first
(there is no `tailwind.config`).

| Token                                        | Role                                          |
| -------------------------------------------- | --------------------------------------------- |
| `--background` / `--foreground`              | Grouped grey page (~#F2F2F7) and its text     |
| `--card` / `--card-foreground`               | White grouped card and its text               |
| `--surface` / `--surface-foreground`         | Alias of the white card surface for tiles     |
| `--muted-foreground`                         | Secondary text (captions, hints)              |
| `--primary` / `--primary-foreground`         | The tenant accent and its readable text       |
| `--input`                                    | iOS filled field background                   |
| `--warning` / `--warning-foreground`         | The Unverified / pending badge                |
| `--destructive` / `--destructive-foreground` | Errors and destructive actions                |
| `--shadow-card` / `--shadow-card-strong`     | Flat iOS elevation (rest / hover)             |
| `--radius`, `--radius-{sm,md,lg,xl,2xl}`     | Corner rounding scale (12px base, 16px cards) |

### The tenant accent is live

The accent is not a fixed brand colour: it is `tenant.branding.colors.primary`
from the tenant config, injected server side as `--primary` on the tenant layout
wrapper (`apps/web/lib/branding.ts` + `app/u/[slug]/layout.tsx`). This happens
during the server render, so there is no flash of the default. The readable
`--primary-foreground` (near black or white) is derived from the accent's WCAG
relative luminance. It is tenant agnostic: no hardcoded tenant, driven purely by
config. LGU's accent is `#0b5d3b`, used as the single green tint for links,
selected states, and the primary button.

### Type scale and spacing

Body text is 17px (the iOS body size) with a 1.5 line height, in the SF system
stack (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', …`). Page titles are
large and bold (`text-3xl font-bold tracking-tight`); section labels above a
grouped card are small, uppercase, and muted, the way iOS labels a settings
group. Separation between sections is spacing only (see hard rule 2): use the
whitespace scale (`gap-*`, `p-*`) and white blocks on grey, never a rule.

### Flat iOS elevation

`.ios-card`, `.ios-pressable`, and `.ios-field` are the only place elevation and
filled surfaces are defined:

- `.ios-card` is a white card with `--shadow-card` (one soft, low drop shadow).
  It is the grouped block: the picker, each weekday's classes, the empty state.
- `.ios-pressable` adds a light press affordance: a gentle `scale(0.985)` on
  `:active` and a short transition. Buttons and pressable cards use it.
- `.ios-field` is the filled input background (`--input`), the iOS text-field
  look. Inputs and selects use it, with a visible focus ring.

Static content never adds a shadow of its own.

## How it stays AA

The rule that keeps the light UI accessible: **text always sits on a solid
token, never on a shadow.** The card shadow is decorative elevation around a
block; the block's background is always a solid colour (`--card`, `--input`,
`--primary`, `--warning`, `--destructive`), and text uses that colour's paired
foreground. So a shadow can never lower the contrast of readable text.

Every pairing was computed with the WCAG relative luminance formula (OKLCH to
linear sRGB to Y, then `(L1 + 0.05) / (L2 + 0.05)`). WCAG AA is 4.5:1 for normal
text and 3:1 for large text.

| Pairing                                      | Ratio | Verdict        |
| -------------------------------------------- | ----- | -------------- |
| foreground on background (grouped grey)      | 17.53 | AAA            |
| foreground on card (white)                   | 19.41 | AAA            |
| foreground in field (`--input`)              | 16.28 | AAA            |
| muted-foreground on card (white)             | 7.77  | AAA            |
| muted-foreground on background (grey)        | 7.02  | AAA            |
| tenant accent `#0b5d3b` on card (white)      | 7.95  | AAA            |
| tenant accent `#0b5d3b` on background (grey) | 7.18  | AAA            |
| white on tenant accent (primary button)      | 7.95  | AAA            |
| warning-foreground on warning (badge)        | 11.69 | AAA            |
| white on destructive                         | 6.47  | AA (AAA large) |

Every combination clears AA; nearly all clear AAA. The lowest is white on the
destructive red at 6.47:1, still comfortably above the 4.5:1 AA floor. The green
tint is deliberately dark enough (`#0b5d3b`) to pass AA as _text_ on both white
and the grey page, so accent links are readable, not just decorative. When a
tenant sets a light accent, `--primary-foreground` flips to near black by the
same luminance rule, so accent buttons stay readable for any configured colour.

Ratios are reproducible from the palette in `globals.css`. The dark palette ships
too and clears AA on the same method (see the "Dark mode" table below).

## The cascading picker pattern

Choosing a timetable is progressive disclosure, not a wall of options. The
picker reveals one control at a time: **semester, then program, then section.**
Each choice writes to the URL query (`?term&program&section`) and the server
re-renders the next dropdown and, once a section is chosen, the timetable inline.
State lives in the URL, so a chosen timetable is shareable and survives a back
navigation; a thin client component (`app/_components/timetable-picker.tsx`)
performs a soft navigation (`router.replace`, no full reload). Selecting an
earlier step clears the later ones. Prefer this shape for any "narrow down to one
record" flow over dumping every option at once.

## Two hard rules

### 1. No dash punctuation in UI copy

No em dash, no en dash, no hyphen used as a connector. Time ranges read
"8:00 to 9:30", not "8:00-9:30". Rewrite with commas, the word "to", or
restructured sentences. The **plain hyphen is allowed**, so compounds
(`multi-tenant`, `open-source`) and identifier codes (`B-204`) survive.

Enforced by two gates:

- `apps/web/test/no-dash.test.ts` (Vitest) is the authoritative gate for the
  i18n copy catalog `messages/*.ts` (bans em dash, en dash, and the spaced
  hyphen connector) and scans `app/` and `lib/` source for em and en dashes.
- `no-restricted-syntax` in `apps/web/eslint.config.mjs` bans all three forms in
  JSX text nodes (real `JSXText`, so it never false positives on arithmetic like
  `a - b`), giving editor and pre-commit feedback.

Together they cover both `messages/*.ts` and JSX text.

### 2. No divider lines

No `<hr>`, no border line used as a separator between sections. Separation is
whitespace, spacing, and the white-card-on-grey grouping only. The grid is
grouped by weekday into separate white cards; classes within a card are separated
by spacing, never by row rules. Element outlines that are not separators (focus
rings) are unaffected.

## Components (`packages/ui`)

- **Button** interactive: flat iOS pressable, `rounded-xl`, semibold. `default`
  is the tenant accent; `outline` is a white `ios-card`; `secondary` is a grey
  fill; `ghost` and `link` are flat.
- **Badge** static: flat solid fills, high contrast, `rounded-full`. `warning`
  is the Unverified badge; `outline` is a muted grey pill.
- **Card** container: `ios-card rounded-2xl`. `flat` (default, a grouped block)
  or `pressable` (adds `.ios-pressable` and a stronger shadow on hover, for
  selectable items).
- **Input / Select** interactive: `.ios-field` filled control, `h-11`,
  `rounded-xl`, visible focus ring. **Label** and **Field** wire accessible,
  labelled controls.
- **EmptyState** static: a flat white `ios-card`, centred, used for "choose a
  section" and "no entries" states.

## Dark mode

Both themes ship. LIGHT is the `:root` default; DARK is the `.dark` class on
`<html>`, switching the token palette (near-black `--background` oklch(0.145),
dark-grey `--card` oklch(0.205), near-white text). A tiny inline script in the
app layout resolves the theme before first paint (a stored choice in
`localStorage['theme']`, else `prefers-color-scheme`) and toggles `.dark`, so
there is no flash; the header `ThemeToggle` flips and persists it. `color-scheme`
is set per theme so native form controls and scrollbars match.

The tenant accent is theme-aware. The raw accent (LGU green `#0b5d3b`) is dark
enough that it fails AA as link text on the near-black page, so `lib/branding.ts`
also emits a lightened variant (blended toward white until AA-bright), applied in
dark via `.dark [data-tenant] { --primary: var(--primary-dark) }`. For LGU the
dark accent resolves to `#aac6ba`.

Dark pairings (same OKLCH-to-Y method as the light table); WCAG AA is 4.5:1:

| Pairing (dark)                     | Ratio | Verdict |
| ---------------------------------- | ----- | ------- |
| foreground on background           | 18.96 | AAA     |
| foreground on card                 | 17.16 | AAA     |
| muted-foreground on background     | 7.98  | AAA     |
| muted-foreground on card           | 7.22  | AAA     |
| lightened accent `#aac6ba` on card | 9.81  | AAA     |
| lightened accent on background     | 10.84 | AAA     |

## Full-width app shell

Tenant pages render inside `AppShell`: a sticky, frosted, full-width header
(tenant name, nav, the theme toggle) over a full-width `<main>` capped at a wide
`max-w-[120rem]` with page padding. There is no narrow centred column and no
header divider line (the header separates by a translucent backdrop and a soft
elevation shadow, per hard rule 2). Pages use the whole width; grids and tables
breathe across the viewport, and narrow internal max-widths are added only where
reading comfort needs them (form cards, prose).
