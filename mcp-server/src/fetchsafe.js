// Downloads a public http(s) URL with a size cap. Refuses private, loopback, link-local and
// metadata addresses (checked on the address actually connected to), so a tool caller cannot
// make this server read its own cloud metadata or internal services.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) blocked.addSubnet(a, p, 'ipv6');

export function isBlockedAddress(addr) {
  if (addr === '::') return true;
  const family = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
  if (family === 'ipv6' && addr.toLowerCase().startsWith('::ffff:')) {
    const v4 = addr.slice(7);
    if (net.isIPv4(v4)) return blocked.check(v4, 'ipv4');
  }
  return blocked.check(addr, family);
}

function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => !isBlockedAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error(`Address of ${hostname} is not public`), { code: 'EBLOCKED' }));
    if (options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

export async function fetchPublic(url, { maxBytes = 50 * 1024 * 1024, redirects = 5, timeoutMs = 60_000 } = {}) {
  let u = new URL(url);
  for (let hop = 0; hop <= redirects; hop++) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs are allowed');
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That address is not public');
    const res = await new Promise((resolve, reject) => {
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(u, { lookup: safeLookup, timeout: timeoutMs, headers: { 'user-agent': 'mcp-schema-first/1.0' } }, resolve);
      req.on('timeout', () => req.destroy(new Error('Download timed out')));
      req.on('error', reject);
    });
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      u = new URL(res.headers.location, u);
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); throw new Error(`Download failed: HTTP ${res.statusCode}`); }
    const chunks = []; let size = 0;
    for await (const c of res) {
      size += c.length;
      if (size > maxBytes) { res.destroy(); throw new Error(`File is larger than ${maxBytes} bytes`); }
      chunks.push(c);
    }
    return { data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'application/octet-stream', finalUrl: u.href };
  }
  throw new Error('Too many redirects');
}
