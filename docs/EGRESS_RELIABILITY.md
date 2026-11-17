# Personal Voice: Supabase background egress reliability

## Incident observations
The Supabase Free organization hit `exceed_egress_quota` (HTTP 402). The live database's cumulative `pg_stat_statements` counters since September 27 show millions of device presence reads/writes and remote request polls, but those counters do **not** measure outbound bytes and do not prove an exact fraction of egress. Verify the Supabase organization Usage / Egress breakdown independently for attribution. No production service or quota resets are changed by this PR.

## Minimal fixes in this branch
- A single shared `DeviceHeartbeatGate` coalesces background `devices.last_seen` writes made by Remote Read, Remote Computer Action and Remote Dictation loops, and suppresses redundant updates for 25 seconds. Existing device presence freshness is 45 seconds. User-initiated actions still follow their usual authorization flow.
- Background action and context polls slow from 4 seconds to 15 seconds while connected; DeviceLink LAN/cloud wake hints still trigger immediate safe checks.
- Remote Read skips listing all devices when no incoming remote request exists.
- Remote Dictation uses its existing Realtime subscription to deliver requests immediately and reduces healthy-connection fallback scans to one per 60 seconds. When disconnected, the existing 4-second scan remains for six-second expiry protection.
- Remote Dictation device list refresh is moved from every 4 seconds to every 15 seconds; existing manual refresh remains.
- Handoff idle polls decrease from 8 seconds to 30 seconds, with focus and visibility refresh maintained.
- A shared best-effort `BackgroundTrafficBudget` reduces retry storms during quota (HTTP 402) or network outages, without blocking explicit user actions. It does not silently retry signed side effects.
- Quota error mapping preserves the HTTP 402 signal, and an unrelated successful call cannot cancel a still-active quota cooldown.

## Limits and safety
This changes **client code**, so all still-running older Windows/Android builds will keep their previous polling behavior until they are updated. It cannot restore an already depleted Free quota or guarantee the egress restriction disappears. The supplied limit is organization-wide. Continue reviewing usage from all apps and service categories.

The 25-second throttling is scoped to one app process. There is no inter-process shared cache, and the full quota restriction must be monitored from Supabase itself.

Fast remote dictation still depends on the Realtime channel or a 4-second disconnected fallback. Real-world wake latency, delayed internet, backgrounded Android, pairing, and crash recovery require Windows/Android hardware acceptance before merging.

## Tests and Go/No-Go
1. `pnpm check`, `pnpm eval:tools`, Windows and Android CI must pass. Include `backgroundTraffic.test.ts`.
2. On two paired devices: confirm remote dictation delivers inside its existing six-second expiry in both healthy Realtime and Realtime-disconnected fallback cases.
3. Confirm remote action, screenshot approval, signed request replay protection, durable computer task, device online status and handoffs still function.
4. Use an idle-window request log to compare total Supabase requests and response bytes before and after. The project goal is at least 90% reduction in background requests if realistic, not a reported measurement.
5. Simulate a quota 402 and network failure; verify background polls enter backoff and explicit user actions still return an understandable error.
6. Confirm updated Windows and Android binaries are distributed and active before treating the fix as deployed.

Do not merge or release until the tests and hardware smoke results are recorded.
