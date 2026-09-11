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
    const previous = String(req.query?.previous || '').trim();
    const previousIp = String(req.query?.previousIp || '').trim();
    const excludedIps = new Set(String(req.query?.excludeIps || '').split(',').map((ip) => ip.trim()).filter(Boolean));
    const configured = mode !== 'free'
      ? (process.env.PROXY_LIST || '').split(',').map(normalizeProxy).filter(Boolean)
      : [];

    if (endpoint) {
      const result = await requestJsonThroughProxy(endpoint, 7000);
      if (result) return json(res, 200, output(result.data, 'endpoint', Date.now() - started, pool.working.length));
    }

    let choices = [...configured, ...pool.working.map((item) => item.proxy).filter(Boolean)];
    const discoverMore = async (limit = 80) => {
      const candidates = await loadCandidates(false);
      const fresh = candidates.filter((candidate) => !pool.seen.has(candidate)).slice(0, limit);
      fresh.forEach((candidate) => pool.seen.add(candidate));
      const working = await Promise.all(fresh.map(async (hostPort) => {
        const proxy = normalizeProxy(hostPort);
        const result = await requestJsonThroughProxy(proxy, 3000);
        return result ? { proxy, ip: result.data.ip, latency: result.latency } : null;
      }));
      const knownIps = new Set(pool.working.map((item) => item.ip).filter(Boolean));
      working.filter(Boolean).forEach((item) => {
        if (!knownIps.has(item.ip)) {
          knownIps.add(item.ip);
          pool.working.push(item);
        }
      });
      pool.working = pool.working.slice(-100);
      pool.stats.tested += fresh.length;
      pool.stats.working = pool.working.length;
    };

    choices = choices.filter((proxy, index, list) => list.indexOf(proxy) === index && proxy !== previous);
    if (choices.length < 4) {
      await discoverMore(80);
      choices = [...configured, ...pool.working.map((item) => item.proxy).filter(Boolean)]
        .filter((proxy, index, list) => list.indexOf(proxy) === index && proxy !== previous);
    }

    const knownAvailable = pool.working
      .filter((item) => item.ip && !excludedIps.has(item.ip) && item.proxy !== previous)
      .map((item) => item.proxy);
    const available = [...new Set(knownAvailable.length >= 2 ? knownAvailable : choices)];
    for (const proxy of available.sort(() => Math.random() - 0.5).slice(0, 6)) {
      const result = await requestJsonThroughProxy(proxy, 3500);
      if (result && result.data.ip !== previousIp && !excludedIps.has(result.data.ip)) {
        pool.working = pool.working.map((item) => item.proxy === proxy ? { ...item, ip: result.data.ip, latency: result.latency } : item);
        return json(res, 200, output(result.data, proxy, Date.now() - started, pool.working.length));
      }
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
