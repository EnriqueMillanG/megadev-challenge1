// Key/value storage for JSON records and file blobs.
// Uses a Google Cloud Storage bucket when BUCKET is set, else a local folder (DATA_DIR, default ./data).
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

function safeKey(key) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error(`bad key: ${key}`);
  return key;
}

class LocalStore {
  constructor(dir) { this.dir = path.resolve(dir); }
  file(key) { return path.join(this.dir, safeKey(key)); }
  async getBytes(key) {
    try {
      const data = await readFile(this.file(key));
      let meta = {};
      try { meta = JSON.parse(await readFile(this.file(key) + '.meta', 'utf8')); } catch {}
      return { data, contentType: meta.contentType };
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async putBytes(key, data, contentType) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
    if (contentType) await writeFile(f + '.meta', JSON.stringify({ contentType }));
  }
  async delete(key) { await rm(this.file(key), { force: true }); await rm(this.file(key) + '.meta', { force: true }); }
}

class GcsStore {
  constructor(bucketName, gcs) { this.bucket = gcs.bucket(bucketName); }
  async getBytes(key) {
    const f = this.bucket.file(safeKey(key));
    try {
      const [data] = await f.download();
      const [meta] = await f.getMetadata();
      return { data, contentType: meta.contentType };
    } catch (e) { if (e.code === 404) return null; throw e; }
  }
  async putBytes(key, data, contentType) {
    await this.bucket.file(safeKey(key)).save(data, { contentType: contentType || 'application/octet-stream', resumable: false });
  }
  async delete(key) {
    try { await this.bucket.file(safeKey(key)).delete(); } catch (e) { if (e.code !== 404) throw e; }
  }
}

export async function createStore() {
  let store;
  if (process.env.BUCKET) {
    const { Storage } = await import('@google-cloud/storage');
    store = new GcsStore(process.env.BUCKET, new Storage());
  } else {
    store = new LocalStore(process.env.DATA_DIR || './data');
  }
  return {
    getBytes: (k) => store.getBytes(k),
    putBytes: (k, d, t) => store.putBytes(k, d, t),
    delete: (k) => store.delete(k),
    async getJson(key, fallback = null) {
      const r = await store.getBytes(key);
      return r ? JSON.parse(r.data.toString('utf8')) : fallback;
    },
    async putJson(key, value) {
      await store.putBytes(key, Buffer.from(JSON.stringify(value)), 'application/json');
    },
  };
}

// Serialises async work per key, so read-modify-write on one record does not race.
const chains = new Map();
export function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(key, next.catch(() => {}));
  return next;
}
