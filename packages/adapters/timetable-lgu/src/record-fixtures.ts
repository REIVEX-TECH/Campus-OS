import 'dotenv/config';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config';
import { PORTAL_PATHS, fixtureName, parseOptions } from './portal';

// One-time dev tool: records real responses from the LGU portal into
// tests/fixtures so dev and CI run offline. It hits the LIVE portal — run it
// locally, never in CI. The portal requires an authenticated session, so it
// reads LGU_PHPSESSID from .env (never from chat or git). See the adapter README
// for how to obtain/refresh the session, and docs/recording-fixtures.md.

const DELAY_MS = 1500; // polite gap between requests
const MAX_SECTIONS = 3; // a small, representative sample

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function post(
  baseUrl: string,
  path: string,
  session: string,
  userAgent: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      Cookie: `PHPSESSID=${session}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`POST /${path} → HTTP ${res.status}`);
  return res.text();
}

/** Redact session values. PII in page chrome (e.g. the logged-in user's name)
 * must be reviewed by a human before commit — see docs/recording-fixtures.md. */
function scrub(html: string): string {
  return html.replace(/PHPSESSID=[^;"'\s]+/gi, 'PHPSESSID=REDACTED');
}

async function main(): Promise<void> {
  const config = loadConfig();
  const session = config.phpSessId;
  if (!session) {
    console.error(
      'LGU_PHPSESSID is required in .env. The portal only serves timetable data to an ' +
        'authenticated session; see the adapter README for how to copy a fresh PHPSESSID.',
    );
    process.exit(1);
  }

  const log = (message: string): void => console.log(`[record] ${message}`);
  const dir = config.fixturesDir;
  await mkdir(dir, { recursive: true });

  const save = async (name: string, html: string): Promise<void> => {
    await writeFile(join(dir, name), scrub(html), 'utf8');
    log(`saved ${name} (${html.length} bytes)`);
  };

  log(`portal: ${config.baseUrl}`);

  const panel = await post(
    config.baseUrl,
    PORTAL_PATHS.semesterPanel,
    session,
    config.userAgent,
    {},
  );
  await save(fixtureName.semesterPanel(), panel);
  const semesters = parseOptions(panel);
  if (semesters.length === 0) {
    throw new Error('no semesters parsed — the session is likely invalid or expired');
  }
  const semester = semesters[0]!;
  log(`semester: "${semester.label}" (value=${semester.value})`);
  await sleep(DELAY_MS);

  const degreesHtml = await post(config.baseUrl, PORTAL_PATHS.ajax, session, config.userAgent, {
    semester: semester.value,
  });
  await save(fixtureName.degrees(semester.value), degreesHtml);
  const degrees = parseOptions(degreesHtml);
  if (degrees.length === 0) throw new Error('no degrees parsed for the chosen semester');
  const degree = degrees[0]!;
  log(`degree: "${degree.label}" (value=${degree.value})`);
  await sleep(DELAY_MS);

  const sectionsHtml = await post(config.baseUrl, PORTAL_PATHS.ajax, session, config.userAgent, {
    semester: semester.value,
    program: degree.value,
  });
  await save(fixtureName.sections(semester.value, degree.value), sectionsHtml);
  const sections = parseOptions(sectionsHtml).slice(0, MAX_SECTIONS);
  if (sections.length === 0) throw new Error('no sections parsed for the chosen degree');
  log(`sections: ${sections.map((s) => `${s.label}(${s.value})`).join(', ')}`);
  await sleep(DELAY_MS);

  for (const section of sections) {
    const html = await post(
      config.baseUrl,
      PORTAL_PATHS.sectionTimetable,
      session,
      config.userAgent,
      {
        semester: semester.value,
        program: degree.value,
        section: section.value,
      },
    );
    await save(fixtureName.timetable(semester.value, degree.value, section.value), html);
    await sleep(DELAY_MS);
  }

  // Fail if any session value leaked past the scrub.
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.html'))) {
    const content = await readFile(join(dir, file), 'utf8');
    if (/PHPSESSID=(?!REDACTED)/i.test(content)) {
      throw new Error(`session value leaked into ${file} — aborting`);
    }
  }

  log(`done: recorded ${3 + sections.length} responses to ${dir}`);
  log('REVIEW each .html for personal data (e.g. your name in the page header) before committing.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
