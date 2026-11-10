import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Stand-ins for the Workers runtime globals (Request/Response exist in Node).
const store = new Map();
globalThis.caches = {
  default: {
    match: async (u) => (store.has(u) ? new Response(store.get(u)) : undefined),
    put: async (u, res) => void store.set(u, await res.text()),
  },
};
const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url)));
const BODIES = { pm25: fx('pm25'), psi: fx('psi'), 'twenty-four-hr-forecast': fx('twenty-four-hr-forecast') };
let upstream = 0;
globalThis.fetch = async (url) => {
  upstream++;
  return new Response(JSON.stringify(BODIES[url.split('/real-time/api/')[1]]));
};

const { default: worker } = await import('../src/worker.js');
const call = (path, method = 'GET') => worker.fetch(new Request(`https://x.test${path}`, { method }), { DATAGOV_API_KEY: 'k' });

test('GET /api/air returns JSON, no-store, and caches through caches.default', async () => {
  const r1 = await call('/api/air');
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('cache-control'), 'no-store');
  const b1 = await r1.json();
  assert.equal(b1.region, 'north');
  assert.equal(upstream, 3);
  const r2 = await call('/api/air');
  assert.equal((await r2.json()).fetchedAt, b1.fetchedAt);
  assert.equal(upstream, 3); // second request served from the cache
});

test('unknown paths give 404 and POST is not served', async () => {
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/api/air', 'POST')).status, 404);
});
