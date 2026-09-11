// api/info.js — pool status
// Author: Humayun Shariar Himu
import { pool, json } from './_lib.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  const endpoint = (process.env.ROTATING_PROXY_URL || '').trim();
  const userPool = (process.env.PROXY_LIST || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  return json(res, 200, {
    ok: true,
    mode: endpoint ? 'rotating-endpoint' : (userPool.length ? 'user-pool' : 'free-pool'),
    hasEndpoint: !!endpoint,
    userPoolSize: userPool.length,
    poolSize: pool.working.length,
    poolAge: pool.ts ? Date.now() - pool.ts : 0,
    poolBuilding: pool.building,
    stats: pool.stats,
    author: 'Humayun Shariar Himu',
    ts: Date.now()
  });
}
