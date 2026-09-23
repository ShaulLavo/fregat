# Live delivery and MCP approvals

Implementation shipped in release `20260920T132650Z-b915d3e0-plan126-live-delivery`. The MCP browser evidence is recorded below; live overflow recovery and full upstream alignment remain unverified.

## Bounded delivery

Protocol 7 adds delivery IDs and acknowledgments. Server subscriptions send one frame at a
time, retaining their live-data charge until acknowledgment. One budget counts queued events,
coalesced events and in-flight frames against 1,000 items and 8 MiB of serialized UTF-8 data.
Overflow and abort detach subscribers, settle waiters and clear references. A stalled ACK
overflows after 30 seconds. Snapshot and catch-up replay are outside the server live-data
budget but remain ACK-gated, matching the pinned upstream policy.

Client queues count received and yielded-but-unconsumed data. ACK follows consumption.
Overflow resumes from the consumed cursor; repeated overflow at the same cursor requests a
snapshot, so one oversized durable event cannot cause an endless replay loop. One snapshot
is allowed outside the client live byte budget. This is a bounded-retention claim, not a
throughput or latency improvement claim.

Forty focused tests pass across budget, stream, socket, client queue and RPC tests, including
an actual engine/client recovery from an oversized durable event to canonical snapshot text.
Server, client-core and web typechecks and targeted lint pass.

## MCP app-access approval

The native adapter retains request identity, ownership and valid response choices together.
It immediately declines URL forms and recognized forms with unpopulatable required fields.
The pinned upstream's unknown-schema behavior remains acceptance without content after user
approval; there is no invented app/server allowlist. Once, session and permanent decisions
produce the corresponding native content and persistence metadata. Unadvertised decisions
fail before consuming the pending request.

Choices pass through ingestion and persisted activity into shared client derivation, web and
TUI controls. Providers without advertised choices receive their existing ordinary choices.
Adding the permanent decision does not silently grant it to ordinary Codex/Claude requests.

Forty-five focused server/web/TUI approval tests pass. The `mcp-approval` browser scenario uses
a unique simulated native provider process, drives the real request UI after reload, records
the exact native reply and removes its session, settings and scratch process directory. It
never grants access to a real external app. Browser execution passed on release `20260920T132650Z-b915d3e0-plan126-live-delivery`.
Evidence: `/work/tmp/fregat-evidence/20260920T132758Z-scenario-mcp-approval/`; all choices
survive reload, the permanent reply is exact, and both captured native processes exit.
Screenshots were inspected; no server warning/error occurred during this run.

Neither these local tests nor the source census is a paired upstream runtime comparison.
