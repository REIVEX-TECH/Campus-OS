import type { AdapterConfig } from './config';
import type { HttpClient } from './http';
import { mapWithConcurrency } from './queue';
import { metadataSchema, timetableSchema, type Combo, type RawSlot } from './schemas';

export interface RawTimetableRecord {
  combo: Combo;
  slots: RawSlot[];
}

export interface RawRecords {
  combos: Combo[];
  timetables: RawTimetableRecord[];
}

function headersFor(config: AdapterConfig, cookie: string | null): Record<string, string> {
  return {
    'user-agent': config.userAgent,
    ...(cookie ? { cookie: `PHPSESSID=${cookie}` } : {}),
  };
}

function timetableUrl(baseUrl: string, combo: Combo): string {
  const q = new URLSearchParams({
    semester: combo.semester,
    program: combo.program,
    section: combo.section,
  });
  return `${baseUrl}/api/timetable?${q.toString()}`;
}

/** Fetch dropdown metadata, then each combo's timetable with bounded concurrency. */
export async function fetchAll(
  http: HttpClient,
  config: AdapterConfig,
  cookie: string | null,
): Promise<RawRecords> {
  const headers = headersFor(config, cookie);
  const metaRes = await http.get(`${config.baseUrl}/api/metadata`, { headers });
  const meta = metadataSchema.parse(await metaRes.json());

  const timetables = await mapWithConcurrency(meta.combos, config.concurrency, async (combo) => {
    const res = await http.get(timetableUrl(config.baseUrl, combo), { headers });
    const parsed = timetableSchema.parse(await res.json());
    return { combo, slots: parsed.slots };
  });

  return { combos: meta.combos, timetables };
}
