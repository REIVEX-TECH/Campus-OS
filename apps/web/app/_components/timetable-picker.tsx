'use client';

import { useRouter } from 'next/navigation';
import { Field, Select } from '@campusos/ui';
import { buildTimetablePath } from '@/lib/timetable-url';
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
 * The cascading semester -> program -> section picker. Each choice pushes the URL
 * path (/timetable/t/{term}/p/{program}/s/{section}); only the schedule child route
 * re-renders (a soft navigation, no full reload), while this picker and the sidebar
 * stay mounted in the layout. State lives in the URL, so it is shareable. All three
 * steps are always visible: program is disabled until a semester is chosen and section
 * until a program is chosen (progressive enabling, not progressive reveal), each with a
 * hint saying what to pick first. Semester and program are searchable comboboxes (long,
 * order-sensitive lists); section is a short native select.
 */
export function TimetablePicker({
  basePath,
  terms,
  programs,
  sections,
  term,
  program,
  section,
  labels,
}: {
  /** The tenant's `/timetable` path; the path form is built under it. */
  basePath: string;
  terms: PickerOption[];
  programs: PickerOption[];
  sections: PickerOption[];
  term?: string;
  program?: string;
  section?: string;
  labels: PickerLabels;
}) {
  const router = useRouter();

  function go(next: { term?: string; program?: string; section?: string }): void {
    // scroll:false keeps the reader where they are; only the schedule pane changes.
    router.push(buildTimetablePath(basePath, next), { scroll: false });
  }

  // Field ids are shared between the control and its hint (Field derives the hint
  // id as `${htmlFor}-hint`), so the describedBy is built from the same constant
  // rather than a separate literal that could drift.
  const TERM = 'pick-term';
  const PROGRAM = 'pick-program';
  const SECTION = 'pick-section';

  return (
    <div className="flex flex-col gap-4">
      <Field label={labels.semester} htmlFor={TERM}>
        <Combobox
          id={TERM}
          ariaLabel={labels.semester}
          placeholder={labels.chooseSemester}
          value={term}
          options={terms}
          onSelect={(v) => go({ term: v })}
        />
      </Field>

      <Field
        label={labels.program}
        htmlFor={PROGRAM}
        hint={term ? undefined : labels.programLocked}
      >
        <Combobox
          id={PROGRAM}
          ariaLabel={labels.program}
          placeholder={labels.chooseProgram}
          value={program}
          options={programs}
          onSelect={(v) => go({ term, program: v })}
          disabled={!term}
          describedBy={term ? undefined : `${PROGRAM}-hint`}
        />
      </Field>

      <Field
        label={labels.section}
        htmlFor={SECTION}
        hint={program ? undefined : labels.sectionLocked}
      >
        <Select
          id={SECTION}
          aria-describedby={program ? undefined : `${SECTION}-hint`}
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
