# schema-first

A personal remote MCP server: one home for my tools, reachable by any MCP client I let in.

| Tool | Input | Result |
|---|---|---|
| `memo_write` | `{ text }` | `{ id }` |
| `memo_search` | `{ query, limit? }` | `{ notes: [{ id, text, created_at }] }` |
| `upload` | `{ filename, content_base64 \| text \| url, content_type? }` | `{ url, id, size, content_type }` |
| `transcribe` | `{ url }` | `{ segments: [{ start, end, text }], duration, language }` (seconds) |

Every result is `structuredContent` matching the tool's `outputSchema`.

- MCP revision 2025-11-25 over Streamable HTTP (stateless POST), via the official TypeScript SDK.
- OAuth 2.1 authorization server built in: dynamic client registration, PKCE, refresh tokens,
  protected resource metadata whose `resource_documentation` is the `/plan` page. The owner
  approves each client on a consent page with the owner password.
- Speech to text with whisper.cpp inside the container: no outside API, no key.
- Data in a private Cloud Storage bucket; uploaded files are served at `/files/<id>/<name>`.

## Deploy (Google Cloud Run)

```bash
gcloud config configurations activate personal   # account + project to deploy into
./deploy.sh
```

It enables the APIs, creates the bucket, the owner password secret and a service account, and
deploys. It prints the server URL and, the first time, the owner password.

## Connect a client

Add `https://<host>/mcp` as a remote MCP server (Streamable HTTP, OAuth). The client opens the
consent page; enter the owner password and approve. For a headless client:

```bash
node scripts/client.mjs connect https://<host>
node scripts/client.mjs call memo_search '{"query":""}'
```

## Run locally

```bash
npm install
OWNER_PASSWORD=dev npm start   # http://localhost:8080, data in ./data
npm test
```

`transcribe` needs `ffmpeg` and `whisper-cli` on the PATH (or `WHISPER_BIN`, `WHISPER_MODEL`).
