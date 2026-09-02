'use client';

import { useTransition, type ReactNode } from 'react';
import { Card } from '@campusos/ui';
import { TimetablePicker, type PickerLabels, type PickerOption } from './timetable-picker';

/**
 * Form-left / results-right layout that shows a skeleton while the next section
 * loads. The picker runs its URL navigation inside a transition owned here, so
 * `isPending` is true from the moment a choice is made until the new server
 * content arrives, and the results column shows the skeleton for that whole
 * window. This is reliable where a server Suspense boundary is not: a soft
 * navigation holds the previous render during the transition, so an inner
 * fallback would not appear on a param change.
 */
export function TimetableWorkspace({
  terms,
  programs,
  sections,
  term,
  program,
  section,
  labels,
  results,
  skeleton,
}: {
  terms: PickerOption[];
  programs: PickerOption[];
  sections: PickerOption[];
  term?: string;
  program?: string;
  section?: string;
  labels: PickerLabels;
  results: ReactNode;
  skeleton: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
      <Card className="p-4">
        <TimetablePicker
          terms={terms}
          programs={programs}
          sections={sections}
          term={term}
          program={program}
          section={section}
          labels={labels}
          startTransition={startTransition}
        />
      </Card>
      <div className="min-w-0" aria-busy={isPending}>
        {isPending ? skeleton : results}
      </div>
    </div>
  );
}
