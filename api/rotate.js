// api/rotate.js — one rotation via random proxy from pool
// Author: Humayun Shariar Himu
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { pool, normalizeProxy, json, jerr } from './_lib.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

const TIMEOUT_MS = 8000;

async function fetchThroughProxy(proxyUrl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const opts = {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'ProxyGoaL/2.1 (+https://github.com/humayunshariarhimu)',
        Accept: 'application/json'
      },
      redirect: 'follow'
    };
    if (proxyUrl) {
      opts.agent = new HttpsProxyAgent(proxyUrl, {
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS
      });
    }
    const r = await fetch('https://ipinfo.io/json', opts);
    if (!r.ok) throw new Error('ipinfo HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const mode = ['direct', 'free', 'auto'].includes(req.query?.mode) ? req.query.mode : 'auto';

    let proxyUrl = null;
    let proxyLabel = 'direct';

    if (mode !== 'direct') {
      // Priority: ROTATING_PROXY_URL > user PROXY_LIST > pool
      const endpoint = (process.env.ROTATING_PROXY_URL || '').trim();
      if (endpoint && mode !== 'free') {
        proxyUrl = normalizeProxy(endpoint);
        proxyLabel = 'endpoint';
      } else {
        // user pool
        const userPool = (process.env.PROXY_LIST || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        const combined = [...userPool.map((u) => ({ proxy: normalizeProxy(u), user: true })),
                          ...pool.working.map((p) => ({ proxy: p.proxy, user: false }))];
        if (combined.length) {
          const pick = combined[Math.floor(Math.random() * combined.length)];
          proxyUrl = pick.proxy;
          proxyLabel = pick.user ? 'user' : 'pool:' + (pick.proxy.split('//')[1] || '');
        }
      }
    }

    if (mode !== 'direct' && !proxyUrl) {
      return jerr(res, 503, 'proxy pool empty — click REFRESH PROXY POOL', {
        proxy: 'none', poolSize: pool.working.length, latency: Date.now() - t0
      });
    }

    const data = await fetchThroughProxy(proxyUrl);
    const [lat = '', lon = ''] = (data.loc || ',').split(',');

    return json(res, 200, {
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
      proxy: proxyLabel,
      latency: Date.now() - t0,
      poolSize: pool.working.length,
      ts: Date.now()
    });
  } catch (err) {
    return jerr(res, 502, err?.message || 'proxy request failed', {
      proxy: 'auto', latency: Date.now() - t0,
      poolSize: pool.working.length
    });
  }
}
