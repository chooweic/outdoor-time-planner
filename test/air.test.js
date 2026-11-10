import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getAir, TTL_MS } from '../public/js/air.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url)));
const BODIES = {
  pm25: fx('pm25'),
  psi: fx('psi'),
  'twenty-four-hr-forecast': fx('twenty-four-hr-forecast'),
};

function mockFetch({ fail = false } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (fail) return { ok: false, status: 429, json: async () => ({}) };
    const name = url.split('/real-time/api/')[1];
    return { ok: true, status: 200, json: async () => BODIES[name] };
  };
  fn.calls = calls;
  return fn;
}

function memCache() {
  const m = new Map();
  return { get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v) };
}

test('20 rapid requests make only one upstream refresh (3 calls)', async () => {
  const fetchFn = mockFetch();
  const cache = memCache();
  const t = 1_000_000;
  await Promise.all(Array.from({ length: 20 }, () => getAir({ fetchFn, cache, now: t })));
  for (let i = 0; i < 20; i++) await getAir({ fetchFn, cache, now: t + 1000 });
  assert.equal(fetchFn.calls.length, 3);
});

test('returns the home (north) fields plus a per-region table', async () => {
  const out = await getAir({ fetchFn: mockFetch(), cache: memCache(), now: 5 });
  assert.equal(out.region, 'north');
  assert.deepEqual(Object.keys(out.regions).sort(), ['central', 'east', 'north', 'south', 'west']);
  assert.equal(out.regions.east.pm25OneHour, BODIES.pm25.data.items[0].readings.pm25_one_hourly.east);
  assert.equal(out.regions.north.forecast.length, 3);
  assert.equal(out.pm25OneHour, BODIES.pm25.data.items[0].readings.pm25_one_hourly.north);
  assert.equal(out.psi24Hour, BODIES.psi.data.items[0].readings.psi_twenty_four_hourly.north);
  assert.equal(out.forecast.length, 3);
  assert.equal(out.stale, false);
});

test('refreshes after the TTL expires', async () => {
  const fetchFn = mockFetch();
  const cache = memCache();
  await getAir({ fetchFn, cache, now: 0 });
  await getAir({ fetchFn, cache, now: TTL_MS + 1 });
  assert.equal(fetchFn.calls.length, 6);
});

test('serves the old copy with stale=true when upstream fails', async () => {
  const cache = memCache();
  await getAir({ fetchFn: mockFetch(), cache, now: 0 });
  const out = await getAir({ fetchFn: mockFetch({ fail: true }), cache, now: TTL_MS + 1 });
  assert.equal(out.stale, true);
  assert.equal(out.fetchedAt, 0);
});

test('throws when upstream fails and nothing is cached', async () => {
  await assert.rejects(getAir({ fetchFn: mockFetch({ fail: true }), cache: memCache(), now: 0 }));
});

test('sends the key as x-api-key only when one is set', async () => {
  const withKey = mockFetch();
  await getAir({ fetchFn: withKey, apiKey: 'secret-test', cache: memCache(), now: 0 });
  assert.equal(withKey.calls[0].opts.headers['x-api-key'], 'secret-test');
  const noKey = mockFetch();
  await getAir({ fetchFn: noKey, cache: memCache(), now: 0 });
  assert.deepEqual(noKey.calls[0].opts.headers, {});
});

test('the key never appears in the response body', async () => {
  const out = await getAir({ fetchFn: mockFetch(), apiKey: 'secret-test', cache: memCache(), now: 0 });
  assert.ok(!JSON.stringify(out).includes('secret-test'));
});

// --- fixes from code review ---
test('a cached entry with the wrong shape is ignored, not served', async () => {
  const cache = memCache();
  await cache.put('air-v2', { data: { pm25OneHour: 5 }, fetchedAt: 100 }); // old shape: no regions
  const fetchFn = mockFetch();
  const out = await getAir({ fetchFn, cache, now: 200 });
  assert.equal(fetchFn.calls.length, 3);
  assert.ok(out.regions.north);
});

test('a future-dated cached entry (clock skew) is not treated as fresh', async () => {
  const cache = memCache();
  await getAir({ fetchFn: mockFetch(), cache, now: 10_000_000 });
  const fetchFn = mockFetch();
  await getAir({ fetchFn, cache, now: 1_000 }); // clock now far behind the stored fetchedAt
  assert.equal(fetchFn.calls.length, 3);
});

test('a future-dated entry is not served as stale either', async () => {
  const cache = memCache();
  await getAir({ fetchFn: mockFetch(), cache, now: 10_000_000 });
  await assert.rejects(getAir({ fetchFn: mockFetch({ fail: true }), cache, now: 1_000 }));
});

test('stale fallback has a maximum age (6 h)', async () => {
  const { MAX_STALE_MS } = await import('../public/js/air.js');
  const cache = memCache();
  await getAir({ fetchFn: mockFetch(), cache, now: 0 });
  const ok = await getAir({ fetchFn: mockFetch({ fail: true }), cache, now: MAX_STALE_MS });
  assert.equal(ok.stale, true);
  await assert.rejects(getAir({ fetchFn: mockFetch({ fail: true }), cache, now: MAX_STALE_MS + 1 }));
});

test('a failing cache write does not lose freshly fetched data', async () => {
  const cache = { get: async () => undefined, put: async () => { throw new Error('quota'); } };
  const out = await getAir({ fetchFn: mockFetch(), cache, now: 5 });
  assert.equal(out.stale, false);
  assert.ok(out.regions.north);
});

test('a failing cache read is treated as a miss', async () => {
  const cache = { get: async () => { throw new Error('blocked'); }, put: async () => {} };
  const out = await getAir({ fetchFn: mockFetch(), cache, now: 5 });
  assert.ok(out.regions.north);
});

test('dedupe=false does not share in-flight refreshes', async () => {
  const fetchFn = mockFetch();
  const cache = { get: async () => undefined, put: async () => {} };
  await Promise.all([getAir({ fetchFn, cache, dedupe: false }), getAir({ fetchFn, cache, dedupe: false })]);
  assert.equal(fetchFn.calls.length, 6);
});

test('a response body that stalls after the headers is aborted by the timeout', async () => {
  // fetch resolves, but json() only settles when the abort signal fires
  const fetchFn = async (_url, { signal }) => ({
    ok: true, status: 200,
    json: () => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))),
  });
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 5); // shrink the 8 s timeout for the test
  try {
    await assert.rejects(getAir({ fetchFn, cache: memCache(), now: 0 }), /aborted/);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
