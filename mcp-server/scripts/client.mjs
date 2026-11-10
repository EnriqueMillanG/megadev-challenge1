#!/usr/bin/env node
// Owner's command-line client for this server.
//   node scripts/client.mjs connect <server-base-url>   register, print the consent link, wait for approval
//   node scripts/client.mjs tools                      list tools
//   node scripts/client.mjs call <tool> '<json args>'  call a tool (or @file.json for large args)
// Credentials go to $MCP_CLIENT_FILE (default ~/.config/schema-first/client.json). Never commit that file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const FILE = process.env.MCP_CLIENT_FILE || path.join(os.homedir(), '.config/schema-first/client.json');
const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = (o) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o, null, 2), { mode: 0o600 }); };
const b64 = (b) => b.toString('base64url');

async function post(url, body, form = false) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json };
}

async function connect(base) {
  base = base.replace(/\/$/, '');
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  const asMeta = await (await fetch(`${prm.authorization_servers[0].replace(/\/$/, '')}/.well-known/oauth-authorization-server`)).json();
  const redirect = `${base}/oauth/relay`;
  const reg = await post(asMeta.registration_endpoint, { client_name: 'Owner harness (Claude Code)', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  if (reg.status >= 300) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.json)}`);
  const verifier = b64(crypto.randomBytes(32));
  const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
  const state = b64(crypto.randomBytes(32));
  const u = new URL(asMeta.authorization_endpoint);
  Object.entries({ response_type: 'code', client_id: reg.json.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, resource: prm.resource }).forEach(([k, v]) => u.searchParams.set(k, v));
  save({ pending: { base, verifier, state, client_id: reg.json.client_id, redirect, resource: prm.resource, token_endpoint: asMeta.token_endpoint } });
  console.log(`Open this link, enter the owner password and press Approve:\n${u.href}\n`);
  await finish();
}

// Waits for approval and exchanges the code. Re-run it alone if the wait was interrupted.
async function finish() {
  const { base, verifier, state, client_id, redirect, resource, token_endpoint } = load().pending;
  let got;
  for (let i = 0; i < 180 && !got; i++) {
    const r = await post(`${base}/oauth/relay/poll`, { state });
    if (r.status === 200) got = r.json; else await new Promise((s) => setTimeout(s, 5000));
  }
  if (!got) throw new Error('Timed out waiting for approval (15 minutes).');
  if (!got.code) throw new Error(`Not approved: ${got.error}`);
  const tok = await post(token_endpoint, { grant_type: 'authorization_code', code: got.code, code_verifier: verifier, client_id, redirect_uri: redirect, resource }, true);
  if (tok.status >= 300) throw new Error(`token: ${tok.status} ${JSON.stringify(tok.json)}`);
  save({ server: resource, token_endpoint, client_id, ...tok.json, obtained_at: Date.now() });
  console.log(`Connected. Credentials saved to ${FILE}`);
}

async function token() {
  const c = load();
  if (Date.now() < c.obtained_at + (c.expires_in - 60) * 1000) return c;
  const tok = await post(c.token_endpoint, { grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.client_id, resource: c.server }, true);
  if (tok.status >= 300) throw new Error(`refresh: ${tok.status} ${JSON.stringify(tok.json)} — run connect again`);
  const n = { ...c, ...tok.json, obtained_at: Date.now() };
  save(n);
  return n;
}

async function client() {
  const c = await token();
  const t = new StreamableHTTPClientTransport(new URL(c.server), { requestInit: { headers: { Authorization: `Bearer ${c.access_token}` } } });
  const cl = new Client({ name: 'owner-cli', version: '1.0.0' });
  await cl.connect(t);
  return cl;
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'connect') await connect(a);
  else if (cmd === 'finish') await finish();
  else if (cmd === 'tools') { const cl = await client(); console.log(JSON.stringify((await cl.listTools()).tools, null, 2)); await cl.close(); }
  else if (cmd === 'call') { const cl = await client(); const r = await cl.callTool({ name: a, arguments: JSON.parse(b?.startsWith('@') ? fs.readFileSync(b.slice(1), 'utf8') : (b || '{}')) }, undefined, { timeout: 900_000 }); console.log(JSON.stringify(r, null, 2)); await cl.close(); }
  else { console.error('usage: client.mjs connect <base-url> | tools | call <tool> <json>'); process.exit(2); }
} catch (e) { console.error(String(e.message || e)); process.exit(1); }
