// api/rotate.js — performs one proxy rotation + fetches exit-node IP info
import { ProxyAgent } from 'undici';

const IPINFO_URL = 'https://ipinfo.io/json';
const TIMEOUT_MS = 10000;

let rrCounter = 0; // round-robin cursor for static pool

function parsePool() {
  return (process.env.PROXY_LIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeProxyUrl(url) {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return 'http://' + url;
  return url;
}

function pickProxy(mode) {
  if (mode === 'direct') return { url: null, label: 'direct' };

  const endpoint = (process.env.ROTATING_PROXY_URL || '').trim();
  if (endpoint) {
    return { url: normalizeProxyUrl(endpoint), label: 'rotating-endpoint' };
  }

  const pool = parsePool();
  if (pool.length) {
    const idx = rrCounter % pool.length;
    rrCounter++;
    return { url: normalizeProxyUrl(pool[idx]), label: `pool[${idx}]` };
  }

  return { url: null, label: 'direct' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const mode = req.query?.mode === 'direct' ? 'direct' : 'auto';
  const t0 = Date.now();

  const { url: proxyUrl, label: proxyLabel } = pickProxy(mode);

  let dispatcher;
  if (proxyUrl) {
    try {
      dispatcher = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: false }
      });
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: 'invalid proxy url: ' + e.message,
        proxy: proxyLabel,
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
        'User-Agent': 'ProxyGoaL/1.0 (+https://github.com/)',
        Accept: 'application/json'
      }
    });

    if (!r.ok) throw new Error('ipinfo responded ' + r.status);

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
      lat,
      lon,
      proxy: proxyLabel,
      latency: Date.now() - t0,
      ts: Date.now()
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err?.message || 'proxy request failed',
      proxy: proxyLabel,
      latency: Date.now() - t0,
      ts: Date.now()
    });
  }
}
