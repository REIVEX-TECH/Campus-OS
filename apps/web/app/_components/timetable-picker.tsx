'use client';

import type { TransitionStartFunction } from 'react';
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
  programLocked: string;
  sectionLocked: string;
};

/**
 * The cascading semester -> program -> section picker. Each choice updates the
 * URL query (?term&program&section); the page re-renders the next control and the
 * timetable inline via a soft navigation (no full reload). State lives in the
 * URL, so it is shareable. All three steps are always visible: program is
 * disabled until a semester is chosen and section until a program is chosen
 * (progressive enabling, not progressive reveal), each with a hint saying what to
 * pick first. Semester and program are searchable comboboxes (long,
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
  startTransition,
}: {
  terms: PickerOption[];
  programs: PickerOption[];
  sections: PickerOption[];
  term?: string;
  program?: string;
  section?: string;
  labels: PickerLabels;
  /** When provided, navigation runs inside this transition so the caller can
   * show a pending (skeleton) state until the new results arrive. */
  startTransition?: TransitionStartFunction;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { term?: string; program?: string; section?: string }): void {
    const params = new URLSearchParams();
    if (next.term) params.set('term', next.term);
    if (next.program) params.set('program', next.program);
    if (next.section) params.set('section', next.section);
    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    const run = (): void => router.replace(href, { scroll: false });
    if (startTransition) startTransition(run);
    else run();
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

      <Field
        label={labels.program}
        htmlFor="pick-program"
        hint={term ? undefined : labels.programLocked}
      >
        <Combobox
          id="pick-program"
          ariaLabel={labels.program}
          placeholder={labels.chooseProgram}
          value={program}
          options={programs}
          onSelect={(v) => go({ term, program: v })}
          disabled={!term}
          describedBy={term ? undefined : 'pick-program-hint'}
        />
      </Field>

      <Field
        label={labels.section}
        htmlFor="pick-section"
        hint={program ? undefined : labels.sectionLocked}
      >
        <Select
          id="pick-section"
          aria-describedby={program ? undefined : 'pick-section-hint'}
          value={section ?? ''}
          disabled={!program}
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
    </div>
  );
}
