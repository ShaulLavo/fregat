# Cross repository issue triage

The owner's October 3 decisions and current execution tracking are in
[the plan conversion report](issue-plan-conversion-2026-10-03.md). This document retains
the October 2 snapshot. Mesh #107 has since shipped its measured optimization;
Mesh #103 has a live DNS fix, and the fresh #364 build still emits its diagnostic.

Status: Approved. The owner authorized full backlog triage and fixes for small confirmed bugs.
Larger work and closure candidates remain for the owner's go/no-go decisions. This pass
does not authorize every feature described by an issue or reopen previously deferred work.

The initial snapshot contains 46 open issues: Fregat 24, Mesh 21 and Singapore 1.
Ghostty WebGPU, hotkeys and tree-sitter-md have no open issues. Tree-sitter-x's tracker
is disabled; its issues are reported in Fregat. Four issues arrived during execution:
Fregat #383, #386 and #388, and Mesh #109. They are included below, bringing this
review to 50 issues. After six verified fixes were closed, the final API refresh
contains 44 open issues: Fregat 22, Mesh 21 and Singapore 1. The other enabled
trackers in scope remain empty. Singapore, Ghostty and hotkeys fixes
belong in this monorepo. Mesh and tree-sitter-x fixes belong in their own repositories.

## Execution checklist

- [x] Fetch the full issue inventory, including descriptions and comments.
- [x] Verify the combined GitHub search in a browser. It renders 46 issues.
- [x] Record durable scheduling as Mesh #106, status Idea.
- [x] Save the default review scope in the shared agent instructions.
- [x] Reproduce and fix Fregat #381, the queue fixture config response.
- [x] Reproduce and fix Fregat #351, comparison source hashing.
- [x] Investigate Mesh #105 for a small command presentation fix.
- [x] Reproduce and fix Fregat #377, custom-origin gallery font loading.
- [x] Verify and push the Fregat fixes; the web release passed its live check.
- [x] Merge Mesh #108 after its complete PR CI gate passed.
- [x] Reproduce and fix Fregat #383, optional qualification periods.
- [x] Reproduce and fix Fregat #388, nested-address doctor release checks.
- [x] Install the published Mesh build after main CI and release publication.
- [x] Close verified fixes with evidence; leave decision candidates open.
- [x] Refresh issue states and record any concurrent changes before delivery.

## Review order

Review Mesh #74 first because its report describes reachable daemon commands without
client authentication. Fregat #338 and #371 concern job ownership and blocked work.
Singapore #58 contains reproduced tokenizer and worker failures. These deserve focused
follow-up, but their contracts make them larger than the first small-fix batch.

The usage issues share dependencies and should become one coordinated body of work:
account and transcript sources, usage history, then cache diagnostics and optional
allowance projection. Automatic backlog execution needs a separate explicit opt-in.

## Fregat issues

The classifications below are triage judgments from the issue reports and current source
where inspected. They are not claims that every reported failure has been reproduced.

