// api/rotate.js — one rotation via a random proxy from the pool
// Author: Humayun Shariar Himu
import { ProxyAgent } from 'undici';
import { ensurePool, pickRandom, getPool } from './pool.js';

const IPINFO_URL = 'https://ipinfo.io/json';
const TIMEOUT_MS = 9000;

function normalizeProxyUrl(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : 'http://' + url;
}

async function pickProxy(mode) {
  // 1. Rotating endpoint (user's paid service) — highest priority
  const endpoint = (process.env.ROTATING_PROXY_URL || '').trim();
  if (endpoint && mode !== 'free' && mode !== 'direct') {
    return { url: normalizeProxyUrl(endpoint), label: 'rotating-endpoint' };
  }

  // 2. Direct mode — no proxy
  if (mode === 'direct') {
    return { url: null, label: 'direct' };
  }

  // 3. Pool mode (free + user pool) — ensure pool is fresh
  await ensurePool();
  const p = pickRandom();
  if (!p) {
    return { url: null, label: 'pool:EMPTY', empty: true };
  }
  return {
    url: p.proxy,
    label: p.userProvided ? 'user:' + p.hostPort : 'free:' + p.hostPort,
    exitIp: p.exitIp,
    proxyLatency: p.latency
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const mode = ['direct', 'free', 'auto'].includes(req.query?.mode)
    ? req.query.mode
    : 'auto';

  const t0 = Date.now();
  let picked;
  try {
    picked = await pickProxy(mode);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: 'pool build failed: ' + e.message,
      latency: Date.now() - t0,
      ts: Date.now()
    });
  }

  if (picked.empty) {
    // If pool is empty, try to build it once more, then give up
    await ensurePool(true);
    const p2 = pickRandom();
    if (!p2) {
      return res.status(503).json({
        ok: false,
        error: 'proxy pool empty — no working proxies found. Try again in ~20s or add your own PROXY_LIST.',
        proxy: 'pool:EMPTY',
        poolSize: getPool().working.length,
        latency: Date.now() - t0,
        ts: Date.now()
      });
    }
    picked = {
      url: p2.proxy,
      label: p2.userProvided ? 'user:' + p2.hostPort : 'free:' + p2.hostPort,
      exitIp: p2.exitIp,
      proxyLatency: p2.latency
    };
  }

  let dispatcher;
  if (picked.url) {
    try {
      dispatcher = new ProxyAgent({
        uri: picked.url,
        requestTls: { rejectUnauthorized: false },
        connect: { timeout: 6000 }
      });
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: 'invalid proxy: ' + e.message,
        proxy: picked.label,
        latency: Date.now() - t0,
        ts: Date.now()
      });
    }
  }

  try {
    const r = await fetch(IPINFO_URL, {
      dispatcher,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'ProxyGoaL/2.0 (+https://github.com/humayunshariarhimu)',
        Accept: 'application/json'
      }
    });
    if (!r.ok) throw new Error('ipinfo HTTP ' + r.status);

    const data = await r.json();
    const [lat = '', lon = ''] = (data.loc || ',').split(',');

    res.status(200).json({
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
      proxy: picked.label,
      proxyLatency: picked.proxyLatency || 0,
      latency: Date.now() - t0,
      poolSize: getPool().working.length,
      ts: Date.now()
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err?.message || 'proxy request failed',
      proxy: picked.label,
      latency: Date.now() - t0,
      poolSize: getPool().working.length,
      ts: Date.now()
    });
  }
}
