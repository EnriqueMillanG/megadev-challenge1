export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg:#1b1b1f; --bg:#fafaf7; --muted:#5d5d66; --line:#d9d9d2; --accent:#2f5bd3; }
  @media (prefers-color-scheme: dark) { :root { --fg:#ececf1; --bg:#16161a; --muted:#a0a0aa; --line:#33333b; --accent:#8aa8ff; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 1rem; } h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
  code, pre { font: 14px/1.45 ui-monospace, monospace; } pre { overflow-x: auto; padding: .75rem; border: 1px solid var(--line); border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; } td, th { text-align: left; vertical-align: top; padding: .4rem .5rem; border-bottom: 1px solid var(--line); }
  input[type=password] { font: inherit; padding: .4rem .5rem; width: 100%; max-width: 20rem; margin-top: .25rem; }
  button { font: inherit; padding: .45rem 1rem; cursor: pointer; }
  a { color: var(--accent); } .small { color: var(--muted); font-size: .9rem; }
</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
