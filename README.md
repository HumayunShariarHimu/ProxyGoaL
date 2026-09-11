# ProxyGoaL

ProxyGoaL is a browser dashboard for checking exit IP information through a rotating set of HTTP proxies. It is designed for **authorized testing, privacy research, and learning**. It does not bypass access controls, and public proxies can be unstable or unsafe.

## What is included

- Multi-source public proxy discovery with deduplication and validation.
- Working-proxy health checks before a proxy is used for rotation.
- Automatic retry and dead-proxy removal.
- Direct mode, free public-pool mode, user-managed proxy-list mode, and a configured rotating-endpoint mode.
- Live exit IP, country, city, ISP, timezone, latency, and telemetry display.
- Serverless-compatible API endpoints for Vercel.
- A responsive dashboard with diagnostics, pool refresh, manual rotation, and continuous rotation controls.

## Environment variables

The application can run in free-pool mode without environment variables, but public proxies are temporary and unreliable. For dependable operation, configure one of the following in the deployment environment:

- `PROXY_LIST`: comma-separated HTTP proxy values such as `http://host:port,host:port`.
- `ROTATING_PROXY_URL`: one authorized rotating proxy endpoint.

Use only proxies that you own or are explicitly authorized to use. Never place credentials or private proxy URLs in client-side code.

## Local development

```bash
npm install
npx vercel dev
```

Open the local URL printed by Vercel. The static dashboard is served from `index.html` and the API routes are under `/api`.

## API routes

| Route | Purpose |
| --- | --- |
| `/api/info` | Current mode, pool size, and source statistics |
| `/api/pool?force=1` | Refresh candidates and test a batch of proxies |
| `/api/rotate?mode=auto` | Return the next working exit IP |
| `/api/rotate?mode=free` | Rotate through the public pool |
| `/api/rotate?mode=direct` | Show the deployment's direct egress IP |
| `/api/diag` | Runtime and environment diagnostics |

## Important deployment note

A serverless function is stateless between cold starts. The application therefore treats the pool as a performance cache and can discover and test candidates during rotation requests. For predictable production rotation, set `PROXY_LIST` or `ROTATING_PROXY_URL`; public free proxies are not a reliable production transport.

## License

MIT

Represented By Humayun Shariar Himu
