# Redis optimization

## Changes

- Refresh presence once per 60 seconds instead of 30 seconds, per active backend instance. WebSocket ping/pong remains every 15 seconds and does not access Redis.
- Extend device leases from 90 to 180 seconds and snapshot TTL from 180 to 360 seconds. Normal socket disconnects still remove devices immediately. An abruptly stopped instance can leave devices visible until their lease expires and another instance runs maintenance; with no surviving instances the snapshot expires instead.
- Relay SDP/ICE through one atomic Lua script instead of a snapshot read/compare-and-set transaction. The script checks the current state version, device membership, receiver acceptance, transfer expiry and both presence leases before publishing. Cancellation/completion and relay authorization remain serialized by Redis. Signals do not refresh leases or snapshot TTL; periodic maintenance does that.
- Send peer lists only to affected network/paired devices whose views changed. A profile message still returns the profiling device's current peer list, including on first registration. Pub/Sub itself remains shared across backend instances.
- Manual device refresh reads the shared snapshot once and responds only to the requesting socket, without writes or Pub/Sub. Both the browser and backend enforce a 10-second cooldown per session; the backend limiter is instance-local because a WebSocket remains attached to its serving instance. Reconnecting creates a new session and is still subject to the upgrade rate limit. Refresh does not restart the connection or interrupt transfers.

## Measured results

Measured before and after these changes using isolated local Redis 7.2.16, with no production credentials. Each scenario has one active service instance and no competing writes. Idle measurement starts after an initial maintenance pass, then advances four 30-second ticks.

| Scenario | Before: GET / EVAL / SET / PUBLISH | After: GET / EVAL / SET / PUBLISH | Application-to-Redis command calls before → after |
| --- | --- | --- | --- |
| One accepted signal | 2 / 1 / 1 / 1 | 1 / 1 / 0 / 1 | 2 → 1 |
| Idle presence over 120 seconds | 8 / 4 / 4 / 0 | 4 / 2 / 2 / 0 | 8 → 4 |

GET/SET/PUBLISH counts come from Redis `INFO commandstats` and include commands executed *inside* Lua. Application command calls exclude those internal operations. These measurements are not Upstash billing estimates and do not imply a 50% reduction in the total bill. Actual usage also depends on connections, backend instance count, Pub/Sub subscribers, devices, pairing/profile traffic, transaction retries and the provider's accounting rules.

Each signal avoids sending the full snapshot back to Redis. It still reads/decodes the bounded snapshot inside Redis; this is not an unlimited-scale or partitioned presence implementation. Idle writes still refresh the shared snapshot and increase with the number of active backend instances.

## Validation

```sh
npm run typecheck
npm test
REDIS_SERVER_BIN=/path/to/redis-server npm run test:redis
npm run build
REDIS_SERVER_BIN=/path/to/redis-server npm run test:e2e:redis
```

Integration tests check operation counts, read-only bidirectional relay, namespace isolation, cross-instance discovery, atomic competing requests, subscription recovery, expiry and authorization after completion/cancellation. Unit tests check selective discovery updates and hidden cross-network pair changes. Browser tests exercise the actual file-transfer flow across separate backend processes.

Deploy a new version to Vercel to activate the changes. No new environment variables or Redis migration are required. Prefer rolling out when no transfers are active: WebSocket reconnection still does not resume an interrupted transfer. Observe actual Upstash Usage after deployment before estimating capacity or savings.
