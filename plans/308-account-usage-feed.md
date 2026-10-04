# Plan 308: Fregat owns bounded account-usage collection and the Mesh cache feed

- Status: Approved
- Date: 2026-10-03
- Owner: `ShaulLavo/fregat`, server provider usage and web Settings Usage.
- Sources: [#341](https://github.com/ShaulLavo/fregat/issues/341), account limits from [#345](https://github.com/ShaulLavo/fregat/issues/345), and the owner decision below. Those issues were closed by plan conversion; implementation remains tracked here.
- Related: [141](141-usage-and-rate-limits.md), [289](289-proxy-usage-feed.md), [309](309-account-usage-history.md).

## Owner decision and outcome

On 2026-10-03 the owner decided: “Fregat itself will align with T3 Code and pull usage here and there, then [mesh] reads from Fregat's cache.” Occasional bounded usage requests are acceptable. Tight polling is not. This decision supersedes the gateway-producer and zero-extra-request prerequisites in Plans 289/308. The coordinator authorized source-only gateway producer retirement after Fregat logging [#476](https://github.com/ShaulLavo/fregat/pull/476), native labels/Settings [#479](https://github.com/ShaulLavo/fregat/pull/479), and Mesh formatting [#137](https://github.com/ShaulLavo/mesh/pull/137) merged. Live TV acceptance, consumer cut-over and installed gateway retirement remain pending root-coordinator operations. Remaining gateway tooling is independently owned outside Fregat. The selected DROP archive awaits root-only source installation under `/work/cli-proxy-api/src`; bundle deployment is a separate root-coordinator operation.

Fregat collects account allowances, persists observations across restarts, shows independent accounts in Settings › Usage, and serves a read-only cache endpoint for the already-shipped Mesh TV panel. One Claude login belongs to the owner. CLIProxyAPI rotates two Codex/ChatGPT logins. Never pool or proxy Claude logins. Never add account allowances together or invent a selected rotating account.

History is complementary: [Plan 309](309-account-usage-history.md) scans local transcripts across tools, including work outside Fregat projects, with explicit local coverage and API-equivalent cost estimates. Local token totals are not complete cross-device account spend. Provider-reported allowances are account-wide.

## Read and record the boundary

- Fregat baseline: `0e440ec26`, following plan conversion and issue-closure receipts at `28b73e2e8`.
- T3 reference fetched and fast-forwarded from `6c8fed35dded9ff71c5b46807125457acbb76be6` to `a7b3ce8c0896d123a7c3f02c586ff8193841cc09` on 2026-10-03. Read current `UsageService.ts`, `usageTranscriptReader.ts`, `usageTranscripts.ts`, `cliproxyApi.ts`, Claude/Codex provider layers, passive Claude adapter events, reset credits, and provider status cache. The refreshed tree also includes orchestration-v2 and desktop/mobile changes; adopt usage evidence, not unrelated architecture.
- Research: `/work/reports/mesh-usage-native/research.md`. Claude `cachedUsageUtilization` has `fetchedAtMs` and an account identity. Codex logs have no reliable quota-account attribution after resume.
- Mesh canonical v1 schema: `internal/usagefeed/schema.go` at Mesh `origin/main` (`7d400c6` inspected). Shape includes `accounts`, `windows`, optional native `credits`, `source`, `checkedAt`, `lastSeenAt`, routing, and cooldown. Account source is constrained to `passive-header` or `proxy-state`; window source is a validated display string. Preserve that wire contract; keep detailed collector provenance in Fregat's account/window model.
- Existing Fregat `usage-store.ts` probes on read, is memory-only, hides unseen accounts and expired windows, and has separate explicit-refresh scheduling. `usage-history.ts` reads only recorded/imported turns. These are the observable gaps.
- Approved TV appearance and freshness rules: `/work/reports/pi-tv-dashboard/usage/README.md` and Plan 289's committed images. Mesh already implements the consumer and dashboard; no layout redesign is required.

## One bounded collection owner

Register sources, intervals, local source paths where configurable, management URL, timeout/size policy, and cache policy in the settings registry with machine/application scope. Management credentials belong in the existing secret store. Defaults must be occasional and validated with minimum intervals; failures consume the interval too. A single lifecycle owner serializes account fetches, reset-credit refreshes, and passive/cache ingestion. Concurrent callers coalesce; shutdown cancels pending work. No timer or query creates inference turns.

Sources:

1. Claude SDK usage getter, using the existing adapter/SDK, at the bounded cadence. Passive `rate_limit_event` on existing turns adds no requests. Matching `~/.claude.json` cached utilization is free and uses `fetchedAtMs`, never filesystem mtime or read time. Reject cache/account mismatch. Optional reset-credit reads/redemption follow T3 and the existing explicit confirmation flow.
2. Codex `account/rateLimits/read` through its app-server adapter. Durations classify windows; `primary` is a position, never a five-hour guarantee. Keep provider-native credits separate from reset-grant counts and monetary cost.
3. CLIProxyAPI local management, enabled only through a registered setting and a stored secret. This delivery reads bounded cached auth-file quota state only. An account without usable cached quota remains explicitly no-data. Never call Claude through the proxy or install Claude credentials in it. Keep two configured Codex identities even before observations. Cooldown or a generic 429 does not manufacture quota exhaustion. Management availability and request buckets do not prove which account served a response.

A small proxy fallback follow-up awaits explicit owner authorization; it does not block this delivery. Its bounded design is T3's positively attributed management `api-call` usage fetch for ChatGPT accounts lacking cached quota, at most once per hour per account under a registered policy with that default and validated minimum. It skips cooldown/unavailable accounts until available again, persists attempts across restarts and logs sanitized provenance. Workers remain fixture-only; the coordinator owns live source configuration. No fallback is implemented or enabled in the current phase. 4. Local transcript scanning in Plan 309. No quota account is inferred from today's auth file or a session creator ID.

Persist only validated sanitized account observations and scheduling timestamps in Fregat's state home. Atomic replacement, bounded file/response sizes, schema versioning, and restart tests protect the cache. Preserve per-window observation times through failures, sparse updates, restart, and republishing. Merge each account/window by newest valid observation and its reset epoch; older local-cache records and delayed probe responses cannot overwrite newer passive observations. Use source fetch/observation times when available and conservative request-start times otherwise, never response-completion time to disguise old data. Missing values stay unknown. Reset passing retains explicitly historical data until a new observation arrives; it does not refill allowances.

Deduplicate native and proxy accounts only when a validated non-secret provider identity mapping proves equality. Credential paths, labels, plans and recent request buckets do not prove it. Otherwise retain distinct source-labeled accounts and explicit unknown identity relationships. An explicit provider-instance quota-source mapping selects the proxy group without claiming identity equality or which account served a native turn; exclude its unattributed native quota events. Test proven equality, ambiguous identities and configured source selection independently.

Both Settings/composer readers and the Mesh feed endpoint read cache only. Opening or repeatedly polling either surface cannot fetch provider usage, access management, wake the inference route, or extend its idle window. Collection runs through the service lifecycle at its bounded cadence. Account identity is opaque and stable; no tokens, full emails, raw IDs, auth filenames, prompts, raw errors, or management configuration enter the feed.

## UI and feed

Settings › Usage shows provider-grouped, independent account/plan/window rows, actual ages, native credits where known, configured-unseen accounts, and clear stale/reset-passed states. Window ages remain independent. Unknown routing remains unknown. Allowances and local transcript accounting are separate sections. Use TanStack queries, registry settings, shared UI primitives, theme tokens, structured errors, full-value titles and the existing loading/held-view patterns. Background collection must reach idle mounted views through collector-driven query invalidation or bounded cache-only polling; a turn or navigation must not be required to see a first observation.

Add a production API route beneath `/platform` returning the Mesh v1 shape, capped at 64 KiB and valid UTC timestamps. Its handler reads the persisted service snapshot only. Normal browser API authorization remains intact; the feed is reachable by the existing tailnet-private production route without giving the TV credentials or relaxing unrelated Origin/device guards. Test this precise security boundary and the Mesh strict decoder against a produced fixture. No new Mesh parser is planned; if the actual strict contract makes truthful source export impossible, isolate and independently review only that necessary schema change.

## Phases, tests and PRs

Each PR receives one independent Sol HIGH reviewer, green CI, and a squash merge. Run fail-first tests before implementation and the narrowest plausible failing checks through the heavy wrapper. Every merge receipt belongs below. Merge a green PR after unrelated main movement without redundant CI; shared contracts/lockfiles/build config require re-verification when changed.

- [ ] Phase 0 — publish these Approved updates to Plans 308/309/289, the inventory and root roadmap; `bun run plans:check`, docs format, independent HIGH review, green CI, squash merge.
- [ ] Phase 1 — server source/cache/contracts/settings and cache-only feed. Fail-first quota normalization, duration, mixed ages, account mismatch, nullable credits, no-data, bounded/coalesced/failure/reset refresh, cache restart, late/out-of-order collector and reset-epoch merge tests, proven/ambiguous identity fixtures, and pure-read request-count tests. Verify with Mesh's strict decoder without contacting a provider.
- [ ] Phase 2 — local transcript history under Plan 309. Portable native files outside projects reproduce the scope gap; prove deduplication, pricing provenance, partial writes, append/truncate/replace, corrupt/restarted scan cache, timezone/range behavior and cached reads. Keep local coverage explicit. Connected-host composition remains separately scheduled by Plan 309.
- [ ] Phase 3 — Settings/account UI and composer adoption. Fail-first render/query fixtures; normal/narrow `settings-usage` and account/no-data/stale/mixed-age scenarios, including an idle composer receiving its first background observation. Read back `look` evidence and prove cache-only reads. Do not claim cross-device transcript coverage.
- [ ] Phase 4 — deploy Fregat. Verify on the mesh-owned dev server, then `bun run install-release --server --restart`; confirm production `/platform/release`, account cache persistence, cache-only feed and unchanged actual observation ages under repeated reads. No Pi or live gateway changes by this lane.
- [x] Phase 5 source retirement. Removed the entire former gateway source folder and root test/unused inventories. The owner selected the verified DROP archive, preserving all 15 committed source files with original modes plus standalone package/lock and source instructions. `readCredits` stays in the retained `usage-feed.ts` helper module; orphaned ten-minute provider polling is excluded. The startup schema and both exported constructors reject Claude pool configuration before binding. Offline discovery passes 163 tests in six files; standalone build, strict source types, three individual shell checks and source-installer/archive fixtures pass. Repeated-signal rollback and proxy-free health-probe fixes remain intact. Coordinator review and merge, root source-only installation and separate bundle deployment remain pending. Neither installer nor deployment script ran against installed state.

## Execution receipts

- Plan PR / merge: pending.
- Server PR / merge: pending.
- Transcript PR / merge: pending.
- UI PR / merge / look evidence: pending.
- Dev / production deploy evidence and final feed URL: pending.
- Source-retirement PR / merge: [#496](https://github.com/ShaulLavo/fregat/pull/496), verified DROP archive selected and latest-main retirement inventory refreshed; independent pinned-head review and merge pending. Root source-only installation remains unexecuted. Installed retirement remains gated on root-coordinator TV acceptance and consumer cut-over.

## Exact live handoff boundary

The implementation lane never touches the Pi, installed gateway, `runtime.json`, `/ai-usage` route, or `/work/cli-proxy-api/usage-feed`. The coordinator alone performs these steps after the deploy receipt:

1. Point the Pi's `dashboard.usageFeedURL` at the reported production Fregat cache-only endpoint. Preserve all other `hosts.json` fields. Verify the strict v1 response, three independent accounts, real ages, stale/reset/no-data behavior, and the approved panel appearance.
2. Confirm repeated TV/feed reads make no provider/management requests and keep `/ai` asleep with the same idle deadline. Check that a Fregat restart retains valid observations.
3. After the reviewed source-retirement merge, root separately authorizes source-only installation of the verified DROP archive under `/work/cli-proxy-api/src`, preserving the prior source directory. Bundle deployment waits for TV acceptance and uses the retained `producer-retirement-deploy.sh` with explicit source and installation directories. The script restarts the gateway through its existing Mesh-owned lifecycle and leaves runtime JSON untouched. This also respawns its owned Codex proxy. Never configure Claude pooling.
4. Remove the `/ai-usage` Mesh route and then delete `/work/cli-proxy-api/usage-feed` only after confirming no consumer still points at it. These are owner-kept live resources; this lane does not delete them.

Report the actual commands resolved from installed route/service metadata in the final handoff, without printing secrets or whole runtime/auth files. Keep runtime modifications and route/directory removal out of portable tests.
