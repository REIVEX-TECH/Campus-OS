# SEO (Search Console, sitemap, structured data)

How search engines discover and render Campus OS, and how to verify the LGU
property in Google Search Console. The target query for the first tenant is
**"LGU timetable"** (and "Lahore Garrison University timetable").

Everything here is already wired in code. The only human steps are (1) verifying
the property in Search Console and (2) optionally setting a verification token.
No token or secret lives in the repo.

## What ships in the app

- **Per-page metadata** (`apps/web/lib/metadata.ts`): title (composed with the
  tenant template, e.g. `Timetable · LGU Timetable`), description, keywords,
  canonical URL, OpenGraph, and a Twitter `summary_large_image` card. `title`
  and `description` come from the tenant config (`tenants/lgu/tenant.config.ts`),
  tuned for the "LGU timetable" query.
- **robots.txt** (`apps/web/app/robots.ts`): allows all, and points at the
  sitemap for the platform host and each resolved tenant host.
- **sitemap.xml** (`apps/web/app/sitemap.ts`): host-reflective, so it lists the
  right absolute URLs whether served on `campusos.reivex.io` (platform: the
  landing plus each university) or `lgu.campusos.reivex.io` (tenant). The tenant
  sitemap enumerates every public URL: home, `/timetable`, `/free-rooms`,
  `/search`, every section, every course, every teacher, every room that appears
  on a current entry, and the "coming soon" module stubs.
- **Structured data (JSON-LD)**:
  - Tenant home renders a `CollegeOrUniversity` node (name, URL, `sameAs` the
    university's own domain).
  - Each course page renders a `Course` node with its `provider` (the
    university) and one `CourseInstance` per weekly session, each carrying a
    schema.org `Schedule` (`byDay` + wall-clock `startTime`/`endTime`, weekly
    repeat) and the room/teacher. This matches how the app stores recurring
    slots, so no fake calendar dates are invented.

Validate the structured data after deploy with Google's
[Rich Results Test](https://search.google.com/test/rich-results) on a live
course URL and the tenant home.

## Verifying the LGU property in Google Search Console

Use **one** of these. DNS verification is preferred (it covers every subdomain
and needs no app change).

### Option A — DNS record (recommended)

1. In [Search Console](https://search.google.com/search-console), add a
   **Domain** property for `campusos.reivex.io`.
2. Copy the `TXT` record Google shows.
3. Add that `TXT` record at your DNS provider for `campusos.reivex.io`.
4. Back in Search Console, click **Verify**. This one property covers
   `campusos.reivex.io` and every tenant subdomain, including
   `lgu.campusos.reivex.io`.

### Option B — HTML meta tag (per host)

1. In Search Console, add a **URL prefix** property for
   `https://lgu.campusos.reivex.io`.
2. Choose the **HTML tag** method and copy the token (the `content` value of the
   `google-site-verification` meta tag).
3. Set it as an env var on the deployment (do **not** commit it):

   ```
   GOOGLE_SITE_VERIFICATION=<the-token-from-search-console>
   ```

   The app then renders `<meta name="google-site-verification" content="…">` on
   every page (see `apps/web/app/layout.tsx`). Leaving the var empty omits the
   tag. There is intentionally **no real token in the repo**;
   `.env.example` documents the slot only.

4. Redeploy so the tag is live, then click **Verify**.

## After verifying

1. In Search Console, open **Sitemaps** and submit `sitemap.xml` (the app serves
   it at `https://lgu.campusos.reivex.io/sitemap.xml` and
   `https://campusos.reivex.io/sitemap.xml`).
2. Use **URL Inspection** on `https://lgu.campusos.reivex.io/timetable` and
   request indexing.
3. Check **Enhancements / Course** for the structured-data results once Google
   has recrawled.

## OpenGraph images

Each tenant and the platform landing generate a 1200x630 social card at build/
request time via first-party `next/og` (`app/u/[slug]/opengraph-image.tsx` and
`app/opengraph-image.tsx`). Next wires `og:image` and `twitter:image` from these
files automatically, so a shared link renders a branded card (the tenant card
uses the tenant accent). No external asset or font file is bundled.

## Follow-ups

- **Human-readable URLs.** Section/course/teacher/room pages use raw ids for now;
  slug paths (`/timetable/bscs/5/a`) will improve relevance once dimension data
  is verified (already noted in `lib/metadata.ts`).
