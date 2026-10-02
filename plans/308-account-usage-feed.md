# Plan 308: Show every account from the passive usage feed

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/fregat`, server provider usage and web chat/settings.
- Sources: [Fregat #341](https://github.com/ShaulLavo/fregat/issues/341) and the account-limits part of [#345](https://github.com/ShaulLavo/fregat/issues/345).
- Related closed work: [#359](https://github.com/ShaulLavo/fregat/issues/359#issuecomment-5961645602). Claude pooling stays disabled. Its single-login usage comes from passive gateway observations.
- Prerequisite: [Plan 289](289-proxy-usage-feed.md) owns the producer and isolated static route. Older issue references to Plan 287 refer to that renumbered plan.

## Outcome

The composer and Settings Usage show each configured proxy account with its own plan, windows, and observation age. A rotating provider shows its account group even when the serving account is unknown. Opening either view reads sanitized cached observations. It creates no provider request, inference demand, host wake, or extension of the inference route's idle window.

## Read the current implementation first

Source inspection used Fregat `46e47cb71`. Recheck these facts before implementation.

- `scripts/claude-gpt/usage-feed.ts`, `usage-producer.ts`, and `run.ts` implement Plan 289's v1 normalization, atomic publication, and gateway lifecycle. The plan records producer source completion, but deployment and live static-route acceptance remain unchecked. Source completion does not establish a running feed.
- `apps/server/src/provider/usage-store.ts` groups enabled instances by credential-derived keys. `read()` can probe stale native accounts. `snapshot()` discards accounts without windows and removes expired windows. That model cannot retain configured-but-unseen proxy accounts.
- `provider-adapter-registry.ts` hashes driver kind and credential paths. Equal paths prove shared local credential storage. They do not prove equality with a proxy feed ID.
- `packages/contracts/src/provider-usage.ts` requires a numeric percentage and one account-wide `checkedAt`. The v1 feed supports unknown percentages, per-window observation times, no-data accounts, and unknown routing selection.
- `use-provider-usage.ts` and `utils/usage-meter.ts` select the first account matching a provider instance. `usage-limits-meter.tsx` displays one account. Settings `usage-section.tsx` currently displays recorded history without a pool-limits section.
- `provider/reset-credits.ts` calls `refreshAccount()` after explicit redemption. The store's normal probe path and explicit refresh must have one serialization owner when this integration changes usage reads.

Read [Plan 141](141-usage-and-rate-limits.md) for existing direct-account behavior. [Plan 309](309-account-usage-history.md) owns transcript history. This plan does not turn token totals into provider allowance percentages.

## Keep identity and observations explicit

Extend Fregat's validated usage contracts with account source, stable opaque ID, safe display label, plan, configured state, and routing membership. A provider-instance association can resolve to a direct account or a rotating account group. Return a selected account ID only after positive attribution. Preserve null when selection is unknown.

Each window carries its source, observed time, nullable percentage, nullable reset, and nullable duration. Preserve v1 window namespaces and status-only observations. `primary` describes an upstream position. Its duration comes from data. A successful file fetch updates transport health but never changes observation age.

Retain configured no-data accounts. Display their identity and plan with `No data yet`. Keep stale valid windows visible with their own ages. After a reset passes, say `Reset passed · awaiting traffic`. Do not fill an unobserved new window with zero. A fresh session window cannot freshen an old weekly reading. Reuse Plan 289's 15-minute stale classification and its last-valid-snapshot behavior.

Use a server-side feed reader. The browser reads Fregat's existing authenticated API. Register the exact sanitized feed URL through the application settings registry. Validate HTTPS or an explicitly supported loopback resource at configuration time. Refuse redirects, credentials in URLs, arbitrary fetch targets, oversized responses, and unsupported schemas. Use the v1 64 KiB bound, bounded timeout, and at most one feed request per 60 seconds. Coalesce readers and cancel work at service shutdown. Keep application Origin and device authorization guards unchanged. The browser receives no management URL, management key, auth record, or raw upstream error.

Deduplicate native and feed accounts only when a validated non-secret account identity mapping proves equality. Labels, plan names, credential paths on different hosts, and recent request buckets are insufficient. Without proof, retain source-labeled rows and report that their identity relationship is unknown. Never sum percentages across accounts. Never recreate the closed Claude pool.

Mark provider instances backed by the passive feed so their UI reads bypass native quota probes. Existing direct-native behavior can retain its current cadence. Put every retained active quota caller, including explicit refresh and the existing post-reset exception, behind one account-keyed scheduler. Preserve the explicit reset-credit command and confirmation. Feed accounts gain no redemption capability. Count provider calls before and after under equal native workloads to prove this integration adds none.

## Execute in bounded steps

Complete each step's narrow check before the next step. Keep decoder, store policy, and rendering changes in separate reviewable commits.

- [ ] Verify Plan 289's source version and deployment receipt. If the static route is pending, implement against injected v1 fixtures and record live acceptance as a dependency.
- [ ] Capture current meter and Settings behavior with `chat-usage-meter` and `settings-usage`. Record provider-call, feed-read, and inference-route demand counters without making inference requests.
- [ ] Extend the account/window contracts and pure feed decoder. Add fixture checks for two rotating Codex accounts, the single Claude account, nullable percentages, durations, and routing selection.
- [ ] Add the lifecycle-owned server reader and last-valid snapshot store. Test exact-target validation, redirect rejection, size/schema failures, coalescing, cancellation, and preserved observation times.
- [ ] Add source-aware instance associations and identity matching. Exercise proven native/feed equality and ambiguous identity as distinct cases.
- [ ] Route proxy-backed instances through cached reads. Serialize all retained native probe and explicit-refresh entry points. Verify unchanged native request counts and zero provider calls from feed-backed reads.
- [ ] Render account groups in the composer popover and account limits in Settings Usage. Retain no-data/stale/reset-passed rows, safe full-value titles, and unknown selection. Use TanStack queries and existing UI primitives.
- [ ] Run portable server fixtures with a fake static feed and injected outside-world fetcher. Assert that repeated reads never contact management, provider, or inference activation endpoints.
- [ ] Add browser scenarios for mixed-age windows, rotating unknown selection, configured-unseen accounts, and failed refresh retaining the prior snapshot. Read back `look` screenshots at normal and narrow composer widths.
- [ ] With Plan 289 deployed, verify repeated live reads while the inference route sleeps. Check that it stays asleep and its idle deadline remains unchanged. An unreachable feed preserves stale data. Keep this machine-specific proof in delivery evidence.
- [ ] Commit and push owned paths, run required gates through the heavy runner, deploy server/web changes through the repository release flow, and verify the served commit and live account groups.

## Acceptance and verification

Portable tests use a temporary feed location, injected clock, and simulated HTTP responses. Reuse `provider/tests/usage-store.test.ts`, the meter helper tests, and app fixtures where their ownership still fits. Add contract tests at the wire boundary. Tests assert observable request destinations and counts rather than mock our own store.

The owner can see all configured accounts with separate allowances. No-data is distinct from zero use. Window ages survive republishing and failures. Unknown serving identity remains unknown. Native/feed identity merges require proof. Reading the usage views creates no additional provider calls or inference activation.

Use `typescript-best-practices`, `tanstack-query-best-practices`, `technical-writing`, and `unslop` during implementation. Use `how` before changing unfamiliar provider lifecycle code and `verify-fregat` for UI evidence. Foundational Thinking puts the account/window shape first. Boundary Discipline places validation at configuration and JSON ingress. Sequence Work into Verifiable Units keeps request-count proof separate from UI delivery.

Track execution in this checklist and the root roadmap. An issue closure transfers tracking here. It does not mark the feed adoption shipped.
