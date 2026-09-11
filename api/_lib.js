// ProxyGoaL shared serverless utilities.
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

export const SOURCES = [
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt'
];

export function normalizeProxy(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

export function parseLine(line) {
  const value = String(line || '').trim();
  if (!value || value.startsWith('#')) return null;
  const match = value.match(/^(?:https?:\/\/)?((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})$/i);
  if (!match) return null;
  const octets = match[1].split('.').map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return null;
  return `${match[1]}:${match[2]}`;
}

export async function fetchSource(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ProxyGoaL/2.2' },
      redirect: 'follow'
    });
    if (!response.ok) return [];
    const text = await response.text();
    const values = new Set();
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseLine(line);
      if (parsed) values.add(parsed);
    }
    return [...values];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function proxyAgent(proxyUrl, targetUrl) {
  return targetUrl.startsWith('https:')
    ? new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false })
    : new HttpProxyAgent(proxyUrl);
}

export async function requestJsonThroughProxy(proxyUrl, timeoutMs = 3500) {
  const target = 'http://ipinfo.io/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(target, {
      agent: proxyAgent(proxyUrl, target),
      signal: controller.signal,
      headers: { 'User-Agent': 'ProxyGoaL/2.2', Accept: 'application/json' },
      redirect: 'follow'
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(data.ip)) return null;
    return { data, latency: Date.now() - started };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestDirect(timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://ipinfo.io/json', {
      signal: controller.signal,
      headers: { 'User-Agent': 'ProxyGoaL/2.2', Accept: 'application/json' },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`ipinfo HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function runPool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        const result = await worker(item);
        if (result) results.push(result);
      } catch { /* ignore dead public proxies */ }
    }
  });
  await Promise.all(workers);
  return results;
}

export const pool = {
  working: [],
  candidates: [],
  seen: new Set(),
  sourceTs: 0,
  building: false,
  stats: { sources: 0, candidates: 0, tested: 0, working: 0 }
};

export async function loadCandidates(force = false) {
  const fresh = !force && pool.candidates.length && Date.now() - pool.sourceTs < 5 * 60 * 1000;
  if (fresh) return pool.candidates;
  const results = await Promise.all(SOURCES.map((source) => fetchSource(source)));
  const unique = [...new Set(results.flat())];
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  pool.candidates = unique;
  pool.sourceTs = Date.now();
  pool.stats.sources = results.filter((list) => list.length > 0).length;
  pool.stats.candidates = unique.length;
  return unique;
}

export function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(status).send(JSON.stringify(payload));
}

export function jerr(res, status, error, extra = {}) {
  json(res, status, { ok: false, error, ts: Date.now(), ...extra });
}
