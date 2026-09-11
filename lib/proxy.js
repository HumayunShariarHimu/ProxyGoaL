// ProxyGoaL shared serverless utilities.
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';

export const SOURCES = [
  'https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/https.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/protocol/http/http.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/protocol/https/https.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/protocol/socks5/socks5.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/protocol/socks4/socks4.txt',
  'https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/socks5.txt',
  'https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/socks4.txt',
  'https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/elite.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/anonymity/elite/http/http.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/anonymity/elite/https/https.txt',
  'https://raw.githubusercontent.com/relayglass/free-proxy-list/main/anonymity/elite/socks5/socks5.txt',
  'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.json',
  'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/https/data.json',
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt'
];

export function normalizeProxy(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return /^(?:https?|socks4|socks5):\/\//i.test(raw) ? raw : `http://${raw}`;
}

export function parseLine(line) {
  const value = String(line || '').trim();
  if (!value || value.startsWith('#')) return null;
  const match = value.match(/^(?:(https?|socks4|socks5):\/\/)?((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})$/i);
  if (!match) return null;
  const octets = match[1].split('.').map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return null;
  return `${match[1] ? `${match[1].toLowerCase()}://` : ''}${match[2]}:${match[3]}`;
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
    if (url.endsWith('.json')) {
      try {
        const rows = JSON.parse(text);
        return rows.map((row) => parseLine(`${row.protocol || 'http'}://${row.ip}:${row.port}`)).filter(Boolean);
      } catch { return []; }
    }
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
  const agent = /^socks/i.test(proxyUrl)
    ? new SocksProxyAgent(proxyUrl)
    : targetUrl.startsWith('https:')
    ? new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false })
    : new HttpProxyAgent(proxyUrl);
  agent.on('error', () => {});
  return agent;
}

export async function requestJsonThroughProxy(proxyUrl, timeoutMs = 3500) {
  const targets = [
    'https://api.ipify.org?format=json',
    'https://ipinfo.io/json'
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    for (const target of targets) {
      try {
        const response = await fetch(target, {
          agent: proxyAgent(proxyUrl, target),
          signal: controller.signal,
          headers: { 'User-Agent': 'ProxyGoaL/2.3', Accept: 'application/json' },
          redirect: 'follow'
        });
        if (!response.ok) continue;
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const body = await response.text();
        if (!contentType.includes('json') && !body.trim().startsWith('{')) continue;
        let data;
        try { data = JSON.parse(body); } catch { continue; }
        const ip = data?.ip || data?.origin;
        if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) continue;
        return { data: { ...data, ip }, latency: Date.now() - started };
      } catch { /* try the next IP service */ }
    }
    return null;
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
