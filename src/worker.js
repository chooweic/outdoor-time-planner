import { getAir } from '../public/js/air.js';

// Cloudflare Cache API adapter. Entries are kept 24 h so a stale copy exists when upstream is down.
function edgeCache() {
  const cache = caches.default;
  const url = (k) => `https://cache.internal/${k}`;
  return {
    async get(key) {
      const res = await cache.match(url(key));
      return res ? res.json() : undefined;
    },
    async put(key, value) {
      await cache.put(
        url(key),
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' },
        }),
      );
    },
  };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/air' && request.method === 'GET') {
      try {
        // env.DATAGOV_API_KEY is a Worker secret; it never reaches the browser.
        const data = await getAir({
          fetchFn: fetch,
          apiKey: env.DATAGOV_API_KEY,
          cache: edgeCache(),
          dedupe: false,
        });
        return json(data);
      } catch {
        return json({ error: 'Air data unavailable and nothing cached yet' }, 503);
      }
    }
    // Static page (step 4+) is served from ./public via the assets binding.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ error: 'not found' }, 404);
  },
};
