import { en } from '../messages/en';

export type Messages = typeof en;
export type MessageKey = keyof Messages;
export type TParams = Record<string, string | number>;

// Minimal i18n: a typed catalog per language + a t() bound to the tenant locale.
// English is the source and the fallback. Add locales (e.g. ur-PK) as catalogs.
const catalogs: Record<string, Partial<Messages>> = { en };

export function t(locale: string, key: MessageKey, params?: TParams): string {
  const lang = locale.split('-')[0] ?? 'en';
  const catalog = catalogs[lang] ?? en;
  let message: string = catalog[key] ?? en[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      message = message.split(`{${name}}`).join(String(value));
    }
  }
  return message;
}

export type Translate = (key: MessageKey, params?: TParams) => string;

/** A translator bound to a locale, passed down through server components. */
export function translator(locale: string): Translate {
  return (key, params) => t(locale, key, params);
}

export function dayName(locale: string, isoDay: number): string {
  return t(locale, `timetable.day.${isoDay}` as MessageKey);
}

export function dayShort(locale: string, isoDay: number): string {
  return t(locale, `timetable.dayShort.${isoDay}` as MessageKey);
}

export function kindName(locale: string, kind: string): string {
  return t(locale, `timetable.kind.${kind}` as MessageKey);
}
