import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from './config';
import { createLiveHttpClient, fixtureFileFor } from './http';
import { metadataSchema } from './schemas';
import { establishSession } from './session';

// One-time dev tool: records live responses into tests/fixtures so dev and CI
// can run entirely offline. Hits the live source — run it locally, never in CI.
async function main(): Promise<void> {
  const config = { ...loadConfig(), mode: 'live' as const };
  const log = (message: string): void => console.log(`[record] ${message}`);
  const http = createLiveHttpClient({ 'user-agent': config.userAgent });

  const session = await establishSession(http, config, log);
  const headers = {
    'user-agent': config.userAgent,
    ...(session.cookie ? { cookie: `PHPSESSID=${session.cookie}` } : {}),
  };

  await mkdir(config.fixturesDir, { recursive: true });

  const metaUrl = `${config.baseUrl}/api/metadata`;
  const metaText = await (await http.get(metaUrl, { headers })).text();
  await writeFile(fixtureFileFor(config.fixturesDir, metaUrl), metaText, 'utf8');
  const meta = metadataSchema.parse(JSON.parse(metaText));

  for (const combo of meta.combos) {
    const url = `${config.baseUrl}/api/timetable?semester=${encodeURIComponent(
      combo.semester,
    )}&program=${encodeURIComponent(combo.program)}&section=${encodeURIComponent(combo.section)}`;
    const text = await (await http.get(url, { headers })).text();
    await writeFile(fixtureFileFor(config.fixturesDir, url), text, 'utf8');
    log(`wrote ${combo.semester} / ${combo.program} / ${combo.section}`);
  }

  log(`recorded metadata + ${meta.combos.length} timetables to ${config.fixturesDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
