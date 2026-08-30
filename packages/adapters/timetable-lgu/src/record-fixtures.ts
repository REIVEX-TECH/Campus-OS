import 'dotenv/config';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config';
import { PORTAL_PATHS, fixtureName, parseOptions } from './portal';
import { createAutonomousSession } from './session';

// Records real portal responses into tests/fixtures so dev and CI run offline.
// The flow is autonomous (mint anonymous session → Continue → fetch), so no
// human cookie is needed. An env LGU_PHPSESSID is only an optional override.
// Hits the live portal politely (honest UA, delays); run locally, never in CI.

const DELAY_MS = 1500;
const MAX_SECTIONS = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function post(
  baseUrl: string,
  path: string,
  cookie: string,
  ua: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
    body: new URLSearchParams(params).toString(),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`POST /${path} → HTTP ${res.status}`);
  return res.text();
}

function scrub(html: string): string {
  return html
    .replace(/PHPSESSID=[^;"'\s]+/gi, 'PHPSESSID=REDACTED')
    .replace(/cf_clearance=[^;"'\s]+/gi, 'cf_clearance=REDACTED');
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (m: string): void => console.log(`[record] ${m}`);

  let cookie: string;
  if (config.phpSessId) {
    const cf = process.env.LGU_CF_CLEARANCE;
    cookie = `PHPSESSID=${config.phpSessId}${cf ? `; cf_clearance=${cf}` : ''}`;
    log('session: env override (LGU_PHPSESSID)');
  } else {
    const session = await createAutonomousSession(config.baseUrl, config.userAgent);
    cookie = session.cookie;
    log('session: autonomous (mint + Continue)');
  }

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
    cookie,
    config.userAgent,
    {},
  );
  await save(fixtureName.semesterPanel(), panel);
  const semesters = parseOptions(panel);
  if (semesters.length === 0) throw new Error('no semesters parsed — session not activated');
  const semester = semesters[0]!;
  log(`semester: "${semester.label}" (value=${semester.value}); ${semesters.length} total`);
  await sleep(DELAY_MS);

  const degreesHtml = await post(config.baseUrl, PORTAL_PATHS.ajax, cookie, config.userAgent, {
    semester: semester.value,
  });
  await save(fixtureName.degrees(semester.value), degreesHtml);
  const degrees = parseOptions(degreesHtml);
  if (degrees.length === 0) throw new Error('no degrees parsed');
  const degree = degrees[0]!;
  log(`degree: "${degree.label}" (value=${degree.value}); ${degrees.length} total`);
  await sleep(DELAY_MS);

  const sectionsHtml = await post(config.baseUrl, PORTAL_PATHS.ajax, cookie, config.userAgent, {
    semester: semester.value,
    program: degree.value,
  });
  await save(fixtureName.sections(semester.value, degree.value), sectionsHtml);
  const sections = parseOptions(sectionsHtml).slice(0, MAX_SECTIONS);
  if (sections.length === 0) throw new Error('no sections parsed');
  log(
    `sections (first ${sections.length}): ${sections.map((s) => `${s.label}=${s.value}`).join(', ')}`,
  );
  await sleep(DELAY_MS);

  for (const section of sections) {
    const html = await post(
      config.baseUrl,
      PORTAL_PATHS.sectionTimetable,
      cookie,
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

  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.html'))) {
    if (/PHPSESSID=(?!REDACTED)/i.test(await readFile(join(dir, file), 'utf8'))) {
      throw new Error(`session value leaked into ${file} — aborting`);
    }
  }

  log(`done: recorded ${3 + sections.length} responses to ${dir}`);
  log('REVIEW each .html for personal data (e.g. a name in the page header) before committing.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