| Issue                                                                                    | Classification     | Next action and decision                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [388](https://github.com/ShaulLavo/fregat/issues/388) Nested-address doctor endpoint     | Fixed and closed   | Preserve the deployment prefix while removing the workspace address. Exercise real CLI captures with root and prefixed nested file URLs.                                                       |
| [386](https://github.com/ShaulLavo/fregat/issues/386) Bun worker structural syntax       | Needs reproduction | Reproduce the reported browser-bundle/Bun-worker mismatch. Verify JSON grammar loading across browser and DOM test environments; the separate dialog assertion has no established causal link. |
| [383](https://github.com/ShaulLavo/fregat/issues/383) Compact GPU qualification          | Fixed and closed   | Preserve probes without display periods. Continue hashing display periods and retain GPU samples and settings.                                                                                 |
| [381](https://github.com/ShaulLavo/fregat/issues/381) Queue fixture config response      | Fixed and closed   | Run the actual fixture over stdio; add the consumed config response and retain unknown-method errors.                                                                                          |
| [377](https://github.com/ShaulLavo/fregat/issues/377) Gallery font CORS                  | Fixed and closed   | Reproduce an explicit-port gallery capture; decide whether gallery capture needs an isolated API or the preload belongs only to the app. Preserve standalone site capture.                     |
| [375](https://github.com/ShaulLavo/fregat/issues/375) First launch local or remote       | One plan           | Produce the requested design choices before implementation. Reuse installed-app filesystem identity rules.                                                                                     |
| [371](https://github.com/ShaulLavo/fregat/issues/371) Quiet-job deadlock                 | One plan           | Define lifecycle ownership for server dependencies and quiet admission; prove the reported three-job cycle in an isolated runner.                                                              |
| [368](https://github.com/ShaulLavo/fregat/issues/368) Resize callback ordering           | Needs reproduction | Combine both callbacks with one synchronous resize in the real renderer; decide supported reentrancy semantics before fixing.                                                                  |
| [364](https://github.com/ShaulLavo/fregat/issues/364) Cached Bun diagnostic              | Needs reproduction | Run one fresh narrow hotkeys build. A replayed cached warning alone does not justify a production change or closure.                                                                           |
| [363](https://github.com/ShaulLavo/fregat/issues/363) Legacy Unicode benchmark crash     | Needs reproduction | Isolate the pinned legacy dependency/probe and retain honest crash evidence. Do not turn a crash into a successful benchmark result.                                                           |
| [360](https://github.com/ShaulLavo/fregat/issues/360) ZWJ emoji widths                   | Needs reproduction | Compare shared native row/grapheme decoding, measured cell widths and font availability before choosing the owner.                                                                             |
| [359](https://github.com/ShaulLavo/fregat/issues/359) Claude pool usage                  | One plan           | Coordinate with #341 and #345. Read passive per-account observations, account for missing/stale readings and avoid inference or waking the proxy.                                              |
| [358](https://github.com/ShaulLavo/fregat/issues/358) Zig atlas residency                | Needs reproduction | Exercise constrained atlas eviction and active glyph reuse in the experimental path; separate correctness from fallback efficiency.                                                            |
| [352](https://github.com/ShaulLavo/fregat/issues/352) Sustained output fixture selection | One plan           | Extend the benchmark workload contract with fixture identity, balanced pairing and the existing tick-resolution safeguards.                                                                    |
| [351](https://github.com/ShaulLavo/fregat/issues/351) Source hash staging sensitivity    | Fixed and closed   | Canonicalize source paths before hashing. Verify unchanged tracked/untracked membership and actual content changes in a disposable Git repository.                                             |
| [350](https://github.com/ShaulLavo/fregat/issues/350) Machine removal and disconnect     | One plan           | Confirm the removal consequences and persistent connection action, then implement and visually verify the settings flow.                                                                       |
| [349](https://github.com/ShaulLavo/fregat/issues/349) Prompt cache rebuild diagnostics   | Needs reproduction | First query recorded turns for repeated rebuilds beyond initial/post-idle turns. Design the notice only after measuring the pattern.                                                           |
| [348](https://github.com/ShaulLavo/fregat/issues/348) Unused allowance and spend backlog | Several plans      | Split passive allowance projection from backlog selection and explicitly opted-in execution. Depends on per-account coverage; collection alone needs no model.                                 |
| [347](https://github.com/ShaulLavo/fregat/issues/347) Automatic machine placement        | One plan           | Define repository availability, eligibility, attachment pinning and load inputs; show the selected target before execution.                                                                    |
| [346](https://github.com/ShaulLavo/fregat/issues/346) Session rail attention             | One plan           | Treat as a product change requiring go/no-go and a visual proof across running, waiting, unread, selected and keyboard-focused states.                                                         |
| [345](https://github.com/ShaulLavo/fregat/issues/345) Account-wide usage history         | Several plans      | Separate transcript collection/deduplication, account limit sources and UI adoption. Coordinate #341 and #359; overlapping scope is not a duplicate.                                           |
| [342](https://github.com/ShaulLavo/fregat/issues/342) Git diff row topology              | One plan           | Reproduce embedded CR/U+2028/U+2029 on the diff surface. Define the display mapping that preserves Git row identity and comments.                                                              |
| [341](https://github.com/ShaulLavo/fregat/issues/341) ChatGPT proxy account feed         | One plan           | Consume Plan 287's passive feed with account freshness and provider identity. Coordinate #345 and #359.                                                                                        |
| [340](https://github.com/ShaulLavo/fregat/issues/340) Held-out evaluation corpus         | One plan, deferred | Implementation owner is tree-sitter-x. Preserve the explicit Phase 2 deferral; select license-cleared evaluation inputs before its gate.                                                       |
| [339](https://github.com/ShaulLavo/fregat/issues/339) Markdown structural pin            | One plan, deferred | Implementation owner is tree-sitter-x. Re-pin against the chosen product revision before a Markdown pilot; this pass does not start Phase 2.                                                   |
| [338](https://github.com/ShaulLavo/fregat/issues/338) Heavy slice-root ownership         | One plan           | Bind an explicit slice root to its ownership registry; use two isolated registries to prove refusal without reaping another job.                                                               |
| [337](https://github.com/ShaulLavo/fregat/issues/337) Non-cache peak memory              | One plan           | Define sampled non-reclaimable peaks and their estimate provenance; measure the accounting effect before claiming throughput gains.                                                            |

## Mesh issues

| Issue                                                                              | Classification                  | Next action and decision                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [109](https://github.com/ShaulLavo/mesh/issues/109) Descriptive service labels     | One plan                        | Add a display-label contract alongside stable routes, then adopt it in the service list and dashboard. Preserve the remaining live URLs; the owner already requested removal of temporary evidence and unused routes. |
| [107](https://github.com/ShaulLavo/mesh/issues/107) Repeated fleet width scans     | Needs reproduction              | Measure the four-host fixture and a scaled fleet before tuning; preserve retained View allocation and geometry checks.                                                                                                |
| [106](https://github.com/ShaulLavo/mesh/issues/106) Durable recurring jobs         | Several plans, Idea             | Review the feature first. Separate durable definitions, executor eligibility, coordination/cancellation and run history. The first consumer can be an ordinary issue-digest script.                                   |
| [105](https://github.com/ShaulLavo/mesh/issues/105) Command over-escaping          | Fixed and closed                | Trace formatting and sanitization through catalog, dashboard and picker. Prove readable commands and safe control-character handling together.                                                                        |
| [103](https://github.com/ShaulLavo/mesh/issues/103) App URL without DNS            | Needs reproduction              | Check publication and private-name reconciliation in the deployed version. Determine whether naming, reconciliation or readiness reporting owns the failure.                                                          |
| [101](https://github.com/ShaulLavo/mesh/issues/101) Mac screen/window permissions  | Closure candidate               | Appears to duplicate #100's same incident and grant requirements. Keep #100 as the feature owner and preserve any additional permission evidence when consolidating.                                                  |
| [100](https://github.com/ShaulLavo/mesh/issues/100) Remote screenshots and windows | Several plans                   | Resolve macOS responsible-process/TCC behavior, then owner-authorized capture/window commands and Linux support. #101 appears to overlap.                                                                             |
| [98](https://github.com/ShaulLavo/mesh/issues/98) Pi resolver timeout              | Needs reproduction              | Repeat the bounded Go/glibc comparison and attribute DNS versus dial before changing download timeouts.                                                                                                               |
| [93](https://github.com/ShaulLavo/mesh/issues/93) Local host name on dashboard     | Needs reproduction              | Verify on a host whose alias differs from its OS name. Coordinate the fallback fix with #86's machine identity work.                                                                                                  |
| [92](https://github.com/ShaulLavo/mesh/issues/92) Kill then remove race            | Needs reproduction              | Reproduce remote terminal-state settlement. A lifecycle fix needs the integration gates required by Mesh's instructions.                                                                                              |
| [89](https://github.com/ShaulLavo/mesh/issues/89) Old helper owns cancellation     | One plan                        | Confirm current installed helper state and recovery ownership; design recovery from already-stuck state, beyond fixing future helpers.                                                                                |
| [87](https://github.com/ShaulLavo/mesh/issues/87) Darwin update health failures    | Needs reproduction              | Preserve exact daemon/worker incarnations and version evidence; attribute socket readiness and rollback independently.                                                                                                |
| [86](https://github.com/ShaulLavo/mesh/issues/86) One identity per machine         | Several plans                   | Split authoritative naming/protocol, collision/propagation rules and CLI/dashboard adoption; coordinate #93.                                                                                                          |
| [81](https://github.com/ShaulLavo/mesh/issues/81) Remove public sharing            | One plan, existing direction    | Preserve the requested removal and private artifact pill. Inventory public-only paths before deleting them; no closure as unwanted work.                                                                              |
| [80](https://github.com/ShaulLavo/mesh/issues/80) Fleet read deadlines             | Needs reproduction              | Low priority. Correlate reads with daemon activation and bounded recovery; no timeout increase based on an unconfirmed report.                                                                                        |
| [79](https://github.com/ShaulLavo/mesh/issues/79) Installed binary PATH            | Needs reproduction              | Compare installed path, shell startup and exact executable provenance; separate installer defects from host-local configuration.                                                                                      |
| [78](https://github.com/ShaulLavo/mesh/issues/78) Fixture SIGKILL                  | Needs reproduction, constrained | The issue explicitly requests attribution only, with no further reproduction campaign. Preserve that limit and use existing provenance.                                                                               |
| [77](https://github.com/ShaulLavo/mesh/issues/77) Worker after suite cleanup       | Needs reproduction              | Identify the owning fixture and exact exit time in an isolated suite; the later absence does not establish the cause.                                                                                                 |
| [76](https://github.com/ShaulLavo/mesh/issues/76) Worker readiness timeouts        | Needs reproduction              | Attribute each fixture's process/socket state and resource pressure; do not weaken readiness assertions to make the suite green.                                                                                      |
| [75](https://github.com/ShaulLavo/mesh/issues/75) ZeroTier support                 | One plan, blocked dependency    | Review after daemon control authentication #74. Define network reachability and authorization separately.                                                                                                             |
| [74](https://github.com/ShaulLavo/mesh/issues/74) Daemon authentication            | One plan, highest priority      | Define authenticated control connections and owner authorization, including existing fleet/root-daemon behavior; verify denied callers.                                                                               |
| [55](https://github.com/ShaulLavo/mesh/issues/55) App logs and startup results     | One plan, already Approved      | Retain its existing execution order. Build inspectable failures, output and honest readiness on private apps, coordinated with #103.                                                                                  |

## Singapore issue

| Issue                                                                       | Classification | Next action and decision                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [58](https://github.com/ShaulLavo/singapore/issues/58) Spellcheck hardening | Several plans  | Fix in Fregat's Editor packages. Separate tokenizer bounds and worker settlement from measured underline rendering and optional multilingual support. Verify current source against the reviewed revision first. |

## Fix receipts

Fregat #381 and #351 are fixed in `1ce21d281` and closed with evidence comments.
The queue protocol regression failed before the fix with `Unsupported queue fixture method
config/read`; all 31 native-fixture tests pass afterward. The real `chat-queue` scenario
completed all eight steps and its retained JSONL contains no config-read failure. Its
screenshots were read back. Evidence: `/work/tmp/fregat-evidence/20261002T191853Z-scenario-chat-queue/`.

The comparison provenance regression used a real disposable Git repository and failed
before the fix when unchanged source moved from untracked to staged. Both source-hash tests
pass afterward and run in the normal Ghostty unit-test configuration. A real comparison
bundle also built successfully. Whole-tree gates and all workspace typechecks passed.
The web deployment `20261002T192819Z-1ce21d28-main-dad80423` passed its live check. No server
restart was needed for these tooling changes.

Fregat #377 reproduced through a disposable custom-port proxy to the shared Vite server.
The shared Vite origin was a healthy control; the custom origin produced the reported
font CORS error. Gallery captures now use a throwaway API, and the same custom-origin
capture reports no problems. A standalone static capture also passes. The isolated-server
contract test passes. The verification script was session-scoped and is not committed.
The fix was committed and pushed as `0606b17a7`; whole-tree gates and all workspace
typechecks passed. Before evidence: `/work/tmp/fregat-evidence/20261002T193140Z-look-dev-390x844/`.
After evidence: `/work/tmp/fregat-evidence/20261002T193212Z-look-dev-390x844/`.

Fregat #383 and #388 were committed and pushed as `cf190043c`, then closed with
reproduction and verification comments. Fregat #377 was also closed with its evidence.
The final fix batch passed whole-tree gates, workspace builds and all workspace typechecks.

Fregat #383 failed with `ERR_INVALID_ARG_TYPE` when a valid GPU qualification omitted
display periods. Compact analysis now hashes periods only when they are present and
preserves the remaining probe evidence. All 16 attribution tests pass.

Fregat #388 failed both nested-address real-CLI cases because no request reached the
correct release endpoint. The API base now strips the workspace address while preserving
the deployment prefix. All 16 doctor cases pass, including existing loading, MIME,
console-capture and release-failure checks.

Mesh #105's quote, repeated-presentation and dashboard-row regressions failed before
its fix. `go test -race ./internal/cli ./internal/tui` and the staged/full quality gates
passed afterward. [Mesh PR 108](https://github.com/ShaulLavo/mesh/pull/108) passed its complete
CI gate and merged as `4b54cd9c`. The root cause was repeatedly escaping printable quotes
and backslashes; the sanitizer now preserves graphic characters while escaping controls.
The dashboard text fixture was rendered and its screenshot read back. Main CI and the
release compatibility checks for Linux AMD64, Linux ARM64 and macOS ARM64 all passed.
The official `v0.1.131` release names commit `4b54cd9c06136551dc473f86424cfa9402bb64e3`.
`mesh update --local --version v0.1.131 --yes` installed it on this host and verified its
daemon. Eight running sessions were preserved with their older workers. Other hosts and
already-running dashboard processes were not updated by this local installation. The
temporary evidence route was removed during the owner's concurrent service review; the
fixture output remains in `/work/tmp/fregat-evidence/20261002-issue-triage/`.

## Continuing review

GitHub remains the issue source of truth. This file is the dated first-pass decision record.
A recurring collector should fetch every page, preserve source repository and implementation
owner, report new/changed/closed issues since the last acknowledged review and retain an
unreviewed backlog. A failed repository fetch must be reported as incomplete collection.
Collection and diffing use ordinary script work. Agent investigation begins when the owner
requests it. Automatic closure needs an explicit rule and evidence of resolution.

The original `/issues?q=...` link was not browser-verified and failed. The verified route is
`https://github.com/search?type=issues&q=...`, using repeated `repo:` qualifiers. This pass
read back the search screenshot showing 46 results. No recurring job has been installed.
