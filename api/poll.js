// api/pool.js — Multi-source free proxy collector + validator
// Author: Humayun Shariar Himu
import { ProxyAgent } from 'undici';

// ─────────────────────────────────────────────
//  SOURCES: multiple free proxy list endpoints
//  Each returns plain text lines of "ip:port"
// ─────────────────────────────────────────────
const SOURCES = [
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/scraped_proxies/http.txt',
  'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt',
  'https://raw.githubusercontent.com/theriturajps/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
  'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt'
];

const TEST_URL = 'http://ipinfo.io/ip';
const TEST_TIMEOUT = 4000;
const TEST_CONCURRENCY = 80;
const POOL_TTL = 4 * 60 * 1000; // 4 minutes
const MAX_POOL_SIZE = 250;

// ─────────────────────────────────────────────
//  In-memory pool (survives warm invocations)
// ─────────────────────────────────────────────
let pool = {
  working: [],   // [{ proxy: 'http://ip:port', exitIp, latency, testedAt }]
  ts: 0,
  refreshing: false,
  stats: { sources: 0, candidates: 0, tested: 0, working: 0 }
};

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function parseProxyLine(line) {
  const s = line.trim();
  if (!s || s.startsWith('#')) return null;
  // Accept "ip:port" or full URL
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/^https?:\/\/([^:]+):(\d+)$/);
    if (!m) return null;
    return { host: m[1], port: m[2] };
  }
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/);
  if (!m) return null;
  return { host: m[1], port: m[2] };
}

async function fetchSource(url) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: { 'User-Agent': 'ProxyGoaL/2.0' }
    });
    if (!r.ok) return [];
    const text = await r.text();
    const lines = text.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const p = parseProxyLine(line);
      if (p) out.push(p.host + ':' + p.port);
    }
    return out;
  } catch {
    return [];
  }
}

async function testProxy(hostPort) {
  const uri = 'http://' + hostPort;
  let dispatcher;
  try {
    dispatcher = new ProxyAgent({
      uri,
      requestTls: { rejectUnauthorized: false },
      connect: { timeout: TEST_TIMEOUT }
    });
  } catch {
    return null;
  }
  const t0 = Date.now();
  try {
    const r = await fetch(TEST_URL, {
      dispatcher,
      signal: AbortSignal.timeout(TEST_TIMEOUT),
      headers: { 'User-Agent': 'ProxyGoaL/2.0', Accept: 'text/plain' }
    });
    if (!r.ok) return null;
    const exitIp = (await r.text()).trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(exitIp)) return null;
    return {
      proxy: uri,
      hostPort,
      exitIp,
      latency: Date.now() - t0,
      testedAt: Date.now()
    };
  } catch {
    return null;
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let idx = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      const item = items[myIdx];
      try {
        const res = await worker(item);
        if (res) results.push(res);
      } catch { /* skip */ }
    }
  });
  await Promise.all(runners);
  return results;
}

async function buildPool() {
  pool.refreshing = true;
  try {
    // 1. Fetch from all sources in parallel
    const sourceResults = await Promise.allSettled(SOURCES.map(fetchSource));
    const allCandidates = new Set();
    let sourcesOk = 0;
    for (const r of sourceResults) {
      if (r.status === 'fulfilled' && r.value.length) {
        sourcesOk++;
        r.value.forEach((p) => allCandidates.add(p));
      }
    }
    const candidates = Array.from(allCandidates);

    // 2. Add user-provided PROXY_LIST (highest priority)
    const userPool = (process.env.PROXY_LIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // 3. Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // 4. Limit test batch to keep it fast
    const toTest = candidates.slice(0, 220);

    // 5. Test in parallel
    const working = await runWithConcurrency(toTest, TEST_CONCURRENCY, testProxy);

    // 6. Always include user-provided proxies at the top (skip testing)
    for (const u of userPool) {
      working.unshift({
        proxy: /^https?:\/\//i.test(u) ? u : 'http://' + u,
        hostPort: u.replace(/^https?:\/\//i, ''),
        exitIp: null,
        latency: 0,
        testedAt: Date.now(),
        userProvided: true
      });
    }

    // 7. Sort by latency (fastest first)
    working.sort((a, b) => (a.latency || 9999) - (b.latency || 9999));

    pool.working = working.slice(0, MAX_POOL_SIZE);
    pool.ts = Date.now();
    pool.stats = {
      sources: sourcesOk,
      candidates: candidates.length,
      tested: toTest.length,
      working: pool.working.length,
      userProvided: userPool.length
    };
  } finally {
    pool.refreshing = false;
  }
}

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────
export async function ensurePool(force = false) {
  const stale = Date.now() - pool.ts > POOL_TTL;
  if (force || (stale && !pool.refreshing)) {
    await buildPool();
  }
  return pool;
}

export function getPool() {
  return pool;
}

export function pickRandom() {
  if (!pool.working.length) return null;
  return pool.working[Math.floor(Math.random() * pool.working.length)];
}

// ─────────────────────────────────────────────
//  Vercel handler — GET /api/pool
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const force = req.query?.force === '1';
  const doRefresh = force || Date.now() - pool.ts > POOL_TTL;

  if (doRefresh) {
    await ensurePool(true);
  }

  res.status(200).json({
    ok: true,
    count: pool.working.length,
    ts: pool.ts,
    age: Date.now() - pool.ts,
    refreshing: pool.refreshing,
    stats: pool.stats,
    preview: pool.working.slice(0, 5).map((p) => ({
      proxy: p.proxy,
      exitIp: p.exitIp,
      latency: p.latency,
      userProvided: !!p.userProvided
    }))
  });
}
