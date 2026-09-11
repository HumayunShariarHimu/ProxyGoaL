// ProxyGoaL pool endpoint. The frontend calls /api/pool; keep the filename aligned.
import { loadCandidates, pool, requestJsonThroughProxy, runPool, normalizeProxy, json, jerr } from '../lib/proxy.js';

const BATCH_SIZE = 12;

export default async function handler(req, res) {
  try {
    if (req.query?.force === '1') {
      pool.working = [];
      pool.candidates = [];
      pool.seen.clear();
      pool.sourceTs = 0;
      pool.stats = { sources: 0, candidates: 0, tested: 0, working: 0 };
    }
    if (pool.building) return json(res, 200, { ok: true, building: true, count: pool.working.length, proxies: pool.working });

    pool.building = true;
    const candidates = await loadCandidates(false);
    const fresh = candidates.filter((candidate) => !pool.seen.has(candidate)).slice(0, BATCH_SIZE);
    fresh.forEach((candidate) => pool.seen.add(candidate));
    const working = await runPool(fresh, BATCH_SIZE, async (hostPort) => {
      const proxy = normalizeProxy(hostPort);
      const result = await requestJsonThroughProxy(proxy, 2800);
      return result ? { proxy, latency: result.latency } : null;
    });
    pool.working.push(...working);
    pool.working.sort((a, b) => a.latency - b.latency);
    if (pool.working.length > 100) pool.working.length = 100;
    pool.stats.tested += fresh.length;
    pool.stats.working = pool.working.length;
    pool.building = false;
    return json(res, 200, {
      ok: true,
      building: false,
      batchTested: fresh.length,
      batchWorking: working.length,
      remaining: Math.max(0, candidates.length - pool.seen.size),
      done: fresh.length === 0,
      count: pool.working.length,
      stats: pool.stats,
      proxies: pool.working
    });
  } catch (error) {
    pool.building = false;
    return jerr(res, 500, error?.message || 'pool error');
  }
}
