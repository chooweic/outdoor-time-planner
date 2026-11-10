// Fetches NEA air data from data.gov.sg and caches it. No browser or Cloudflare APIs in here, so it
// runs in the page, in the optional Worker, and in plain Node tests.

const BASE = 'https://api-open.data.gov.sg/v2/real-time/api';
export const TTL_MS = 15 * 60 * 1000; // upstream data updates hourly; 15 min keeps us far below rate limits
export const MAX_STALE_MS = 6 * 60 * 60 * 1000; // never serve a cached copy older than this
export const REGION = 'north'; // NEA lists Punggol under the north region
const KEY = 'air-v2';
const TIMEOUT_MS = 8000;

const inflight = new Map(); // key -> Promise, so simultaneous requests share one refresh

async function getJson(fetchFn, path, apiKey) {
  const headers = apiKey ? { 'x-api-key': apiKey } : {};
  // AbortSignal.timeout is missing in older browsers (Safari < 16, Chrome < 103): fall back to a manual abort.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let body;
  try {
    // The timer covers the response body too: a connection that stalls after the headers must not hang us.
    const res = await fetchFn(`${BASE}/${path}`, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`upstream ${path} -> HTTP ${res.status}`);
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (body.code !== 0) throw new Error(`upstream ${path} -> code ${body.code}`);
  return body.data;
}

// Pull only the fields the app needs: every region, plus the home region at the top level.
export function shape(pm25, psi, forecast, region = REGION) {
  const pmItem = pm25.items[0];
  const psiItem = psi.items[0];
  const rec = forecast.records[0];
  const regions = {};
  for (const r of Object.keys(pmItem.readings.pm25_one_hourly)) {
    regions[r] = {
      pm25OneHour: pmItem.readings.pm25_one_hourly[r],
      psi24Hour: psiItem.readings.psi_twenty_four_hourly[r],
      forecast: rec.periods.map((p) => ({ period: p.timePeriod.text, text: p.regions[r].text })),
    };
  }
  return {
    region,
    regions,
    pm25OneHour: pmItem.readings.pm25_one_hourly[region],
    pm25Timestamp: pmItem.timestamp,
    psi24Hour: psiItem.readings.psi_twenty_four_hourly[region],
    psiTimestamp: psiItem.timestamp,
    forecast: rec.periods.map((p) => ({
      period: p.timePeriod.text,
      start: p.timePeriod.start,
      end: p.timePeriod.end,
      text: p.regions[region].text,
    })),
    forecastTimestamp: rec.timestamp,
  };
}

async function refresh({ fetchFn, apiKey }) {
  // Sequential on purpose: 3 calls stay inside the no-key limit (6 per 10 s) even on a cold start.
  const pm25 = await getJson(fetchFn, 'pm25', apiKey);
  const psi = await getJson(fetchFn, 'psi', apiKey);
  const forecast = await getJson(fetchFn, 'twenty-four-hr-forecast', apiKey);
  return shape(pm25, psi, forecast);
}

// A cached entry is only trusted if it has the shape this version expects.
function validEntry(e) {
  return !!e && Number.isFinite(e.fetchedAt) && !!e.data?.regions?.[REGION] &&
    typeof e.data.pm25Timestamp === 'string' && typeof e.data.psiTimestamp === 'string' && Array.isArray(e.data.regions[REGION].forecast);
}

/**
 * cache: { get(key) -> {data, fetchedAt} | undefined, put(key, value) }
 * Returns { ...data, fetchedAt, stale }. stale=true means upstream failed and an older copy is served.
 * Throws when upstream fails and there is no usable cached copy (none, invalid, or older than MAX_STALE_MS).
 * dedupe=false disables sharing one in-flight refresh (needed in Workers, which forbid sharing I/O across requests).
 */
export async function getAir({ fetchFn, apiKey, cache, now = Date.now(), dedupe = true }) {
  let cached;
  try { cached = await cache.get(KEY); } catch { cached = undefined; }
  if (!validEntry(cached)) cached = undefined;

  const age = cached ? now - cached.fetchedAt : Infinity;
  if (cached && age >= 0 && age < TTL_MS) {
    return { ...cached.data, fetchedAt: cached.fetchedAt, stale: false };
  }

  const run = async () => {
    const data = await refresh({ fetchFn, apiKey });
    const entry = { data, fetchedAt: now };
    try { await cache.put(KEY, entry); } catch { /* a failed cache write must not lose fresh data */ }
    return entry;
  };
  let promise;
  if (dedupe) {
    if (!inflight.has(KEY)) inflight.set(KEY, run().finally(() => inflight.delete(KEY)));
    promise = inflight.get(KEY);
  } else {
    promise = run();
  }
  try {
    const entry = await promise;
    return { ...entry.data, fetchedAt: entry.fetchedAt, stale: false };
  } catch (err) {
    // Serve the old copy only if it is not too old. A future-dated copy (clock skew) counts as unusable.
    if (cached && age >= 0 && age <= MAX_STALE_MS) return { ...cached.data, fetchedAt: cached.fetchedAt, stale: true };
    throw err;
  }
}
