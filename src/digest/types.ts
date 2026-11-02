// Plan morning-digest § 1. The contract every part of § 2 builds against: the page, the JSON and
// the board all read a night through readNight, so they can't disagree (ADR 0001).

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once it has parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the offset from the log.
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError: string | null; // the latest `error` seen for this job, even if a later run was ok
  firstAt: string;
  lastAt: string;
};

export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  counts: StatusCounts; // lines per status, across all jobs
  badLines: number; // lines that didn't parse; counted, never thrown
};

// Lives in src/digest/reader.ts. Returns null when the night has no file (or isn't a
// YYYY-MM-DD date), so a route can answer 404. An empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
