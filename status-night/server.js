// Night status page for sched-prod (S03E01). Built from the requirements list:
//   R-M3H newest incident first      R-X5K each incident names who ran it (as the feed gives it)
//   R-L3K dates day first, 05/10     R-H9K last night only
//   R-Z5L heading "status for the night"   R-X2M says "read by tram 3 boards"
//   R-M9Z amber banner #f5a623       R-H4L footer: all times UTC
//   R-Z2K every line gets its own row, tram 3 included
//   R-K8L updatedAt = the ops feed's, read live, never a copy   R-H8X updatedAt in UTC, ending in Z
//   R-K4M status.json answers Access-Control-Allow-Origin: *    R-L5Z Cache-Control max-age 60 or less
// No dependencies, no login, no tracking, no cookies.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const FEED = process.env.FEED_URL || 'https://hq.mega.dev/challenges/status-for-the-night/api/incidents/e61181243445';
const AMBER = '#f5a623';

// R-K8L: read the ops feed live on every request; nothing is stored.
async function readFeed() {
  const r = await fetch(FEED, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`ops feed answered HTTP ${r.status}`);
  return r.json();
}

// R-H9K: last night only. The night is the one that holds the newest incident:
// from 18:00 UTC the day before its date to 12:00 UTC on its date.
function lastNight(incidents) {
  if (!incidents.length) return [];
  const newest = incidents.map((i) => new Date(i.opened)).sort((a, b) => b - a)[0];
  const day = Date.UTC(newest.getUTCFullYear(), newest.getUTCMonth(), newest.getUTCDate());
  const from = day - 6 * 3600e3, to = day + 12 * 3600e3;
  return incidents.filter((i) => { const t = Date.parse(i.opened); return t >= from && t < to; });
}

const byNewest = (a, b) => Date.parse(b.opened) - Date.parse(a.opened); // R-M3H
const pad = (n) => String(n).padStart(2, '0');
const ddmm = (iso) => { const d = new Date(iso); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; }; // R-L3K
const hhmm = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// R-H8X: updatedAt in UTC, ending in Z.
const utcZ = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function status() {
  const feed = await readFeed();
  const incidents = lastNight(feed.incidents || []).sort(byNewest);
  return { updatedAt: utcZ(feed.updatedAt), incidents };
}

function page({ updatedAt, incidents }) {
  // R-Z2K: one row per line, tram 3 included, each with its last incident of the night.
  const lines = new Map([['tram 3', null]]);
  for (const i of incidents) if (!lines.get(i.line)) lines.set(i.line, i);
  const lineRows = [...lines].map(([line, i]) => `<tr><td>${esc(line)}</td><td>${i && !i.closed ? 'affected' : 'running'}</td><td>${i ? `${esc(i.what)} (${ddmm(i.opened)} ${hhmm(i.opened)})` : 'none tonight'}</td></tr>`).join('');
  const rows = incidents.map((i) => `<tr><td>${ddmm(i.opened)}</td><td>${hhmm(i.opened)}</td><td>${hhmm(i.closed)}</td><td>${esc(i.line)}</td><td>${esc(i.what)}</td><td>${esc(i.author)}</td></tr>`).join('')
    || '<tr><td colspan="6">No incidents last night.</td></tr>';
  const open = incidents.some((i) => !i.closed);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>status for the night · sched-prod</title>
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1b1b1f; background: #fff; }
  .banner { background: ${AMBER}; color: #1a1a1a; padding: 14px 24px; font-weight: 600; }
  main { max-width: 52rem; margin: 0 auto; padding: 8px 24px 40px; }
  h1 { font-size: 1.6rem; margin: 20px 0 4px; } h2 { font-size: 1.05rem; margin: 28px 0 6px; }
  .note { color: #555; margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
  th { color: #777; font-weight: 500; font-size: .9rem; }
  footer { margin-top: 28px; color: #555; font-size: .9rem; }
  @media (max-width: 600px) { th:nth-child(4), td:nth-child(4) { display: none; } }
</style></head>
<body>
<div class="banner" role="status">${open ? 'Some services have problems now.' : 'Some services had problems overnight.'}</div>
<main>
<h1>status for the night</h1>
<p class="note">sched-prod · read by tram 3 boards · data from the ops feed, updated <time datetime="${esc(updatedAt)}">${ddmm(updatedAt)} ${hhmm(updatedAt)}</time> · <a href="status.json">status.json</a></p>
<h2>Lines</h2>
<table><thead><tr><th>line</th><th>now</th><th>last incident</th></tr></thead><tbody>${lineRows}</tbody></table>
<h2>Incidents last night, newest first</h2>
<table><thead><tr><th>date</th><th>opened</th><th>closed</th><th>line</th><th>what</th><th>ran by</th></tr></thead><tbody>${rows}</tbody></table>
<footer>all times UTC</footer>
</main></body></html>`;
}

const headers = (type) => ({
  'Content-Type': type,
  'Access-Control-Allow-Origin': '*',          // R-K4M
  'Cache-Control': 'public, max-age=60',       // R-L5Z
  'X-Content-Type-Options': 'nosniff',
});

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers('text/plain'), 'Access-Control-Allow-Methods': 'GET, OPTIONS' }); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }); return res.end(); }
    if (path === '/status.json') {
      const s = await status();
      res.writeHead(200, headers('application/json; charset=utf-8'));
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(s));
    }
    if (path === '/' || path === '/index.html') {
      const s = await status();
      res.writeHead(200, headers('text/html; charset=utf-8'));
      return res.end(req.method === 'HEAD' ? undefined : page(s));
    }
    res.writeHead(404, headers('text/plain; charset=utf-8')); res.end('Not found');
  } catch (e) {
    console.error(e);
    res.writeHead(502, { ...headers('text/plain; charset=utf-8'), 'Cache-Control': 'no-store' });
    res.end(`The ops feed could not be read: ${e.message}`);
  }
}).listen(PORT, () => console.log(`status page on ${PORT}`));
