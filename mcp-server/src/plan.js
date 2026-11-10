import { page, esc } from './html.js';

export function planPage({ base, mcp }) {
  return page('schema-first — plan', `
<p>A personal remote MCP server. One home for four tools any MCP client can reach once its owner lets it in.</p>
<p>Endpoint: <code>${esc(mcp)}</code> — Streamable HTTP, MCP revision <code>2025-11-25</code> (older revisions back to <code>2025-03-26</code> are accepted). Stateless: every call is a POST; there is no session and no server-sent stream.</p>

<h2>Tools</h2>
<table>
<tr><th>Tool</th><th>Input</th><th>Result</th><th>What it does</th></tr>
<tr><td><code>memo_write</code></td><td><code>{ text }</code></td><td><code>{ id }</code></td><td>Saves a note.</td></tr>
<tr><td><code>memo_search</code></td><td><code>{ query, limit? }</code></td><td><code>{ notes: [{ id, text, created_at }] }</code></td><td>Finds notes that contain every word of the query, case-insensitive, newest first. An empty query returns every note.</td></tr>
<tr><td><code>upload</code></td><td><code>{ filename, content_base64 | text | url, content_type? }</code></td><td><code>{ url, id, size, content_type }</code></td><td>Puts a file on this server (up to 25 MB) and returns a link under <code>${esc(base)}files/</code> that anyone can open.</td></tr>
<tr><td><code>transcribe</code></td><td><code>{ url }</code></td><td><code>{ segments: [{ start, end, text }], duration, language }</code></td><td>Turns audio or video at a public URL (or an <code>upload</code> link) into timestamped text. <code>start</code> and <code>end</code> are seconds from the start of the clip. Runs whisper.cpp on this server; the audio goes to no other service.</td></tr>
</table>
<p>Every result comes back as <code>structuredContent</code> that matches the tool's declared <code>outputSchema</code>, with the same JSON as text for older clients. Errors come back as tool results with <code>isError: true</code>.</p>

<h2>Sign-in</h2>
<p>OAuth 2.1, with this server as its own authorization server. Only clients the owner lets in get a token.</p>
<ol>
<li>A call to <code>/mcp</code> without a token gets <code>401</code> and a <code>WWW-Authenticate</code> header pointing to the protected resource metadata at <code>${esc(base)}.well-known/oauth-protected-resource/mcp</code>.</li>
<li>That names the authorization server (<code>${esc(base)}.well-known/oauth-authorization-server</code>) and this page as <code>resource_documentation</code>.</li>
<li>The client registers itself (dynamic client registration, <code>/register</code>) and sends its user to <code>/authorize</code> with PKCE (S256) and <code>resource=${esc(mcp)}</code>.</li>
<li>The owner sees a consent page naming the client and approves it with the owner password. Nobody else can approve.</li>
<li>The client exchanges the code at <code>/token</code>. Access tokens last 1 hour; refresh tokens last 30 days and rotate on use. Tokens are bound to <code>${esc(mcp)}</code>. Revoke at <code>/revoke</code>.</li>
</ol>

<h2>Data it keeps</h2>
<ul>
<li><strong>Notes</strong> from <code>memo_write</code>: text, id and time written. Kept until the owner deletes them.</li>
<li><strong>Uploaded files</strong> and their name, type, size and time. Public to anyone who has the link. Kept until the owner deletes them.</li>
<li><strong>OAuth records</strong>: registered clients (name, redirect URIs), and hashes of codes and tokens — never the tokens themselves.</li>
<li><strong>Audio sent to <code>transcribe</code></strong> is held only while it is transcribed, then deleted. The text is returned, not stored.</li>
<li>Request logs (time, path, status) as kept by the hosting platform. No tracking, no cookies.</li>
</ul>
<p>Everything sits in one private Google Cloud Storage bucket owned by the server's owner; uploaded files are served only through this server.</p>
<p class="small">Source: the server's repository. Contact: the owner of this server.</p>`);
}
