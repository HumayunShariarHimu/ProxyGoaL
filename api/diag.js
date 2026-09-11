// api/diag.js — diagnostic endpoint
// Visit /api/diag — if this returns HTML, your /api folder isn't deployed.
// Author: Humayun Shariar Himu
export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(JSON.stringify({
    ok: true,
    message: 'ProxyGoaL API is running',
    node: process.version,
    env: {
      hasRotatingProxy: !!process.env.ROTATING_PROXY_URL,
      hasProxyList: !!process.env.PROXY_LIST,
      vercelEnv: process.env.VERCEL_ENV || 'local'
    },
    ts: Date.now(),
    author: 'Humayun Shariar Himu'
  }));
}
