# feat(seo): CampusOS organization entity and brand metadata

Timetable SEO work, Task 2 (brand disassociation), the in-repo part. Give search engines
an explicit CampusOS entity for `*.campusos.reivex.io` so it reads as CampusOS, not as part
of the Reivex brand. Metadata only; no content or activity change. See
`docs/design-timetable-urls.md`.

## What

- `apps/web/lib/json-ld.ts` — add `organizationLd` (a CampusOS `Organization`: name, url,
  logo), and point the platform `WebSite`'s `publisher` at it by `@id`. `sameAs` is left
  out until real CampusOS social profiles exist (a borrowed/Reivex profile would re-link
  the entities, the opposite of the goal).
- `apps/web/app/page.tsx` — render the `Organization` JSON-LD on the platform landing, and
  set `authors` / `creator` / `publisher` metadata to "CampusOS" (`og:site_name` was
  already "CampusOS").
- `docs/SEO.md` — a "Brand: keeping CampusOS distinct from Reivex" section: what ships, and
  the human steps (remove Reivex-property links to CampusOS hosts; the Search Console
  _Domain_ property, already documented under Option A; add real `sameAs` later), plus the
  root-domain question noted as a decision for Ahad. The structured-data and URL notes are
  updated to match.

## Premise note (surfaced honestly)

The task framed this as changing an Organization/Publisher schema "from Reivex". There was
no such schema: nothing in the app named Reivex in structured data or metadata, and
`og:site_name` was already the tenant/CampusOS name. So the concrete in-repo lever is to
_add_ a CampusOS Organization entity and set the author/publisher explicitly, which this
does. The only in-repo "Reivex" strings are the open-source GitHub links and the
marketplace policy operator (legal content), both intentionally left.

## Out of repo (documented, for Ahad)

- Removing Reivex-property links to `*.campusos.reivex.io` lives on `reivex.io` /
  `reivex.com` / other Reivex properties, not in this repository.
- Adding + verifying the Search Console Domain property for `campusos.reivex.io` is a
  Google-side step (the app already supports the meta-tag verification path).
- Moving CampusOS to its own root domain (`campusos.io`) is a branding/infra decision,
  noted only.

## Data & migration impact

No schema change. Metadata/JSON-LD only.

## Tests / verification

`turbo run typecheck lint` and the web vitest suite (140) pass; `prettier --check` passes.
Validate the added Organization node with Google's Rich Results Test on the platform
landing after deploy.
