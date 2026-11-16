import { fetchIncidents, ack } from './api.js';
import { BUILD } from './build.js';

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('#status');
document.querySelector('[data-testid="build-sha"]').textContent = BUILD;

// Every incident seen so far, by id. fetchIncidents() hands back only what is new since the last cursor,
// so each refresh adds to this map instead of replacing the list (R1, R4).
const incidents = new Map();
const acked = new Map(); // id -> ackedAt (R2): survives every refresh

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// R5: the viewer's local time; day before month for EU locales. The full UTC value stays in datetime.
const locale = navigator.language || 'en-GB';
const timeFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const localTime = (iso) => timeFmt.format(new Date(iso));

function row(i) {
  const isAcked = acked.has(i.id);
  return `<li data-testid="incident-row" data-id="${esc(i.id)}" class="row ${esc(i.severity)}${isAcked ? ' is-acked' : ''}">
    <span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    ${isAcked
      ? `<span data-testid="acked" class="acked">Acked ${esc(localTime(acked.get(i.id)))}</span>`
      : `<button data-testid="ack" type="button" data-id="${esc(i.id)}">Ack</button>`}
  </li>`;
}

function render() {
  const sorted = [...incidents.values()].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)); // newest first (R1)
  list.innerHTML = sorted.map(row).join('');
  empty.hidden = sorted.length > 0;
}

async function refresh() {
  const page = await fetchIncidents();
  for (const i of page.incidents) incidents.set(i.id, i);
  return page;
}

list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    const reply = await ack(btn.dataset.id); // R2
    acked.set(reply.id, reply.ackedAt);
    status.textContent = '';
    render();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Ack';
    status.textContent = `Ack failed: ${err.message}`;
  }
});

// R3: loader until the first answer is on screen.
try {
  await refresh();
} catch (err) {
  status.textContent = `Could not load incidents: ${err.message}`;
}
loader.remove();
board.setAttribute('aria-busy', 'false');
render();

// R4: refresh every 2 seconds while the board is open; one request at a time.
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const page = await refresh();
    if (page.incidents.length) render();
    status.textContent = '';
  } catch (err) {
    status.textContent = `Refresh failed, retrying: ${err.message}`;
  } finally {
    busy = false;
  }
}, 2000);
