// ProxyGoaL rotation endpoint.
import { pool, normalizeProxy, requestDirect, requestJsonThroughProxy, loadCandidates, json, jerr } from '../lib/proxy.js';

function output(data, proxy, latency, poolSize) {
  const [lat = '', lon = ''] = String(data.loc || ',').split(',');
  return {
    ok: true,
    ip: data.ip || '0.0.0.0',
    country: data.country || '',
    city: data.city || '',
    region: data.region || '',
    isp: data.org || '',
    org: data.org || '',
    asn: data.org || '',
    timezone: data.timezone || '',
    lat, lon,
    proxy,
    latency,
    poolSize,
    ts: Date.now()
  };
}

export default async function handler(req, res) {
  const started = Date.now();
  const mode = ['direct', 'free', 'auto'].includes(req.query?.mode) ? req.query.mode : 'auto';
  try {
    if (mode === 'direct') {
      const data = await requestDirect();
      return json(res, 200, output(data, 'direct', Date.now() - started, pool.working.length));
    }

    const endpoint = mode !== 'free' ? normalizeProxy(process.env.ROTATING_PROXY_URL) : null;
    const configured = mode !== 'free'
      ? (process.env.PROXY_LIST || '').split(',').map(normalizeProxy).filter(Boolean)
      : [];

    if (endpoint) {
      const result = await requestJsonThroughProxy(endpoint, 7000);
      if (result) return json(res, 200, output(result.data, 'endpoint', Date.now() - started, pool.working.length));
    }

    const choices = [...configured, ...pool.working.map((item) => item.proxy).filter(Boolean)];
    if (choices.length === 0) {
      const candidates = await loadCandidates(false);
      const fresh = candidates.filter((candidate) => !pool.seen.has(candidate)).slice(0, 8);
      fresh.forEach((candidate) => pool.seen.add(candidate));
      const working = await Promise.all(fresh.map(async (hostPort) => {
        const proxy = normalizeProxy(hostPort);
        const result = await requestJsonThroughProxy(proxy, 3000);
        return result ? { proxy, latency: result.latency } : null;
      }));
      working.filter(Boolean).forEach((item) => pool.working.push(item));
      pool.working = pool.working.slice(-100);
      pool.stats.tested += fresh.length;
      pool.stats.working = pool.working.length;
    }

    const available = [...configured, ...pool.working.map((item) => item.proxy).filter(Boolean)];
    for (const proxy of available.sort(() => Math.random() - 0.5).slice(0, 6)) {
      const result = await requestJsonThroughProxy(proxy, 3500);
      if (result) return json(res, 200, output(result.data, proxy, Date.now() - started, pool.working.length));
      pool.working = pool.working.filter((item) => item.proxy !== proxy);
    }

    return jerr(res, 503, 'No working proxy found. Refresh the pool and try again.', {
      proxy: 'none', poolSize: pool.working.length, latency: Date.now() - started
    });
  } catch (error) {
    return jerr(res, 502, error?.message || 'proxy request failed', {
      proxy: 'auto', poolSize: pool.working.length, latency: Date.now() - started
    });
  }
}
