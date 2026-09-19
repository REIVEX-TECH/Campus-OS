# docs(overnight): run 6 morning report + decisions

The Run 6 morning report and the non-obvious decisions from the run. Docs only.

## What

- `docs/overnight/REPORT.md` — replaced with the Run 6 report: contextual cards (A) and
  the official account (C) built as one coordinated set, the rides empty state (B,
  design-first), and notification click-through instrumentation (D, decision held). The
  shipped PRs (#237, #238, #239, #240, #241), how to stand each up (not run against prod),
  the security notes, and follow-ups.
- `docs/overnight/DECISIONS.md` — appended the Run 6 section: the §8 reasoning for
  `is_official`, why it is read unforgeably and not threaded through `Actor`, the scope of
  the official posting waiver, the cards catalog/store split and the read-time 24h window,
  the two-variant empty state, and why D is instrument-only.

## Data & migration impact

No schema change. Docs only.

## Tests / verification

`prettier --check` passes for both files. The five feature PRs they describe each merged
CI-green.
