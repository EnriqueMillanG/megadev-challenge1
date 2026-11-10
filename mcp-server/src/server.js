import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createStore, withLock } from './store.js';
import { createAuth } from './auth.js';
import { fetchPublic } from './fetchsafe.js';
import { transcribe } from './transcribe.js';
import { planPage } from './plan.js';
import { page } from './html.js';

const PORT = Number(process.env.PORT || 8080);
const BASE = new URL(process.env.PUBLIC_URL || `http://localhost:${PORT}`);
const MCP_URL = new URL('/mcp', BASE);
const PLAN_URL = new URL('/plan', BASE);
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);

const store = await createStore();
const auth = createAuth({ store, baseUrl: BASE, resourceUrl: MCP_URL });

// ---------- tools ----------

const memoKey = 'memo/notes.json';
const fileUrl = (id, name) => new URL(`/files/${id}/${encodeURIComponent(name)}`, BASE).href;
const cleanName = (s) => (String(s || 'file').split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120) || 'file');
const ok = (data) => ({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

const Note = z.object({ id: z.string(), text: z.string(), created_at: z.string() });
const Segment = z.object({ start: z.number().describe('Seconds from the start of the audio.'), text: z.string() });

function buildMcp() {
  const mcp = new McpServer({ name: 'schema-first', version: '1.0.0' }, {
    instructions: `Personal tool server: notes (memo_write, memo_search), file hosting (upload) and speech to text (transcribe). Plan page: ${PLAN_URL.href}`,
  });

  mcp.registerTool('memo_write', {
    title: 'Write a note',
    description: 'Saves a note on this server. Returns its id.',
    inputSchema: z.object({ text: z.string().min(1).max(20000).describe('The note.') }),
    outputSchema: z.object({ id: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ text }) => {
    const note = { id: crypto.randomUUID(), text, created_at: new Date().toISOString() };
    await withLock(memoKey, async () => {
      const notes = await store.getJson(memoKey, []);
      notes.push(note);
      await store.putJson(memoKey, notes);
    });
    return ok({ id: note.id });
  });

  mcp.registerTool('memo_search', {
    title: 'Search notes',
    description: 'Finds saved notes whose text contains every word of the query (case-insensitive). An empty query returns every note. Newest first.',
    inputSchema: z.object({
      query: z.string().max(500).optional().default('').describe('Words to look for. Empty for every note.'),
      limit: z.number().int().min(1).max(500).optional().default(100).describe('Most notes to return.'),
    }),
    outputSchema: z.object({ notes: z.array(Note) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, limit }) => {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const notes = (await store.getJson(memoKey, []))
      .filter((n) => words.every((w) => n.text.toLowerCase().includes(w)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
    return ok({ notes });
  });

  mcp.registerTool('upload', {
    title: 'Upload a file',
    description: 'Puts a file on this server and returns a public link that anyone can open. Give the file as content_base64, as text, or as a url to copy from.',
    inputSchema: z.object({
      filename: z.string().min(1).max(200).describe('File name, e.g. "notes.txt".'),
      content_base64: z.string().optional().describe('The file bytes, base64-encoded.'),
      text: z.string().optional().describe('The file as UTF-8 text, instead of content_base64.'),
      url: z.string().url().optional().describe('A public http(s) URL to copy the file from, instead of content_base64 or text.'),
      content_type: z.string().max(200).optional().describe('MIME type. Guessed from the source when left out.'),
    }),
    outputSchema: z.object({ url: z.string().url(), id: z.string(), size: z.number().int(), content_type: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (args) => {
    const given = ['content_base64', 'text', 'url'].filter((k) => args[k] !== undefined);
    if (given.length !== 1) return fail('Give exactly one of content_base64, text or url.');
    let data, type = args.content_type;
    try {
      if (args.content_base64 !== undefined) data = Buffer.from(args.content_base64, 'base64');
      else if (args.text !== undefined) { data = Buffer.from(args.text, 'utf8'); type ??= 'text/plain; charset=utf-8'; }
      else { const r = await fetchPublic(args.url, { maxBytes: MAX_UPLOAD }); data = r.data; type ??= r.contentType; }
    } catch (e) { return fail(`Could not copy ${args.url}: ${e.message}`); }
    if (data.length > MAX_UPLOAD) return fail(`File is larger than ${MAX_UPLOAD} bytes.`);
    type = String(type || guessType(args.filename)).replace(/[\r\n]/g, '');
    const id = crypto.randomBytes(12).toString('base64url');
    const name = cleanName(args.filename);
    await store.putBytes(`files/${id}`, data, type);
    await store.putJson(`files/${id}.json`, { name, type, size: data.length, created_at: new Date().toISOString() });
    return ok({ url: fileUrl(id, name), id, size: data.length, content_type: type });
  });

  mcp.registerTool('transcribe', {
    title: 'Transcribe audio',
    description: 'Turns the audio (or video) at a URL into timestamped text. Each segment has its start in seconds from the start of the clip. Runs whisper.cpp on this server.',
    inputSchema: z.object({ url: z.string().url().describe('Public http(s) URL of the audio or video, or a link from upload.') }),
    outputSchema: z.object({ segments: z.array(Segment) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    let audio;
    try {
      const own = ownFileId(url);
      if (own) {
        const f = await store.getBytes(`files/${own}`);
        if (!f) return fail(`Could not transcribe ${url}: no file was uploaded under that link.`);
        audio = f.data;
      } else {
        audio = (await fetchPublic(url, { maxBytes: 200 * 1024 * 1024 })).data;
      }
    } catch (e) { return fail(`Could not download ${url}: ${e.message}`); }
    let result;
    try { result = await transcribe(audio); }
    catch (e) {
      console.error('transcribe failed', url, e.stderr || e.message);
      if (e.notAudio) return fail(`Could not transcribe ${url}: it is not audio or video (no audio stream could be decoded; got ${describeBytes(audio)}).`);
      return fail(`Could not transcribe ${url}: speech recognition failed on this server.`);
    }
    // Text twin for clients without structuredContent: one "start text" line per segment.
    return {
      structuredContent: result,
      content: [{ type: 'text', text: result.segments.map((s) => `${s.start} ${s.text}`).join('\n') }],
    };
  });

  return mcp;
}

function describeBytes(buf) {
  const head = buf.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'a web page (HTML)';
  if (head.startsWith('{') || head.startsWith('[')) return 'JSON';
  return `${buf.length} bytes of an unknown format`;
}

function ownFileId(url) {
  const u = new URL(url);
  if (u.origin !== BASE.origin) return null;
  const m = u.pathname.match(/^\/files\/([A-Za-z0-9_-]{16})(\/|$)/);
  return m ? m[1] : null;
}

function guessType(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return ({ txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json', csv: 'text/csv', html: 'text/html', pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' })[ext] || 'application/octet-stream';
}

// ---------- http ----------

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });

app.use(mcpAuthRouter({
  provider: auth.provider,
  issuerUrl: BASE,
  resourceServerUrl: MCP_URL,
  serviceDocumentationUrl: PLAN_URL,
  resourceName: 'schema-first: memo, upload, transcribe',
}));

app.post('/consent', express.urlencoded({ extended: false, limit: '10kb' }), wrap(auth.consentHandler));
app.get('/oauth/relay', wrap(auth.relayHandler));
app.post('/oauth/relay/poll', express.json({ limit: '2kb' }), wrap(auth.relayPollHandler));

app.get('/', (req, res) => res.redirect(302, '/plan'));
app.get('/plan', (req, res) => res.type('html').send(planPage({ base: BASE.href, mcp: MCP_URL.href })));
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/files/:id{/:name}', wrap(async (req, res) => {
  const { id } = req.params;
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return res.status(404).end();
  const f = await store.getBytes(`files/${id}`);
  if (!f) return res.status(404).type('text').send('Not found');
  const meta = await store.getJson(`files/${id}.json`, {});
  res.set('Content-Type', f.contentType || meta.type || 'application/octet-stream');
  // Uploaded files are anyone's content: never let them run as this site.
  res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  res.set('Content-Disposition', `inline; filename="${meta.name || 'file'}"`);
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Access-Control-Allow-Origin', '*');
  res.send(f.data);
}));

const bearer = requireBearerAuth({
  verifier: auth.provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(MCP_URL),
  expectedResource: MCP_URL,
});

// MCP 2026-07-28 (server/discover, per-request envelope) plus stateless fallback for 2025-era clients.
const mcpHandler = toNodeHandler(createMcpHandler(() => buildMcp(), {
  onerror: (e) => console.error('mcp error', e),
}), { onerror: (e) => console.error('mcp adapter error', e) });
const jsonBody = express.json({ limit: Math.ceil(MAX_UPLOAD * 1.4) + 65536 });
app.post('/mcp', bearer, jsonBody, (req, res) => mcpHandler(req, res, req.body));
app.get('/mcp', bearer, (req, res) => mcpHandler(req, res));
app.delete('/mcp', bearer, (req, res) => mcpHandler(req, res));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).type('html').send(page('Error', '<p>Something went wrong.</p>'));
});

function wrap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

app.listen(PORT, () => console.log(`listening on ${PORT}, public ${BASE.href}`));
