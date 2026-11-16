// sched-prod API: the incidents the status page and the board read. Contract: contract/api.md.

const json = (body, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'not found' }, 404);

// Record 0001: read production's feed live, keep no copy. Record 0002: newest first, always.
async function feed(env) {
  const res = await fetch(env.FEED_URL);
  if (!res.ok) throw new Error(`feed answered ${res.status}`);
  const { incidents } = await res.json();
  return [...incidents]
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
    // Record 0007 (#2, owner chose option 2): every incident carries `suggestions`, always empty.
    // No suggestion is made and there is no accept call.
    .map((i) => ({ ...i, suggestions: [] }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return notFound();

    if (url.pathname === '/incidents') {
      let incidents = await feed(env);
      // #4: ?status=open|resolved filters by status; no status = all.
      const status = url.searchParams.get('status');
      if (status !== null) {
        if (!['open', 'resolved'].includes(status)) return json({ error: 'status must be open or resolved' }, 400);
        incidents = incidents.filter((i) => i.status === status);
      }
      // #5: ?since=<ISO time> keeps incidents opened after that time; no since = all.
      const since = url.searchParams.get('since');
      if (since !== null) {
        const t = Date.parse(since);
        if (Number.isNaN(t)) return json({ error: 'since must be an ISO 8601 time' }, 400);
        incidents = incidents.filter((i) => Date.parse(i.openedAt) > t);
      }
      return json({ incidents });
    }

    // #1: one incident by id, the same fields GET /incidents gives it.
    const one = url.pathname.match(/^\/incidents\/([^/]+)$/);
    if (one) {
      const id = decodeURIComponent(one[1]);
      const incident = (await feed(env)).find((i) => i.id === id);
      return incident ? json({ incident }) : notFound();
    }

    return notFound();
  },
};
