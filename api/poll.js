// api/pool.js — batch proxy collector (25 per call → fits in Vercel 10s limit)
// Author: Humayun Shariar Himu
import {
  SOURCES, fetchSource, testProxy, runPool, pool, json, jerr
} from './_lib.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

const BATCH_SIZE = 25;
const SOURCE_CACHE_TTL = 5 * 60 * 1000;

let sourceCache = { list: [], ts: 0 };

async function loadCandidates() {
  if (Date.now() - sourceCache.ts < SOURCE_CACHE_TTL && sourceCache.list.length) {
    return sourceCache.list;
  }
  const results = await Promise.allSettled(SOURCES.map((s) => fetchSource(s)));
  const set = new Set();
  let sourcesOk = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) {
      sourcesOk++;
      r.value.forEach((p) => set.add(p));
    }
  }
  const arr = Array.from(set);
  // shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  sourceCache = { list: arr, ts: Date.now(), sourcesOk };
  pool.stats.sources = sourcesOk;
  pool.stats.candidates = arr.length;
  return arr;
}

export default async function handler(req, res) {
  try {
    const force = req.query?.force === '1';
    if (force) { pool.working = []; pool.seen.clear(); sourceCache.ts = 0; }

    if (pool.building) {
      return json(res, 200, {
        ok: true, building: true,
        count: pool.working.length, proxies: pool.working
      });
    }

    pool.building = true;
    try {
      const candidates = await loadCandidates();
      const untested = candidates.filter((p) => !pool.seen.has(p));
      const batch = untested.slice(0, BATCH_SIZE);

      if (batch.length === 0) {
        return json(res, 200, {
          ok: true, done: true, building: false,
          count: pool.working.length, tested: 0,
          stats: pool.stats, proxies: pool.working
        });
      }

      const t0 = Date.now();
      const working = await runPool(batch, 25, (hp) => testProxy(hp, 3500));

      batch.forEach((p) => pool.seen.add(p));
      working.forEach((w) => pool.working.push(w));
      pool.working.sort((a, b) => (a.latency || 9999) - (b.latency || 9999));
      if (pool.working.length > 300) pool.working.length = 300;
      pool.ts = Date.now();
      pool.stats.tested += batch.length;
      pool.stats.working = pool.working.length;

      return json(res, 200, {
        ok: true, building: false,
        batchTested: batch.length,
        batchWorking: working.length,
        remaining: untested.length - batch.length,
        count: pool.working.length,
        elapsed: Date.now() - t0,
        stats: pool.stats,
        proxies: pool.working
      });
    } finally {
      pool.building = false;
    }
  } catch (err) {
    return jerr(res, 500, err?.message || 'pool error');
  }
}
