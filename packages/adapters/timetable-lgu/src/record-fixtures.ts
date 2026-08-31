import 'dotenv/config';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config';
import { crawl } from './fetch';
import {
  createLiveHttpClient,
  createRecordingHttpClient,
  PortalBlockedError,
  type HttpClient,
} from './http';
import { createAutonomousSession } from './session';

// Records the FULL portal (every semester x degree x section) into
// tests/fixtures so dev and CI replay real data offline. Drives the SAME crawl()
// the source uses, wrapped in a recording client, so the fixture set always
// matches what fetch requests. Autonomous session (no human cookie needed; an
// env LGU_PHPSESSID is an optional override). Polite: honest UA, delay, backoff,
// and it aborts (never hammers) on a block. Run locally, never in CI.
//
// Note: chrome PII (a staff name in the site nav/footer) is scrubbed
// structurally below, but the scrub is best-effort; REVIEW the saved pages
// before committing.

function scrub(html: string): string {
  return (
    html
      .replace(/PHPSESSID=[^;"'\s]+/gi, 'PHPSESSID=REDACTED')
      .replace(/cf_clearance=[^;"'\s]+/gi, 'cf_clearance=REDACTED')
      // The "Project Incharge" credit block in the settings dropdown.
      .replace(
        /(<center>\s*<small[^>]*>\s*<i>\s*<u>)[\s\S]*?(<\/u>\s*<\/i>\s*<\/small>\s*<\/center>)/gi,
        '$1REDACTED$2',
      )
      // The green, href-less name link in the nav.
      .replace(/(<a\s+style="color:Green;\s*font-weight:500;">)[^<]*(<\/a>)/gi, '$1REDACTED$2')
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (m: string): void => console.log(`[record] ${m}`);

  let inner: HttpClient;
  if (config.phpSessId) {
    const cf = process.env.LGU_CF_CLEARANCE;
    const cookie = `PHPSESSID=${config.phpSessId}${cf ? `; cf_clearance=${cf}` : ''}`;
    inner = createLiveHttpClient(config.baseUrl, cookie, config.userAgent);
    log('session: env override (LGU_PHPSESSID)');
  } else {
    const session = await createAutonomousSession(config.baseUrl, config.userAgent);
    inner = createLiveHttpClient(config.baseUrl, session.cookie, config.userAgent);
    log('session: autonomous (mint + Continue)');
  }

  const dir = config.fixturesDir;
  await mkdir(dir, { recursive: true });
  log(`portal: ${config.baseUrl}; recording FULL crawl to ${dir}`);

  const recorder = createRecordingHttpClient(inner, dir, scrub, (file, bytes) =>
    log(`saved ${file} (${bytes} bytes)`),
  );

  let records;
  try {
    records = await crawl(recorder, config);
  } catch (error) {
    if (error instanceof PortalBlockedError) {
      log(`ABORTED: ${error.message}`);
      log('The portal looks rate-limited or blocked. Stopping without hammering.');
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Belt and suspenders: no live session value may reach a committed fixture.
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.html'))) {
    if (/PHPSESSID=(?!REDACTED)/i.test(await readFile(join(dir, file), 'utf8'))) {
      throw new Error(`session value leaked into ${file}; aborting`);
    }
  }

  log(`done: ${records.sections.length} section timetables, ${records.anomalies.length} anomalies`);
  for (const a of records.anomalies.slice(0, 20)) {
    log(
      `  anomaly [${a.stage}] ${[a.semester, a.degree, a.section].filter(Boolean).join(' / ')}: ${a.message}`,
    );
  }
  log('REVIEW each .html for personal data (a name in the page chrome) before committing.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
