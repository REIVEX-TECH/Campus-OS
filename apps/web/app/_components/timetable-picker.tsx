'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Field, Select } from '@campusos/ui';
import { Combobox } from './combobox';

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
 * URL query (?term&program&section); the page re-renders the next control and the
 * timetable inline via a soft navigation (no full reload). State lives in the
 * URL, so it is shareable. Semester and program are searchable comboboxes (long,
 * order-sensitive lists); section is a short native select.
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

  function go(next: { term?: string; program?: string; section?: string }): void {
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
        <Combobox
          id="pick-term"
          ariaLabel={labels.semester}
          placeholder={labels.chooseSemester}
          value={term}
          options={terms}
          onSelect={(v) => go({ term: v })}
        />
      </Field>

      {term ? (
        <Field label={labels.program} htmlFor="pick-program">
          <Combobox
            id="pick-program"
            ariaLabel={labels.program}
            placeholder={labels.chooseProgram}
            value={program}
            options={programs}
            onSelect={(v) => go({ term, program: v })}
          />
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
