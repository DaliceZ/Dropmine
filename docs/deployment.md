# Deploy Dropmine on Vercel with Upstash Redis

## What runs where

- Frontend: Vercel static hosting (Vite).
- Signaling: Node.js WebSocket Function at `/api/ws`; `/ws` rewrites to it.
- Shared presence/pairing: Upstash Redis over TLS, isolated by environment.
- File bytes: WebRTC DataChannel directly between browsers. No upload endpoint, file storage or TURN relay is added.

Vercel WebSockets are currently Beta. Enable Fluid Compute. The configured function duration is 300 seconds, including on Hobby with Fluid Compute. Clients reconnect automatically, but active transfers/pairings can be interrupted when a connection ends: this version has no session/transfer resume. Test this limit against your intended file sizes and network speeds before launch.

References: [WebSockets](https://vercel.com/docs/functions/websockets), [Function duration](https://vercel.com/docs/functions/configuring-functions/duration), [Vite](https://vercel.com/docs/frameworks/frontend/vite).

## 1. Create a Redis database

Create an Upstash Redis database in your account, or through Vercel Marketplace. Choose the Free plan explicitly if appropriate; creating a database and selecting billing are manual account-owner steps.

Copy the **TCP/TLS connection string** (`rediss://...`), not the REST API URL/token. The application uses Redis commands and Pub/Sub with the Node Redis client.

Do not paste the connection string into chat, source code, a public repository or any `VITE_*` variable. It contains the database password. Store it only in server-side environment variables. Prefer a Redis region near the Vercel Function region.

[Upstash pricing](https://upstash.com/pricing/redis) has separate free and paid plans. Do not assume storage size determines cost: connection activity, presence refreshes, Pub/Sub and commands also consume usage. No plan or spending change is performed by this repository.

## 2. Import the repository into Vercel

| Setting | Value |
| --- | --- |
| Root Directory | Repository root, not `frontend` |
| Framework Preset | Vite |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run vercel-build` |
| Output Directory | `frontend/dist` |
| Node.js | 22.x |
| Fluid Compute | Enabled |

The checked-in `vercel.json` configures the Functions, rewrite, security headers and asset caching. Do not remove the root `api/` directory or configure the backend as a second Vercel project.

## 3. Configure environment variables

Set these in the Vercel project's **Production** environment before deployment:

```dotenv
PUBLIC_ORIGIN=https://your-project.vercel.app
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT:6379
REDIS_NAMESPACE=production
NETWORK_GROUP_SECRET=YOUR_RANDOM_SECRET
TRUST_PROXY_HOPS=1
```

Generate `NETWORK_GROUP_SECRET` locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- `PUBLIC_ORIGIN` must exactly match the canonical frontend origin, with no trailing slash or path. Redirect other domains to it. When switching to a custom domain, update this variable and redeploy.
- All instances in one environment must share the same `REDIS_NAMESPACE` and `NETWORK_GROUP_SECRET`. The secret hashes network addresses consistently across instances; never expose it to browsers.
- Namespaces allow letters, digits, hyphens and underscores. Change the namespace when deploying incompatible protocol/state changes.
- `TRUST_PROXY_HOPS=1` uses the Vercel-managed forwarded address. Outside Vercel, only enable this behind a verified trusted proxy that sanitizes headers and cannot be bypassed. See [Vercel request headers](https://vercel.com/docs/headers/request-headers).
- Leave `VITE_SIGNALING_URL` **unset** for this same-project deployment. Browsers use their own origin's `/ws`. This variable remains available only for a separately hosted backend.
- Optional `STUN_URL=stun:your-stun-host:3478` enables NAT discovery. It does not add TURN or guarantee connectivity through VPNs, client-isolated Wi-Fi or restrictive firewalls.
- Do not set `PORT` or `SERVE_FRONTEND` on Vercel. Vercel manages the Function HTTP server; the frontend is served statically.
- Production builds validate Redis/TLS, origin, namespace and shared secret. Missing configuration fails the build instead of silently falling back to local RAM.

Preview environments must use a separate database (recommended), namespace, secret and exact allowed preview origin. Do not expose production Redis credentials to untrusted preview code. Do not allow arbitrary `*.vercel.app` origins.

## Temporary data and limits

Redis stores names, visibility, network hashes, pairing tokens, leases and transfer authorization state. It does **not** persist file bytes, filenames, SDP, ICE candidates or transfer history. Filenames and connection negotiation pass transiently through signaling/Pub/Sub; provider logs/backups are outside the application's control.

State uses an atomic compare-and-set plus Pub/Sub: two instances cannot independently accept conflicting transfer requests or publish events from a failed write. Per-socket messages are processed in order. Disconnected sessions are removed normally; crashed instances are cleaned up by 90-second presence leases. A quiet shared state key expires after 180 seconds without refresh. Upgrade counters expire after 60 seconds. No Redis polling runs when an instance has no local sockets.

This first distributed implementation intentionally caps 200 connected devices globally, 30 devices per network group and 30 QR pairings per device. It uses a bounded shared snapshot rather than an unlimited-scale presence system. Larger deployments need partitioning/load testing. The in-memory local mode retains its original 1,000-device cap and is not allowed on Vercel.

Redis/Pub/Sub failures terminate local sockets so clients reconnect rather than continuing with inconsistent state. Redis quota exhaustion is an outage, not an automatic upgrade or an upload fallback.

## Validate before release

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:redis
npm run test:e2e
npm run test:e2e:redis
npm audit
```

`npm run test:redis` requires a locally available `redis-server`, or its absolute path in `REDIS_SERVER_BIN`. It launches a loopback-only ephemeral Redis with persistence disabled and removes the temporary test directory afterwards. Alternatively, set `TEST_REDIS_URL` to a **dedicated test database** and run `npm test`. Redis integration tests exercise administrative connection-kill commands and must never run against production.

GitHub Actions provides a dedicated Redis service and runs these integration tests automatically. Ordinary `npm test` skips Redis integration tests if `TEST_REDIS_URL` is absent.

`npm run test:e2e:redis` also requires `redis-server`. It runs the browser transfer suite against the built frontend and two isolated backend instances with round-robin WebSocket routing and shared Redis. This verifies actual file bytes and cross-instance signaling locally, but does not emulate Vercel's TLS/routing/runtime limits.

After deploying:

1. Check `https://your-domain/api/health` returns `{"ok":true}`; Redis failure should return 503 without exposing configuration.
2. Check the browser's `/ws` handshake returns 101 and reaches the same Vercel project.
3. Test discovery, hide/show, QR, accept/decline/cancel, both transfer directions and downloaded file bytes.
4. Verify foreign origins cannot connect, and check CSP/mixed-content errors.
5. Test real iPhone/Safari and Android/Chrome, screen locking, backgrounding and network interruption. Chromium viewport tests are not real-device certification.
6. Leave sessions open past five minutes and test long transfers explicitly. Reconnection is automatic; transfer resume is not implemented.
7. Monitor Vercel compute/network usage and Redis commands/bandwidth/connections. Keep provider-level abuse protection enabled. Origin checks do not authenticate non-browser clients.

No real Vercel deployment or Upstash account/database is created automatically. A successful local build/test does not verify live Vercel routing, Upstash TLS/permissions, plan eligibility or billing settings.

## Optional standalone mode

The existing Node/Docker deployment remains supported for a separately hosted backend. Without Redis, it must run as one instance. Set `PUBLIC_ORIGIN` to the frontend origin, configure trusted proxy hops correctly and use `VITE_SIGNALING_URL=wss://your-backend-domain/ws` for the frontend.

```sh
docker build -t dropmine-signaling .
docker run --rm --init --name dropmine-signaling \
  -p 127.0.0.1:3001:3001 \
  -e PUBLIC_ORIGIN=https://your-frontend-domain \
  -e TRUST_PROXY_HOPS=1 \
  dropmine-signaling
```

Place that loopback-only port behind a trusted HTTPS/WebSocket proxy. Do not expose Node directly while trusting forwarded headers. The container runs as a non-root user and has a health check. Docker is an alternative, not required for the all-Vercel setup.
