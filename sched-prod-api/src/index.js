// sched-prod API: the incidents the status page and the board read. Contract: contract/api.md.

const json = (body, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'not found' }, 404);

// Record 0001: read production's feed live, keep no copy. Record 0002: newest first, always.
async function feed(env) {
  const res = await fetch(env.FEED_URL);
  if (!res.ok) throw new Error(`feed answered ${res.status}`);
  const { incidents } = await res.json();
  return [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return notFound();

    if (url.pathname === '/incidents') {
      return json({ incidents: await feed(env) });
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
