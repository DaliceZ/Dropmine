# Production: Vercel + standalone signaling

## Architecture

```text
Phone / computer ── HTTPS ── Vercel (frontend)
       │
       ├── WSS ── one Node.js signaling instance (metadata in RAM)
       │
       └── WebRTC DataChannel ── other device (file bytes)
```

No database, uploads, file storage or TURN relay is added. The signaling service still sees temporary names, file metadata, connection information and pairing state. Do not enable request/message payload logging. Hosting providers may retain their own network/access logs.

Vercel supports WebSockets in Beta, but new connections can land on different instances. Its documentation requires external coordination for distributed presence/rooms. This application deliberately uses one separate long-running backend to preserve the no-database requirement. Do not deploy the current in-memory backend as a Vercel Function or enable multiple replicas.

References: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## 1. Backend

Use a service that supports a continuously running Node.js process, HTTPS, WebSocket upgrades, and exactly **one instance**. Disable scale-to-zero/automatic sleeping for continuous discovery. No persistent disk is required. Configure the provider's health check as `GET /api/health`.

For a Node.js deployment, run from the repository root:

```sh
npm ci
npm run build -w backend
npm run start -w backend
```

Use Node.js 22.12+ (the repository pins a tested version in `.nvmrc`). Set runtime variables in the hosting dashboard, not in source control:

```dotenv
NODE_ENV=production
PUBLIC_ORIGIN=https://your-frontend.vercel.app
SERVE_FRONTEND=false
TRUST_PROXY_HOPS=1
STUN_URL=
```

`PUBLIC_ORIGIN` is the exact frontend origin, with **no trailing slash**. When adding a custom domain, change it to that canonical domain and redirect other frontend domains to it. The backend rejects foreign origins, preview deployments and same-host origin fallbacks when a production origin is configured. Use an isolated backend for previews; do not allow arbitrary `*.vercel.app` origins.

`TRUST_PROXY_HOPS=1` is only an example for **one verified, trusted reverse proxy**. Check your provider's actual topology and forwarded-header handling. Use `0` for a directly exposed Node server. Only trust forwarded IPs when external clients cannot bypass the proxy and the proxy sanitizes the header. Wrong settings can group unrelated users together or prevent discovery. Do not use proxying through Vercel for the WebSocket endpoint; browsers connect directly to the backend.

`PORT` defaults to 3001; use the port assigned by your host. Terminate TLS at a trusted proxy and expose `wss://your-backend-domain/ws`. Set the proxy's WebSocket idle timeout above the application's 15-second heartbeat. Do not cache WebSocket upgrades or `/api/health`.

Optional `STUN_URL=stun:your-stun-server:3478` enables NAT discovery; leave empty for direct local candidates only. This does not add TURN. Test target networks before choosing a STUN provider. Without TURN, some VPNs, firewalls and isolated Wi-Fi networks cannot transfer files; QR pairing cannot fix that.

### Docker alternative

Build from the repository root:

```sh
docker build -t dropmine-signaling .
docker run --rm --init --name dropmine-signaling \
  -p 127.0.0.1:3001:3001 \
  -e PUBLIC_ORIGIN=https://your-frontend.vercel.app \
  -e TRUST_PROXY_HOPS=1 \
  dropmine-signaling
```

Put this behind a trusted HTTPS/WebSocket reverse proxy. The loopback mapping is intentional: do not expose the Node port publicly while trusting proxy headers. The image runs as a non-root user and includes a health check. For managed container platforms, let the platform route to the container's assigned `PORT` instead of using this local port mapping.

## 2. Vercel frontend

Import the repository into Vercel and use these settings:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (not `frontend`) |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build -w frontend` |
| Output Directory | `frontend/dist` |
| Node.js version | 22.x |

`vercel.json` contains the build/output settings, security headers and cache policy. Keep this project static: no Express entry point or Functions are required on Vercel.

Set this **public, build-time** environment variable in Vercel:

```dotenv
VITE_SIGNALING_URL=wss://your-backend-domain/ws
```

Enable it only for environments that have an appropriate backend. Redeploy after changing it. Never place credentials or secrets in `VITE_*` variables; they are embedded in the JavaScript bundle. Builds on Vercel fail early if the endpoint is missing or insecure. The backend URL must end in `/ws`, without query parameters, fragment, username or password.

Do not set the backend-only `NODE_ENV`, `PUBLIC_ORIGIN`, `TRUST_PROXY_HOPS` or `STUN_URL` on the Vercel frontend. Production HTTP headers allow encrypted WebSocket connections; the backend's exact origin check is the authorization boundary for browser signaling connections. Origin checks do not authenticate non-browser clients, so keep hosting-level abuse protection enabled as well.

## 3. Release checklist

- Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e` and `npm audit`.
- Verify `https://your-backend-domain/api/health` returns `{ "ok": true }` without exposing application state.
- Open the Vercel frontend in two browser sessions and verify the `/ws` request uses the configured backend and returns status 101.
- Verify discovery from two real devices on the same network, hide/show toggle, QR pairing, acceptance/decline/cancel and both transfer directions.
- Compare downloaded bytes; a successful receive is not the same as saving to the device.
- Test real Safari/iOS and Chrome/Android, with screen lock/backgrounding and network interruption. Automated viewport tests are not a substitute for real-device tests.
- Verify an unapproved frontend origin cannot open a WebSocket.
- Restart the backend and verify clients reconnect. Active transfers/pairings are not resumable and can be interrupted during deploys; reconnect uses bounded exponential backoff with jitter.
- Confirm only one backend instance is running, automatic sleeping is disabled, TLS certificates renew, and provider logs do not capture file metadata or pairing messages.
- Check production headers and the browser console for CSP/mixed-content errors. Hashed assets cache for a year; the HTML entry point revalidates.
- Set provider-level resource/connection limits and alerts before public launch. The application caps 1,000 devices globally, 30 devices per network group, 120 upgrade attempts per group per minute, 180 messages per socket per 10 seconds, and 96 KiB per signaling message. Shared NAT users share the network limits.

GitHub Actions validates builds, types, unit/integration tests, production dependency audit and Chromium E2E checks when this repository is pushed to GitHub. Vercel credentials are not stored in CI.

## Rollback and limits

Keep the previous frontend deployment and backend image/version available. Frontend and backend must use compatible versions of `shared/protocol.ts`; release them together if that protocol changes. A backend rollback/restart clears all in-memory discovery and pairing state and interrupts active transfers. A single backend is intentionally not a high-availability architecture.

This configuration prepares deployment; it does not create cloud projects, purchase hosting, provision domains/TLS, or verify a live deployment. Those steps require your chosen backend host and actual production URLs.
