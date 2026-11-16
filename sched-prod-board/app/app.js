import { fetchIncidents, ack } from './api.js';
import { BUILD } from './build.js';

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('#status');
const panel = document.querySelector('[data-testid="incident-panel"]');
document.querySelector('[data-testid="build-sha"]').textContent = BUILD;

// Every incident on the board, by id, and its row element. Rows are only ever added: a refresh inserts the
// new ones in place and never rebuilds or removes a row, so nothing moves out from under the pointer except
// by the new row landing at the top (R1, R4).
const incidents = new Map();
const rows = new Map();
const acked = new Map(); // id -> ackedAt

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// R5: the viewer's local time; day before month for EU locales. The full UTC value stays in datetime.
const locale = navigator.language || 'en-GB';
const timeFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function localTime(iso) {
  const parts = timeFmt.formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dayFirst = parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
  const date = dayFirst ? `${get('day')}/${get('month')}` : `${get('month')}/${get('day')}`;
  return `${date} ${get('hour')}:${get('minute')}`;
}

const newestFirst = (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt);

function makeRow(i) {
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'incident-row');
  li.dataset.id = i.id;
  li.className = `row ${i.severity}`;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Open ${i.id}`);
  li.innerHTML = `<span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    <span class="state"></span>`;
  return li;
}

function markAcked(id) {
  const li = rows.get(id);
  if (!li || li.querySelector('[data-testid="acked"]')) return;
  li.classList.add('is-acked');
  li.querySelector('.state').innerHTML = `<span data-testid="acked" class="acked">Acked ${esc(localTime(acked.get(id)))}</span>`;
}

// Adds the incidents not on the board yet, each at its place in newest-first order.
function addNew(list_) {
  const fresh = list_.filter((i) => !incidents.has(i.id)).sort(newestFirst);
  for (const i of fresh) {
    incidents.set(i.id, i);
    const li = makeRow(i);
    rows.set(i.id, li);
    const after = [...list.children].find((r) => Date.parse(incidents.get(r.dataset.id).openedAt) < Date.parse(i.openedAt));
    list.insertBefore(li, after ?? null);
  }
  empty.hidden = incidents.size > 0;
}

async function refresh() {
  const page = await fetchIncidents();
  addNew(page.incidents);
}

// --- the incident panel: a row opens it; Ack lives here, tied to the incident's id, not to a position ---
function openPanel(id) {
  const i = incidents.get(id);
  if (!i) return;
  panel.dataset.id = id;
  const isAcked = acked.has(id);
  panel.innerHTML = `<h2>${esc(i.id)}</h2>
    <p class="sev">${esc(i.severity)} · ${esc(i.service)} · ${esc(i.region)}</p>
    <p>${esc(i.summary)}</p>
    <p class="when">Opened <time datetime="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time></p>
    ${isAcked
      ? `<p class="acked">Acked ${esc(localTime(acked.get(id)))}</p>`
      : `<button data-testid="panel-ack" type="button">Ack ${esc(i.id)}</button>`}
    <button class="close" type="button" aria-label="Close panel">Close</button>
    <p class="panel-status" role="status"></p>`;
  panel.hidden = false;
  for (const r of rows.values()) r.classList.toggle('is-open', r.dataset.id === id);
}

function closePanel() {
  panel.hidden = true;
  delete panel.dataset.id;
  for (const r of rows.values()) r.classList.remove('is-open');
}

list.addEventListener('click', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li) openPanel(li.dataset.id);
});
list.addEventListener('keydown', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPanel(li.dataset.id); }
});

panel.addEventListener('click', async (e) => {
  if (e.target.closest('.close')) return closePanel();
  const btn = e.target.closest('[data-testid="panel-ack"]');
  if (!btn) return;
  const id = panel.dataset.id; // the incident the panel names, never a position in the list
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    const reply = await ack(id); // R2
    acked.set(reply.id, reply.ackedAt);
    markAcked(reply.id);
    if (panel.dataset.id === id) openPanel(id);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Ack ${id}`;
    panel.querySelector('.panel-status').textContent = `Ack failed: ${err.message}`;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

// R3: loader until the first answer is on screen.
try {
  await refresh();
} catch (err) {
  status.textContent = `Could not load incidents: ${err.message}`;
}
loader.remove();
board.setAttribute('aria-busy', 'false');
empty.hidden = incidents.size > 0;

// R4: refresh every 2 seconds while the board is open; one request at a time.
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await refresh();
    status.textContent = '';
  } catch (err) {
    status.textContent = `Refresh failed, retrying: ${err.message}`;
  } finally {
    busy = false;
  }
}, 2000);
