/**
 * Renders a JSON-LD script tag. `<` is escaped so a scraped string containing
 * "</script>" cannot break out of the tag (the data comes from imported course
 * and teacher names, not a trusted source).
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
