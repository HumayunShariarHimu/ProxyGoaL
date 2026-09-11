// api/info.js — pool status + source info
// Author: Humayun Shariar Himu
import { getPool } from './pool.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const endpoint = (process.env.ROTATING_PROXY_URL || '').trim();
  const userPool = (process.env.PROXY_LIST || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const p = getPool();

  res.status(200).json({
    ok: true,
    mode: endpoint ? 'rotating-endpoint' : 'pool',
    hasEndpoint: !!endpoint,
    userPoolSize: userPool.length,
    poolSize: p.working.length,
    poolAge: p.ts ? Date.now() - p.ts : 0,
    poolRefreshing: p.refreshing,
    stats: p.stats,
    author: 'Humayun Shariar Himu',
    ts: Date.now()
  });
}
