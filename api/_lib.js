// api/_lib.js — shared helpers (underscore prefix = NOT a serverless endpoint)
// Author: Humayun Shariar Himu
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

export const SOURCES = [
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt',
  'https://raw.githubusercontent.com/theriturajps/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt'
];

export function normalizeProxy(u) {
  if (!u) return null;
  u = u.trim();
  return /^https?:\/\//i.test(u) ? u : 'http://' + u;
}

export function parseLine(line) {
  const s = (line || '').trim();
  if (!s || s.startsWith('#')) return null;
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/^https?:\/\/([^:]+):(\d+)/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

export async function fetchSource(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ProxyGoaL/2.1' },
      redirect: 'follow'
    });
    if (!r.ok) return [];
    const text = await r.text();
    const out = new Set();
    text.split(/\r?\n/).forEach((l) => {
      const p = parseLine(l);
      if (p) out.add(p);
    });
    return Array.from(out);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function testProxy(hostPort, timeoutMs = 3500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const agent = new HttpsProxyAgent('http://' + hostPort, {
      rejectUnauthorized: false,
      timeout: timeoutMs
    });
    const r = await fetch('http://ipinfo.io/ip', {
      agent,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ProxyGoaL/2.1', Accept: 'text/plain' },
      redirect: 'follow'
    });
    if (!r.ok) return null;
    const ip = (await r.text()).trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
    return { proxy: 'http://' + hostPort, hostPort, exitIp: ip, latency: Date.now() - t0 };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function runPool(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        const r = await worker(items[idx]);
        if (r) results.push(r);
      } catch { /* skip */ }
    }
  });
  await Promise.all(runners);
  return results;
}

// In-memory pool (survives warm invocations)
export const pool = {
  working: [],
  ts: 0,
  building: false,
  seen: new Set(),
  stats: { sources: 0, candidates: 0, tested: 0, working: 0 }
};

export function json(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(status).send(JSON.stringify(obj));
}

export function jerr(res, status, error, extra = {}) {
  json(res, status, { ok: false, error, ts: Date.now(), ...extra });
}
