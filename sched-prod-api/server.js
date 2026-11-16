// Runs the Worker (src/index.js) on Node for Cloud Run: same fetch handler, env from process.env.
import http from 'node:http';
import worker from './src/index.js';

const PORT = Number(process.env.PORT || 8080);
const env = { FEED_URL: process.env.FEED_URL || '' };

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = `https://${req.headers.host || 'localhost'}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await worker.fetch(request, env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream feed unavailable' }));
  }
}).listen(PORT, () => console.log(`sched-prod-api on ${PORT}`));
