import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { crawl } from '../src/fetch';
import { createFixtureHttpClient, type HttpClient } from '../src/http';
import { fixtureName, PORTAL_PATHS } from '../src/portal';

// Deterministic, self-consistent SYNTHETIC fixtures (2 semesters x 2 degrees x
// 2 sections, minus one) to prove the full cartesian traversal and the
// per-section anomaly path without depending on the live portal.
const options = (pairs: [string, string][]): string =>
  pairs.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

const timetable = (subject: string): string => `
<table id="table-time">
<tr><th>Time</th><th>8:00 - 8:30</th></tr>
<tr><th>Monday</th><td colspan=3><span>${subject}</span><br/><span>Room 1</span><br/><span>Teacher Y</span><br/><span>sec</span><br/><span>08:00 - 09:30</span></td></tr>
</table>`;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lgu-crawl-'));
  const w = (name: string, html: string): void => writeFileSync(join(dir, name), html, 'utf8');
  w(
    fixtureName.semesterPanel(),
    `<select id="semester">${options([
      ['S1', 'Sem 1'],
      ['S2', 'Sem 2'],
    ])}</select>`,
  );
  for (const s of ['S1', 'S2']) {
    w(
      fixtureName.degrees(s),
      options([
        ['1', 'Deg A'],
        ['2', 'Deg B'],
      ]),
    );
    for (const d of ['1', '2']) {
      w(
        fixtureName.sections(s, d),
        options([
          ['1', 'A'],
          ['2', 'B'],
        ]),
      );
      for (const sec of ['1', '2']) {
        if (s === 'S2' && d === '2' && sec === '2') continue; // omit one -> anomaly
        w(fixtureName.timetable(s, d, sec), timetable(`Course ${s}${d}${sec}`));
      }
    }
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('crawl (full cartesian)', () => {
  it('walks every semester x degree x section; a not-recorded combo is skipped silently', async () => {
    const records = await crawl(
      createFixtureHttpClient(dir),
      loadConfig({ SOURCE_MODE: 'fixture' }, dir),
    );
    expect(records.sections).toHaveLength(7); // 2*2*2 minus the one omitted fixture
    expect(records.anomalies).toEqual([]); // missing fixture is "not recorded", not an error
    const combos = records.sections.map(
      (r) => `${r.semester.value}/${r.degree.value}/${r.section.value}`,
    );
    expect(combos).toContain('S1/1/1');
    expect(combos).toContain('S2/2/1');
    expect(new Set(records.sections.map((r) => r.semester.value))).toEqual(new Set(['S1', 'S2']));
  });

  it('records a real (non-missing) fetch error as an anomaly and continues', async () => {
    const fixture = createFixtureHttpClient(dir);
    // Wrap the fixture client to simulate a live error on one section fetch.
    const flaky: HttpClient = {
      async post(path, params) {
        if (
          path === PORTAL_PATHS.sectionTimetable &&
          params.semester === 'S1' &&
          params.section === '2'
        ) {
          throw new Error('HTTP 500');
        }
        return fixture.post(path, params);
      },
    };
    const records = await crawl(flaky, loadConfig({ SOURCE_MODE: 'fixture' }, dir));
    const errored = records.anomalies.filter((a) => a.stage === 'timetable' && a.section === '2');
    expect(errored.length).toBeGreaterThanOrEqual(1);
    expect(errored[0]?.message).toContain('HTTP 500');
  });

  it('respects politeness caps (config.limits)', async () => {
    const records = await crawl(
      createFixtureHttpClient(dir),
      loadConfig({ SOURCE_MODE: 'fixture', LGU_MAX_SEMESTERS: '1', LGU_MAX_SECTIONS: '1' }, dir),
    );
    expect(records.sections).toHaveLength(2); // 1 sem * 2 deg * 1 sec
    expect(new Set(records.sections.map((r) => r.semester.value))).toEqual(new Set(['S1']));
  });
});
