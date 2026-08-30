import type { Freshness } from '@campusos/module-timetable/read';
import { relativeTime } from '../../lib/format';
import type { Translate } from '../../lib/i18n';

export function FreshnessLine({
  freshness,
  locale,
  t,
}: {
  freshness: Freshness;
  locale: string;
  t: Translate;
}) {
  const text = freshness.lastSuccessfulAt
    ? t('timetable.lastUpdated', { when: relativeTime(freshness.lastSuccessfulAt, locale) })
    : t('timetable.neverUpdated');
  return <p className="text-xs text-muted-foreground">{text}</p>;
}
