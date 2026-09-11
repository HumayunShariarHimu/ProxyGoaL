// api/info.js — returns current pool / endpoint status to the dashboard
export default function handler(req, res) {
  const pool = (process.env.PROXY_LIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const endpoint = (process.env.ROTATING_PROXY_URL || '').trim();

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    poolSize: pool.length,
    hasEndpoint: !!endpoint,
    mode: endpoint ? 'rotating-endpoint' : pool.length ? 'pool' : 'direct',
    ts: Date.now()
  });
}
