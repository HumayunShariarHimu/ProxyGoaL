# ProxyGoaL

ProxyGoaL is a browser dashboard for checking exit IP information through a rotating set of HTTP proxies. It is designed for **authorized testing, privacy research, and learning**. It does not bypass access controls, and public proxies can be unstable or unsafe.

## What is included

- Multi-source public proxy discovery with deduplication and validation.
- Maintained sources from Proxmint, Relayglass, ProxyScrape, and Proxifly; these publish recently re-validated HTTP, HTTPS, SOCKS4, and SOCKS5 lists or protocol-separated JSON/TXT mirrors.
- Working-proxy health checks before a proxy is used for rotation.
- Automatic retry and dead-proxy removal.
- Direct mode, free public-pool mode, user-managed proxy-list mode, and a configured rotating-endpoint mode.
- Live exit IP, country, city, ISP, timezone, latency, and telemetry display.
- Serverless-compatible API endpoints for Vercel.
- A responsive dashboard with diagnostics, pool refresh, manual rotation, and continuous rotation controls.

## Rotation design

The dashboard uses the validated public HTTP/HTTPS/SOCKS sources above, tests each candidate through an IP echo endpoint, records the real exit IP, and keeps only one proxy per distinct exit IP. It progressively builds the pool in bounded batches and skips the previous proxy and previous exit IP during continuous rotation. The target is a pool of at least 50 distinct verified exit IPs; the UI reports the actual number currently available rather than pretending that a dead or duplicate proxy is a new IP.

Public proxies are volatile. A source can publish hundreds of entries while only a smaller subset is reachable from the current Vercel region. If fewer than 50 distinct exits are currently reachable, the application continues sampling on later refresh/rotation requests and reports a truthful failure when no new exit is available.

## Environment variables

The application runs in free-pool mode without environment variables. For an operator-controlled pool, configure one of the following in the deployment environment:

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

A serverless function is stateless between cold starts, so the pool is a best-effort warm-instance cache. The app never claims that an untested proxy is working or that two proxies provide different exits. For sensitive or guaranteed availability use only proxies you own or are explicitly authorized to use.

## License

MIT

Represented By Humayun Shariar Himu
