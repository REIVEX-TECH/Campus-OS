'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Field, Select } from '@campusos/ui';

export type PickerOption = { id: string; label: string };

export type PickerLabels = {
  semester: string;
  program: string;
  section: string;
  chooseSemester: string;
  chooseProgram: string;
  chooseSection: string;
};

/**
 * The cascading semester -> program -> section picker. Each choice updates the
 * URL query (?term&program&section); the page re-renders the next dropdown and
 * the timetable inline via a soft navigation (no full reload). State lives in the
 * URL, so it is shareable and works when navigated back to. Selecting an earlier
 * step clears the later ones.
 */
export function TimetablePicker({
  terms,
  programs,
  sections,
  term,
  program,
  section,
  labels,
}: {
  terms: PickerOption[];
  programs: PickerOption[];
  sections: PickerOption[];
  term?: string;
  program?: string;
  section?: string;
  labels: PickerLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { term?: string; program?: string; section?: string }) {
    const params = new URLSearchParams();
    if (next.term) params.set('term', next.term);
    if (next.program) params.set('program', next.program);
    if (next.section) params.set('section', next.section);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label={labels.semester} htmlFor="pick-term">
        <Select id="pick-term" value={term ?? ''} onChange={(e) => go({ term: e.target.value })}>
          <option value="" disabled>
            {labels.chooseSemester}
          </option>
          {terms.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {term ? (
        <Field label={labels.program} htmlFor="pick-program">
          <Select
            id="pick-program"
            value={program ?? ''}
            onChange={(e) => go({ term, program: e.target.value })}
          >
            <option value="" disabled>
              {labels.chooseProgram}
            </option>
            {programs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {term && program ? (
        <Field label={labels.section} htmlFor="pick-section">
          <Select
            id="pick-section"
            value={section ?? ''}
            onChange={(e) => go({ term, program, section: e.target.value })}
          >
            <option value="" disabled>
              {labels.chooseSection}
            </option>
            {sections.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </div>
  );
}
