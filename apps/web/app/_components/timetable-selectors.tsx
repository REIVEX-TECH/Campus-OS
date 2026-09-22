'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@campusos/ui';
import type { RecentEntry } from '@/lib/recents-local';
import { parseTimetableFilters } from '@/lib/timetable-url';
import { RecentTimetables, type RecentLabels } from './recent-timetables';
import { TimetablePicker, type PickerLabels } from './timetable-picker';

/** The ordered filter segments after `/timetable` in the current path, e.g. ['t','X']. */
function filterSegments(pathname: string): string[] {
  const marker = '/timetable';
  const i = pathname.lastIndexOf(marker);
  if (i < 0) return [];
  return pathname
    .slice(i + marker.length)
    .split('/')
    .filter(Boolean);
}

/** A program or section entry with its parent ids, so the cascade filters client-side. */
type ProgramEntry = { id: string; label: string; termId: string };
type SectionEntry = { id: string; label: string; termId: string; programId: string };

/**
 * The stable left column of the timetable surface: the cascade picker and the
 * "Recently viewed" sidebar. It lives in the layout, so selecting a term/program/section
 * (which changes only the schedule child route) never unmounts it. It reads the active
 * selection from the route (the path after `/timetable`) and filters the preloaded
 * cascade client-side, so switching is instant and does not refetch the lists.
 */
export function TimetableSelectors({
  basePath,
  tenant,
  signedIn,
  terms,
  programs,
  sections,
  recents,
  labels,
  recentLabels,
}: {
  basePath: string;
  tenant: string;
  signedIn: boolean;
  terms: { id: string; label: string }[];
  programs: ProgramEntry[];
  sections: SectionEntry[];
  recents: RecentEntry[];
  labels: PickerLabels;
  recentLabels: RecentLabels;
}) {
  const pathname = usePathname();
  const sel = parseTimetableFilters(filterSegments(pathname)) ?? {};

  // Default to the first term so the program step is ready with no clicks, exactly as
  // the server default did; validate the rest against the preloaded cascade.
  const term = terms.find((x) => x.id === sel.term)?.id ?? terms[0]?.id;
  const program = programs.find((p) => p.id === sel.program && p.termId === term)?.id;
  const section = sections.find(
    (s) => s.id === sel.section && s.programId === program && s.termId === term,
  )?.id;

  const programsForTerm = programs
    .filter((p) => p.termId === term)
    .map((p) => ({ id: p.id, label: p.label }));
  const sectionsForProgram = program
    ? sections
        .filter((s) => s.termId === term && s.programId === program)
        .map((s) => ({ id: s.id, label: s.label }))
    : [];

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        <TimetablePicker
          basePath={basePath}
          terms={terms}
          programs={programsForTerm}
          sections={sectionsForProgram}
          term={term}
          program={program}
          section={section}
          labels={labels}
        />
      </Card>
      <RecentTimetables
        tenant={tenant}
        signedIn={signedIn}
        initial={recents}
        labels={recentLabels}
      />
    </div>
  );
}
