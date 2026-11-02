import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let runsDir = '';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error !== undefined && { error }) });

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(
    join(runsDir, '2026-11-01.jsonl'),
    [
      line('2026-11-01T02:00:00+01:00', 'zeta-sync', 'ok', 'ana'),
      line('2026-11-01T02:01:00+01:00', 'alpha-build', 'retry', 'bob', 'timeout'),
      line('2026-11-01T02:02:00+01:00', 'alpha-build', 'retry', 'bob', 'timeout'),
      line('2026-11-01T02:03:00+01:00', 'alpha-build', 'retry', 'bob', 'timeout'),
      line('2026-11-01T02:04:00+01:00', 'alpha-build', 'ok', 'bob'),
      line('2026-11-01T02:05:00+01:00', 'mid-report', 'fail', null, 'boom'),
    ].join('\n') + '\n',
  );
  writeFileSync(join(runsDir, '2026-11-02.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-11-03.jsonl'),
    [
      line('2026-11-03T02:00:00+01:00', 'beta', 'ok', 'ana'),
      line('2026-11-03T02:01:00+01:00', 'alpha', 'ok', 'bob'),
      '{"at":"2026-11-03T02:02:00+01:00","job":"gam',
    ].join('\n') + '\n',
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const app = () =>
  createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

const rowsOf = (html: string) => (html.match(/<tr[\s>][\s\S]*?<\/tr>/g) ?? []).filter((r) => !r.includes('<th'));

describe('GET /digest/:night', () => {
  it('renders one row per job, sorted, with — for a null owner', async () => {
    const res = await app().request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<h1>digest 2026-11-01</h1>');
    expect(html.match(/<table/g)).toHaveLength(1);
    const rows = rowsOf(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('alpha-build');
    expect(rows[1]).toContain('mid-report');
    expect(rows[2]).toContain('zeta-sync');
    expect(rows[1]).toContain('—');
  });

  it('marks rows with 3+ retries or a failing last status as warn', async () => {
    const rows = rowsOf(await (await app().request('/digest/2026-11-01')).text());
    expect(rows[0]).toContain('class="warn"');
    expect(rows[1]).toContain('class="warn"');
    expect(rows[2]).not.toContain('class="warn"');
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app().request('/digest/2026-11-02');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('reports skipped bad lines', async () => {
    const res = await app().request('/digest/2026-11-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<p class="warn">1 bad line(s) skipped</p>');
    expect(rowsOf(html)).toHaveLength(2);
  });

  it('404s for a night with no file', async () => {
    const res = await app().request('/digest/2026-11-09');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2026-11-09');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON, rows sorted by job', async () => {
    const res = await app().request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-11-01',
      rows: [
        {
          job: 'alpha-build',
          owner: 'bob',
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: 'timeout',
          firstAt: '2026-11-01T02:01:00+01:00',
          lastAt: '2026-11-01T02:04:00+01:00',
        },
        {
          job: 'mid-report',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'boom',
          firstAt: '2026-11-01T02:05:00+01:00',
          lastAt: '2026-11-01T02:05:00+01:00',
        },
        {
          job: 'zeta-sync',
          owner: 'ana',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-11-01T02:00:00+01:00',
          lastAt: '2026-11-01T02:00:00+01:00',
        },
      ],
      counts: { ok: 2, retry: 3, fail: 1 },
      badLines: 0,
    });
  });

  it('returns no rows for an empty night', async () => {
    const res = await app().request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-11-02',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('counts bad lines without failing', async () => {
    const res = await app().request('/api/digest/2026-11-03');
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows).toHaveLength(2);
  });

  it('404s for a night with no file', async () => {
    const res = await app().request('/api/digest/2026-11-09');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2026-11-09' });
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app().request('/digest/2026-11-01')).text();
    const body = (await (await app().request('/api/digest/2026-11-01')).json()) as { rows: { job: string }[] };
    const jobs = body.rows.map((r) => r.job);
    const fromPage = rowsOf(html).map((r) => jobs.find((j) => r.includes(j)));
    expect(fromPage).toEqual(jobs);
  });
});
