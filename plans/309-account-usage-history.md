# Plan 309: Report deduplicated usage from local tools and connected hosts

- Status: Approved
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/fregat`, server transcript usage and Settings Usage.
- Source: the history portion of [Fregat #345](https://github.com/ShaulLavo/fregat/issues/345).
- Related plans: [141](141-usage-and-rate-limits.md) owns existing recording/imports. [308](308-account-usage-feed.md) owns provider account allowances. They report different quantities.

## Current execution wave (2026-10-03)

[Plan 308](308-account-usage-feed.md) owns the coordinated server-cache/UI/feed delivery under the owner's new bounded-request decision. This wave implements the local Claude/Codex transcript scanner and coverage, independent of registered project discovery, alongside allowance collection. Connected-host composition and other detected tool-format readers remain Approved follow-on increments here; local history must say which sources it covers and never imply all-device completeness.

T3 was fetched and fast-forwarded on 2026-10-03 from `6c8fed35dded9ff71c5b46807125457acbb76be6` to `a7b3ce8c0896d123a7c3f02c586ff8193841cc09`. Read its current usage service, streaming readers, incremental scan cache, aggregation and pricing. Refresh added orchestration-v2 and unrelated desktop/mobile work; no such architecture change is part of this wave.

Quota requests are bounded by Plan 308's single service owner. Local transcript scanning makes no provider requests. Historical Codex quota records remain unattributable after resumed-account changes; transcript token accounting must not invent account identities.

## Outcome

Settings Usage reports usage found in the relevant tools' transcript stores, including work run outside Fregat. It shows which tools and hosts contributed, which could not be read, and how old each result is. Imported, forked, copied, and live recordings count the same billed request once when their identity proves a match.

A history total describes covered transcripts. It does not claim to be the provider's complete account total or subscription spend. Provider percentages remain in Plan 308's account section. Estimated API cost keeps its price source and leaves unknown prices explicit.

## Establish the actual gap

Source inspection used Fregat `46e47cb71`.

- `apps/server/src/provider/usage-history.ts` aggregates `provider_usage_turns` and exposes per-session totals. `provider/routes.ts` serves the history and session routes.
- Plan 141 Phase 4 already imports Claude and Codex usage. `orchestration/session-discovery.ts` imports usage after a discovered session is matched to a checkout. Its unchanged-version cache is in memory. This covers matched imported chats, not every local transcript.
- `provider/utils/imported-usage.ts` already deduplicates Claude message fragments and parses Codex cumulative usage. `provider/usage-import-ledger.ts` records native billing keys across forks within a credential-derived account scope. Reuse proven rules rather than adding a second competing importer.
- Plan 141 records a remaining Codex child-rollout coverage gap. Verify that gap against current adapter readers before extending them.
- `features/settings/components/usage-section.tsx` and its query currently present one Settings owner's recorded history. They expose no source-coverage manifest.
- T3's checked-out reference has `usageTranscriptReader.ts`, `usageScanCache.ts`, `usageTranscripts.ts`, and `usageAggregation.ts`. The reader streams files, resumes appended bytes, and keeps incomplete tails separate. Treat this as design evidence. Refresh the reference before adopting current upstream behavior and record its commit.

First execute a bounded source inventory. Record detected Claude Code, Codex, T3-used native stores, Grok, Cursor, OpenCode, and Antigravity on each already connected host. T3 and a standalone CLI may read the same native store. Count the store once. Unsupported formats, absent tools, inaccessible homes, and unreadable hosts must appear in coverage rather than silently contributing zero.

## Own one history model

Define a normalized usage record with source kind, host identity, provider, model, billing identity, event time, token categories, reported cost, price provenance, and optional Fregat session attribution. Keep paths and prompt/tool contents on the owning host. Return sanitized usage metadata only.

Make billing identity the deduplication key, scoped by proven provider account identity where available. Within one source, use the provider's native request identity and existing fork rules. Across tools and hosts, merge only when the identifiers establish the same billed event. Unknown identity keeps source-scoped records and an explicit coverage limitation. A copied file path, similar timestamp, or equal token count never proves a duplicate.

Separate immutable billed records from changing cumulative observations. Codex cumulative totals produce deltas with reset/fork handling. Claude partial fragments retain the largest reported counters for a billed response. Reasoning already included in output is not added again. A file that disappears does not erase recorded historical use. A detected file rewrite rebuilds that file's contributions atomically so stale records and replacements do not coexist.

Persist a scan cache per host/source/file with parser version, file identity, size/mtime, validated resume position, prefix guard, and reducer state when required. Cache complete lines separately from a trailing partial line. Resume only after the guard matches. A corrupt cache or changed parser version triggers a bounded rescan. Stream large lines and select usage fields without storing prompt contents, including malformed nested metadata containers. Record bytes parsed and records admitted for cold and warm comparisons.

Incremental native JSONL resume assumes append-only writes, as T3's scan cache does. Detect replacements, truncations, same-size edits and prefix/cursor-guard changes and rebuild atomically. An arbitrary same-inode interior rewrite followed by append that preserves both sampled guards is outside this resume contract; detecting every such mutation requires rereading the prior content. Document this constraint in the scanner and delivery evidence. Never claim full arbitrary-rewrite detection or let a partial final line report complete coverage.

Use one scan owner per source. Merge concurrent scan requests, bound work using existing server resource policy, and cancel on shutdown. History reads return the last complete report with scan age/status while refresh runs. Do not perform a full directory scan for every range switch or poll. Changing timezone rebuckets normalized records without reparsing files.

Each connected host exposes a bounded paged projection of its cached normalized records and its source coverage. The Settings consumer queries only environments already live in the existing connection store. Aggregate projections with the same deduplication function across hosts. Never connect, launch, wake, or run a provider CLI to fill history. A disconnected host retains its last cached report with a stale marker, or shows unavailable coverage when none exists. Begin with the existing Settings owner as the local source. Add connected-host composition as the next independently checked step.

Evaluate `ProviderUsageRecorder` after transcript coverage is proven. Keep only records that add verified value, such as ephemeral title/commit generations and per-chat attribution absent from native files. Represent them as separate sources in the same deduplicated model. Retain recorded chat turns for drivers whose native stores this wave does not scan, such as OpenCode, under explicit Fregat-session coverage. Never add covered native turn totals twice or add recorder totals to transcript totals blindly. Remove obsolete aggregate/import paths and tests after every consumer uses the replacement. Follow the repository's no-migration rule for disposable derived cache state.

Reuse the existing price catalog and saved price provenance. A subscription transcript's API-equivalent estimate is labeled as an estimate. Unknown cost remains null and unpriced tokens remain visible. Do not build a new pricing service or scrape provider account endpoints.

## Execute and check each increment

- [x] Reproduce the scope gap with portable native transcripts outside registered projects. Confirm current imported-chat and per-session totals on a known-good fixture. The assertion-specific baseline proof was added retrospectively after implementation existed; its chronology and control results are recorded in Plan 308.
- [ ] Inventory current readers and detected tool stores. Record supported schemas, billing identities, absent sources, and the refreshed T3 reference commit.
- [ ] Define normalized records and the source-coverage contract. Test unknown cost/identity and copied billing identities before changing the report.
- [ ] Extract reusable Claude/Codex parsing and deduplication rules from current import code. Prove existing imported-chat totals remain equal.
- [ ] Add the persistent streaming scan cache. Verify unchanged, appended, truncated, replaced, incomplete-tail, corrupt-cache, and parser-version cases. Measure cold versus unchanged/warm reads on one reproducible generated corpus.
- [ ] Scan Claude/Codex stores independently of project discovery, including subagent stores where readable. Reconcile native and Fregat-only records in one ledger.
- [ ] Add readers for the other detected relevant tool formats from the inventory. Give each a portable fixture and report unsupported versions explicitly. Do not add empty extension points for absent formats.
- [ ] Switch the local history route to cached normalized aggregation. Preserve range/timezone behavior, unknown prices, per-model totals, and valuable session attribution.
- [ ] Add live-connected-host projection composition and global deduplication. Test the same billed event copied to two hosts, independent unknown identities, a stale host, and partial coverage.
- [ ] Update Settings Usage with host/tool coverage and scan age. Keep the previous range's header and body together until the new range is ready. Keep account limits and transcript totals separately labeled.
- [ ] Remove recorder/import paths that now duplicate the canonical history source. Preserve Fregat-only utility generations and session attribution only where tests establish their value.
- [ ] Run narrow server, ledger, parser, and Settings fixture checks. Extend `settings-usage` and `claude-usage-import`; add missing multi-source scenarios and read back `look` evidence.
- [ ] Compare scan bytes, wall time, and memory before/after on the same corpus through the heavy runner. Confirm that range changes read cache and that UI reads cause zero provider calls and zero host launches.
- [ ] Commit and push owned paths, run required gates, deploy changed server/web code, and verify the served history report with its coverage labels. Update the root roadmap and this checklist.

## Local-wave verification receipts

- Native implementation and fixes were independently reviewed at `02772e57a9be2ae74004fe0de639996c4198cb09`; later main integrations preserve the scanner/parser/reducer byte-for-byte. PR [#413](https://github.com/ShaulLavo/fregat/pull/413) squash-merged as `8744d8134c0ade20381e4440b56d4a6003c2ccfe` after exact reviewed `146ba7cb` passed CI `37086951264`; its post-merge substantive jobs passed except the Ghostty browser hang timing out after 20 minutes, leaving aggregate CI red/cancelled. Six other workflows passed. The coordinator's explicit #400 unrelated-Ghostty gate exception applies; Plan 308 records exact outcomes and the dedicated cause-fix owner. Combined service/UI deployment remains pending. Plan 308 owns the exact-head receipts and delivery gate.
- The generated 13,495,890-byte, 3,000-record corpus completed cold in 13 bounded 1 MiB passes (181.95 ms) and restarted warm in 13.69 ms with zero transcript payload bytes. Heavy-wrapper peak memory was 113,565,696 bytes, CPU 532,886 µs, wall 344 ms, exit 0, OOM 0 and no leftover processes; admission waited 39,046 ms and was not quiet. These are narrow cold/restarted-warm results on one corpus, not a generalized before/after performance claim. Receipt: `/work/tmp/fregat-evidence/usage-transcript-history-20261003/02772-cold-warm-resources.jsonl`.
- Final normal/narrow/native UI screenshots were read by the author, original HIGH reviewer and coordinator. The native fixture displays 120 tokens from one file/record, unverified account attribution and unavailable pricing. SDK request counters stayed at two across six account GETs and the background scan/history GET; native turns stayed zero. Evidence directories and exact UI alignment status are in Plan 308.
- Connected-host composition, other tool-format readers, real production coverage and deployment remain unchecked. Arbitrary interior mutations preserving both append guards remain outside the documented resume contract.

## Acceptance and verification

Use OS temporary directories and real fixture files/databases. Native transcripts contain synthetic data. No test requires the owner's accounts, home paths, installed tools, or a particular host. Simulate third-party file formats and network transport at their boundaries, while exercising our real parsers and aggregation.

Prove deduplication under repeat scans, import then live continuation, CLI forks, partial writes, and cross-host copies. Count utility generations once. Verify timezone rebucketing, unknown prices, cache invalidation, cancellation, and last-complete-report retention. Tests for optional installed tools skip with a reason when unavailable. Committed fixtures remain runnable in CI.

The owner sees terminal-created work outside Fregat projects in the covered history. Every total carries its coverage. Missing or stale hosts are visible. The account limit section remains a separate passive observation report. Scans never wake hosts or call provider usage endpoints.

Use `how`, `typescript-best-practices`, `tanstack-query-best-practices`, `verify-fregat`, `technical-writing`, and `unslop` for implementation. Foundational Thinking puts billed-record identity before aggregation. Make Operations Idempotent makes scans and cache replacement repeatable. Sequence Work into Verifiable Units lands parsers, local coverage, and host composition with separate proofs.

Issue closure transfers implementation tracking to this Approved checklist. The unchecked steps remain scheduled work.
