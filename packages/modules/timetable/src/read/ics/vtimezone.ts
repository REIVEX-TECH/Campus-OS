export interface TzInfo {
  /** Fixed UTC offset like "+0500". */
  offset: string;
  /** Short tz name for TZNAME. */
  name: string;
}

// Explicit, non-DST support set. A DST or unknown zone must throw at generation
// time rather than emit a silently wrong VTIMEZONE (Luxon-based DST support is a
// follow-up). Add zones here only when they have a single, fixed offset.
const SUPPORTED: Record<string, TzInfo> = {
  UTC: { offset: '+0000', name: 'UTC' },
  'Asia/Karachi': { offset: '+0500', name: 'PKT' },
  'Asia/Kolkata': { offset: '+0530', name: 'IST' },
  'Asia/Dhaka': { offset: '+0600', name: 'BST' },
  'Asia/Dubai': { offset: '+0400', name: 'GST' },
  'Asia/Riyadh': { offset: '+0300', name: 'AST' },
};

export function tzInfo(tzid: string): TzInfo {
  const info = SUPPORTED[tzid];
  if (!info) {
    throw new Error(
      `Unsupported timezone for ICS generation: "${tzid}". Only fixed-offset (non-DST) ` +
        `zones are supported (${Object.keys(SUPPORTED).join(', ')}). DST zones need the ` +
        `Luxon-based generator (follow-up).`,
    );
  }
  return info;
}

export function offsetToMinutes(offset: string): number {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(offset);
  if (!match) throw new Error(`invalid offset: ${offset}`);
  const [, sign, hh, mm] = match;
  const minutes = Number(hh) * 60 + Number(mm);
  return sign === '-' ? -minutes : minutes;
}

export function vtimezoneBlock(tzid: string): string[] {
  const info = tzInfo(tzid);
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${info.offset}`,
    `TZOFFSETTO:${info.offset}`,
    `TZNAME:${info.name}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
}
