// Local stand-in for the Worker (workerd is blocked on this machine). Serves ./public and /api/air
// using the same getAir() code. Usage: node dev-server.js [port]   (set DATAGOV_API_KEY if you have one)
// Test hooks: env FAIL=1 makes the upstream fail; env SCENARIO=haze serves fake high readings for north.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAir } from './public/js/air.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const mem = new Map();
const cache = { get: async (k) => mem.get(k), put: async (k, v) => void mem.set(k, v) };
let upstreamCalls = 0;

const countingFetch = (fail) => async (...a) => {
  upstreamCalls++;
  if (fail) return new Response('{}', { status: 503 });
  return fetch(...a);
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/air') {
    try {
      const data = await getAir({ fetchFn: countingFetch(process.env.FAIL), apiKey: process.env.DATAGOV_API_KEY, cache });
      if (process.env.SCENARIO === 'haze') {
        data.regions.north.pm25OneHour = 180; data.regions.north.psi24Hour = 120;
        data.regions.east.pm25OneHour = 40;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data));
    } catch {
      res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"unavailable"}');
    }
    return;
  }
  if (url.pathname === '/_stats') return void res.end(String(upstreamCalls));
  const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(Number(process.argv[2]) || 8788, '127.0.0.1', () => console.log('dev server up'));
