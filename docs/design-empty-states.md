# Empty states: design pass

An empty module reads as broken before it reads as new. A board with a single grey line
("No upcoming rides yet.") looks like a page that failed to load, not like an invitation
to be the first to post. Every module has a cold start, and the cold start is exactly the
moment we most need the visitor to act. This is the design for turning that moment into an
invitation, and the choice of the first module to build it for.

## The shape

One shape, two variants, chosen by _why_ the list is empty:

**Genuine-empty (nothing exists yet)** — the first-run invitation:

- an icon, so the state reads as deliberate rather than as a card that failed to fill;
- a heading that names the state plainly ("No rides posted yet");
- one line of value, the reason the first action is worth taking ("Offer a seat or ask
  for one. The board fills as people post.");
- exactly one primary call to action — the single first action for this module (post a
  ride). No secondary buttons competing with it.

**Filtered-empty (things exist, the filter hid them)** — a quieter correction:

- the same card, a "nothing matches" heading, and a single _clear filters_ link back to
  the unfiltered board. **No create-CTA here**: someone who over-filtered a full board
  does not need to be told to post; they need their filter removed.

Distinguishing the two matters. Showing "be the first to post!" on a board that has fifty
rides the visitor merely filtered out is worse than showing nothing. The rule: a
create-invitation appears only when the module is genuinely empty (no active filter or
search), never as the response to a filter that matched nothing.

Non-goals: no per-user personalization, no dynamically generated copy, no A/B copy. The
copy is fixed per module and goes through i18n like everything else.

## Which module first

**Rides.** Three reasons:

1. It is the newest module and the most likely to be empty in a real tenant: rides need
   supply before they are useful, and a cold ride board is a genuine dead end (a rider
   who sees nothing has no reason to return).
2. It has one unambiguous first action — post a ride — so the invitation is a single
   button, not a menu.
3. Its empty state today is the barest in the app (a lone title), so the improvement is
   the most visible and the pattern is easiest to hold up as the template.

Marketplace, lost-and-found and the communities feed share the same cold-start problem and
the same shape; they adopt this pattern next, one at a time, once rides proves it. This PR
builds rides only.

## The metric

The empty state works if it converts a cold-board visit into the first action, so:

**Primary — empty-board CTA conversion.** Of visits that land on the _unfiltered_ rides
board while it is empty, the share that click the "post a ride" CTA and then create a
ride. This is measured with the same click-through instrumentation being stood up for
notifications (block D): the CTA is a tracked link, ride-create is the existing event.
There is no baseline yet, so this PR ships the shape and the instrumentation reads it; the
target is set once a week of data exists (mirrors D's "instrument first, decide later").

**Guardrail — filtered-empty should not bounce.** For the filtered-empty variant, the
share that click _clear filters_ rather than leaving. If most people bounce from a
filtered-empty board, the filters are too aggressive, which is a different fix than copy.

Both are computed from click-through counts already flowing once D lands; neither needs a
new store, and neither records anything per-user beyond the anonymous click event D
already defines.
