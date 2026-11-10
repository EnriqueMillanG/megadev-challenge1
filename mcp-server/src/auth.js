// OAuth 2.1 authorization server for this MCP server: dynamic client registration,
// authorization code + PKCE, refresh tokens. The owner approves each client on a consent
// page with the owner password (OWNER_PASSWORD), so only clients the owner lets in get a token.
import crypto from 'node:crypto';
import { InvalidGrantError, InvalidTokenError, InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { page, esc } from './html.js';

const ACCESS_TTL = 60 * 60;            // 1 hour
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days
const CODE_TTL = 10 * 60;              // 10 minutes
const PENDING_TTL = 30 * 60;           // consent page stays valid 30 minutes

const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

function sameSecret(a, b) {
  const x = Buffer.from(hash(String(a))), y = Buffer.from(hash(String(b)));
  return crypto.timingSafeEqual(x, y);
}

export function createAuth({ store, baseUrl, resourceUrl }) {
  const failed = new Map(); // ip -> { n, until }

  const clientsStore = {
    async getClient(id) {
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return undefined;
      return (await store.getJson(`oauth/clients/${id}.json`)) ?? undefined;
    },
    async registerClient(client) {
      const full = { ...client, client_id: rand(16), client_id_issued_at: now() };
      await store.putJson(`oauth/clients/${full.client_id}.json`, full);
      return full;
    },
  };

  async function issueTokens(clientId, scopes, resource) {
    const access = rand(), refresh = rand();
    const base = { clientId, scopes, resource: resource ?? resourceUrl.href };
    await store.putJson(`oauth/tokens/${hash(access)}.json`, { ...base, kind: 'access', expiresAt: now() + ACCESS_TTL });
    await store.putJson(`oauth/tokens/${hash(refresh)}.json`, { ...base, kind: 'refresh', expiresAt: now() + REFRESH_TTL });
    return {
      access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL,
      refresh_token: refresh, scope: scopes.join(' ') || undefined,
    };
  }

  const provider = {
    clientsStore,

    // Shows the consent page. Nothing is granted until the owner approves it.
    async authorize(client, params, res) {
      if (params.resource && params.resource.href.replace(/\/$/, '') !== resourceUrl.href.replace(/\/$/, '')) {
        throw new InvalidRequestError(`Unknown resource: ${params.resource.href}`);
      }
      const id = rand(18);
      await store.putJson(`oauth/pending/${id}.json`, {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes: params.scopes ?? [],
        resource: params.resource?.href,
        expiresAt: now() + PENDING_TTL,
      });
      res.set('Cache-Control', 'no-store');
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
      res.status(200).type('html').send(consentPage({ id, client, redirectUri: params.redirectUri }));
    },

    async challengeForAuthorizationCode(client, code) {
      const c = await store.getJson(`oauth/codes/${hash(code)}.json`);
      if (!c || c.clientId !== client.client_id || c.expiresAt < now()) throw new InvalidGrantError('Invalid authorization code');
      return c.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      const key = `oauth/codes/${hash(code)}.json`;
      const c = await store.getJson(key);
      await store.delete(key); // single use
      if (!c || c.clientId !== client.client_id || c.expiresAt < now()) throw new InvalidGrantError('Invalid authorization code');
      if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri does not match');
      if (resource && c.resource && resource.href !== c.resource) throw new InvalidGrantError('resource does not match');
      return issueTokens(client.client_id, c.scopes, c.resource);
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const key = `oauth/tokens/${hash(refreshToken)}.json`;
      const t = await store.getJson(key);
      if (!t || t.kind !== 'refresh' || t.clientId !== client.client_id || t.expiresAt < now()) throw new InvalidGrantError('Invalid refresh token');
      await store.delete(key); // rotate
      if (scopes?.length && !scopes.every((s) => t.scopes.includes(s))) throw new InvalidGrantError('Scope exceeds the grant');
      if (resource && resource.href !== t.resource) throw new InvalidGrantError('resource does not match');
      return issueTokens(client.client_id, scopes?.length ? scopes : t.scopes, t.resource);
    },

    async verifyAccessToken(token) {
      const t = await store.getJson(`oauth/tokens/${hash(token)}.json`);
      if (!t || t.kind !== 'access') throw new InvalidTokenError('Invalid token');
      return { token, clientId: t.clientId, scopes: t.scopes, expiresAt: t.expiresAt, resource: new URL(t.resource) };
    },

    async revokeToken(client, { token }) {
      const key = `oauth/tokens/${hash(token)}.json`;
      const t = await store.getJson(key);
      if (t && t.clientId === client.client_id) await store.delete(key);
    },
  };

  // POST /consent — the owner approves or denies a pending authorization.
  async function consentHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    const f = failed.get(ip);
    if (f && f.until > Date.now()) return res.status(429).type('html').send(page('Too many tries', '<p>Too many wrong passwords. Wait 15 minutes.</p>'));

    const id = String(req.body?.id ?? '');
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return res.status(400).type('html').send(page('Bad request', '<p>Unknown request.</p>'));
    const key = `oauth/pending/${id}.json`;
    const p = await store.getJson(key);
    if (!p || p.expiresAt < now()) return res.status(400).type('html').send(page('Expired', '<p>This request expired. Start the connection again.</p>'));

    const back = new URL(p.redirectUri);
    if (p.state !== undefined) back.searchParams.set('state', p.state);

    if (req.body?.action !== 'approve') {
      await store.delete(key);
      back.searchParams.set('error', 'access_denied');
      return res.redirect(302, back.href);
    }

    const owner = process.env.OWNER_PASSWORD?.trim();
    if (!owner || !sameSecret(req.body?.password ?? '', owner)) {
      const n = (f?.n ?? 0) + 1;
      failed.set(ip, { n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
      return res.status(401).type('html').send(page('Wrong password', `<p>Wrong owner password.</p><p><a href="javascript:history.back()">Back</a></p>`));
    }
    failed.delete(ip);
    await store.delete(key);
    const code = rand();
    await store.putJson(`oauth/codes/${hash(code)}.json`, { ...p, expiresAt: now() + CODE_TTL });
    back.searchParams.set('code', code);
    res.redirect(302, back.href);
  }

  // Redirect target for clients that cannot run a local callback (this owner's own harness in the
  // cloud). It keeps the code for 5 minutes under the hash of `state`; only who knows state reads it.
  async function relayHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const { state, code, error } = req.query;
    if (typeof state !== 'string' || state.length < 32) return res.status(400).type('html').send(page('Bad request', '<p>Missing state.</p>'));
    await store.putJson(`oauth/relay/${hash(state)}.json`, { code: code ?? null, error: error ?? null, expiresAt: now() + 300 });
    res.type('html').send(page('Done', '<p>Done. You can close this tab and go back to your agent.</p>'));
  }
  async function relayPollHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const state = String(req.body?.state ?? '');
    if (state.length < 32) return res.status(400).json({ error: 'missing state' });
    const key = `oauth/relay/${hash(state)}.json`;
    const r = await store.getJson(key);
    if (!r || r.expiresAt < now()) return res.status(404).json({ pending: true });
    await store.delete(key);
    res.json({ code: r.code, error: r.error });
  }

  return { provider, consentHandler, relayHandler, relayPollHandler };
}

function consentPage({ id, client, redirectUri }) {
  const name = client.client_name || 'An unnamed client';
  const host = (() => { try { return new URL(redirectUri).host; } catch { return redirectUri; } })();
  return page('Let this client in?', `
    <p><strong>${esc(name)}</strong> asks to use this MCP server: save and search your notes, upload files and transcribe audio.</p>
    <p>After you approve, you return to <code>${esc(host)}</code>.</p>
    <form method="post" action="/consent">
      <input type="hidden" name="id" value="${esc(id)}">
      <label>Owner password<br><input type="password" name="password" autocomplete="current-password" autofocus></label>
      <p><button name="action" value="approve">Approve</button> <button name="action" value="deny">Deny</button></p>
    </form>
    <p class="small">Only the owner of this server has the password. If you did not start this, press Deny.</p>`);
}
