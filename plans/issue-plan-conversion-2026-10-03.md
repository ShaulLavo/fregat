# Issue plan conversion, October 3, 2026

Status: APPROVED

The owner approved converting wanted backlog work into execution plans and closing its source issues after the plans are published. This pass transfers tracking into the root roadmap. The implementation checklists remain open until the work ships.

## Wave checklist

- [x] Read planning and delegation instructions and separate writer worktrees.
- [x] Read current issue bodies, comments, and existing plan inventory.
- [x] Write and review Mesh access, private services, networking, and durable jobs plans.
- [x] Write and review Mesh recovery, install, lifecycle, identity, GUI, and app plans.
- [x] Write and review spellcheck, JSON worker, and diff plans.
- [x] Write and review usage, allowance, and machine placement plans.
- [x] Write and review heavy job, onboarding, attention, and grammar prerequisite plans.
- [x] Index approved plans and their execution order.
- [x] Check, commit, and push the plans.
- [x] Close transferred issues with published plan links and verify their state.
- [x] Record shipped work, closure decisions, and issues left for the next pass.

## Decisions

- Mesh #74 authenticates device keys at the receiving daemon. Approval grants access to that daemon's OS account. Root access needs an explicit root-owned receiver. Mesh #81 removes public-sharing machinery and remains separate work.
- Screenshot permission remains part of Mesh #100. Mesh #101 transfers its permission evidence into that plan.
- Mesh #107 is already fixed. Its closing comment links PR #111 and measured improvements. Preserve performance investigations and measure them before deciding their value.
- Mesh #103 has a verified live DNS fix. Transfer the remaining URL-resolution diagnostic into the private app plan before closing it.
- Fregat #359 is already closed. The Claude pool stays disabled. Plan 289 owns the passive gateway feed, and the usage consumer plan must retain single-login Claude visibility.
- Fregat #389 is already closed. Do not create duplicate implementation work without evidence of a remaining defect.
- Mesh #80 is an approved low-priority closure. Fregat #364 was a closure candidate, but the fresh uncached Bun 1.4.2 build reproduced its diagnostic and emitted a bundle with exit 0. Its [new evidence](https://github.com/ShaulLavo/fregat/issues/364#issuecomment-5962060573) keeps it open for the next investigation pass.
- Automatic quota-driven agent launches are excluded. Allowance visibility and ordinary recurring issue collection retain the owner's go/no-go control.
- The remaining reproduction and benchmark investigations stay open for the next pass.

## Planning ledger

| Track                              | Writer    | State                                 |
| ---------------------------------- | --------- | ------------------------------------- |
| Mesh access and durable jobs       | mesh_core | Plans 290–295 reviewed and integrated |
| Mesh operations                    | mesh_ops  | Plans 296–302 reviewed and integrated |
| Editor correctness and performance | editor    | Plans 303–307 reviewed and integrated |
| Usage and placement                | usage     | Plans 308–311 reviewed and integrated |
| Heavy jobs and product workflows   | workflows | Plans 312–318 reviewed and integrated |

Five writers produced 29 Approved plans in isolated worktrees. The root reviewed all plans.
A separate reviewer covered Plans 290–307 and 312–318. Its collector-state finding is fixed:
Plans 293–295 now preserve the review acknowledgement, complete observation, and publication
outbox through replicated checkpoints, with no local fallback during quorum loss.

## Issue-to-plan mapping

Closing these issues transfers their remaining work into the unchecked Approved execution
checklists. Shipped components retain their existing evidence. Implementation does not become
complete when an issue is closed for this transfer.

| Original report                                                                                                                                                        | Implementation owner | Approved plans                                                                                                             | Tracking state               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [fregat #337](https://github.com/ShaulLavo/fregat/issues/337) Heavy jobs: record non-cache peak memory for admission estimates                                         | Fregat               | [314](314-heavy-non-cache-memory.md)                                                                                       | Closed; transferred to plans |
| [fregat #338](https://github.com/ShaulLavo/fregat/issues/338) Heavy jobs: reject two state directories claiming the same explicit --slice-root                         | Fregat               | [312](312-heavy-slice-ownership.md)                                                                                        | Closed; transferred to plans |
| [fregat #339](https://github.com/ShaulLavo/fregat/issues/339) tree-sitter-x: re-pin tree-sitter-md structural manifest before a Markdown pilot                         | tree-sitter-x        | [317](317-tree-sitter-phase-two-prerequisites.md)                                                                          | Closed; transferred to plans |
| [fregat #340](https://github.com/ShaulLavo/fregat/issues/340) tree-sitter-x: add a licensed held-out evaluation corpus before the Phase 2 gate                         | tree-sitter-x        | [317](317-tree-sitter-phase-two-prerequisites.md)                                                                          | Closed; transferred to plans |
| [fregat #341](https://github.com/ShaulLavo/fregat/issues/341) Usage meter: adopt Plan 287 proxy feed to show every rotating ChatGPT account                            | Fregat               | [308](308-account-usage-feed.md)                                                                                           | Closed; transferred to plans |
| [fregat #342](https://github.com/ShaulLavo/fregat/issues/342) Diff rows split on lone CR and Unicode line separators inside a git line                                 | Fregat               | [307](307-diff-row-topology.md)                                                                                            | Closed; transferred to plans |
| [fregat #345](https://github.com/ShaulLavo/fregat/issues/345) Usage: Settings › Usage shows only Fregat's own turns; show account-wide usage like T3 Code              | Fregat               | [308](308-account-usage-feed.md), [309](309-account-usage-history.md)                                                      | Closed; transferred to plans |
| [fregat #346](https://github.com/ShaulLavo/fregat/issues/346) Session rail: running sessions recede so finished and waiting ones stand out                             | Fregat               | [316](316-session-attention.md)                                                                                            | Closed; transferred to plans |
| [fregat #347](https://github.com/ShaulLavo/fregat/issues/347) New chat: an Auto machine choice that places the session on the least-busy connected machine             | Fregat               | [311](311-automatic-machine-placement.md)                                                                                  | Closed; transferred to plans |
| [fregat #348](https://github.com/ShaulLavo/fregat/issues/348) Usage meter: show allowance that will reset unused, and offer a backlog to spend it                      | Fregat               | [310](310-allowance-visibility.md)                                                                                         | Closed; transferred to plans |
| [fregat #350](https://github.com/ShaulLavo/fregat/issues/350) Machine settings: Remove has no confirmation and Disconnect does not say it lasts                        | Fregat               | [318](318-machine-connection-controls.md)                                                                                  | Closed; transferred to plans |
| [fregat #371](https://github.com/ShaulLavo/fregat/issues/371) Heavy jobs: a --quiet job deadlocks behind a long-running server job whose own follow-up waits behind it | Fregat               | [313](313-heavy-quiet-lifecycle.md)                                                                                        | Closed; transferred to plans |
| [fregat #375](https://github.com/ShaulLavo/fregat/issues/375) First launch: choose a local folder or connect a remote machine                                          | Fregat               | [315](315-local-remote-onboarding.md)                                                                                      | Closed; transferred to plans |
| [fregat #386](https://github.com/ShaulLavo/fregat/issues/386) Tree-sitter browser worker takes Node fs branch in Bun happy-dom tests and loses JSON structural syntax  | Fregat               | [306](306-bun-json-worker.md)                                                                                              | Closed; transferred to plans |
| [mesh #55](https://github.com/ShaulLavo/mesh/issues/55) Make temporary apps easy to inspect: logs, progress, and clear startup results                                 | Mesh                 | [302](302-mesh-private-app-observability.md)                                                                               | Closed; transferred to plans |
| [mesh #74](https://github.com/ShaulLavo/mesh/issues/74) Security: authenticate daemon control connections before accepting session commands                            | Mesh                 | [290](290-mesh-device-authorization.md)                                                                                    | Closed; transferred to plans |
| [mesh #75](https://github.com/ShaulLavo/mesh/issues/75) Support ZeroTier adoption and daemon listeners after control authentication                                    | Mesh                 | [292](292-mesh-zerotier.md)                                                                                                | Closed; transferred to plans |
| [mesh #79](https://github.com/ShaulLavo/mesh/issues/79) [Unconfirmed installer ownership] Installed mesh is missing or shadowed on SSH/login PATH                      | Mesh                 | [297](297-mesh-installer-path.md)                                                                                          | Closed; transferred to plans |
| [mesh #81](https://github.com/ShaulLavo/mesh/issues/81) Remove public app sharing; preserve the floating artifact pill                                                 | Mesh                 | [291](291-mesh-private-services.md)                                                                                        | Closed; transferred to plans |
| [mesh #86](https://github.com/ShaulLavo/mesh/issues/86) One identity per machine: a name the machine owns, shown the same everywhere                                   | Mesh                 | [300](300-mesh-machine-identity.md)                                                                                        | Closed; transferred to plans |
| [mesh #87](https://github.com/ShaulLavo/mesh/issues/87) [Unconfirmed cause] Darwin update health: v117 worker socket timeout and missing v118 rollback daemon socket   | Mesh                 | [296](296-mesh-update-recovery.md)                                                                                         | Closed; transferred to plans |
| [mesh #89](https://github.com/ShaulLavo/mesh/issues/89) Update: #85's gate fix can't free a host that's already stuck, because the old helper owns cancel              | Mesh                 | [296](296-mesh-update-recovery.md)                                                                                         | Closed; transferred to plans |
| [mesh #92](https://github.com/ShaulLavo/mesh/issues/92) mesh rm right after mesh kill on a remote host says the session is still detached                              | Mesh                 | [299](299-mesh-session-removal.md)                                                                                         | Closed; transferred to plans |
| [mesh #93](https://github.com/ShaulLavo/mesh/issues/93) dashboard on the Mac titles its own card with the OS hostname instead of the fleet alias                       | Mesh                 | [300](300-mesh-machine-identity.md)                                                                                        | Closed; transferred to plans |
| [mesh #98](https://github.com/ShaulLavo/mesh/issues/98) Pi: release download times out at 5 s with Go's resolver under Tailscale MagicDNS (cgo resolver works)         | Mesh                 | [298](298-mesh-download-dns-recovery.md)                                                                                   | Closed; transferred to plans |
| [mesh #100](https://github.com/ShaulLavo/mesh/issues/100) Screenshots and window list for agents on a host (macOS TCC: Screen Recording, Accessibility)                | Mesh                 | [301](301-mesh-gui-inspection.md)                                                                                          | Closed; transferred to plans |
| [mesh #101](https://github.com/ShaulLavo/mesh/issues/101) macOS sessions can't capture the screen or read windows (no Screen Recording / Accessibility grant)          | Mesh                 | [301](301-mesh-gui-inspection.md)                                                                                          | Closed; transferred to plans |
| [mesh #103](https://github.com/ShaulLavo/mesh/issues/103) mesh app create returns a URL with no DNS record (<id>.shaulavo.dev doesn't resolve)                         | Mesh                 | [302](302-mesh-private-app-observability.md)                                                                               | Closed; transferred to plans |
| [mesh #106](https://github.com/ShaulLavo/mesh/issues/106) Idea: durable recurring jobs with failover across Mesh devices                                               | Mesh                 | [293](293-mesh-durable-job-state.md), [294](294-mesh-job-coordination.md), [295](295-cross-repository-issue-collection.md) | Closed; transferred to plans |
| [singapore #58](https://github.com/ShaulLavo/singapore/issues/58) Spellcheck hardening: long-token stalls, worker failures, rendering cost, and language support       | Fregat Editor        | [303](303-spellcheck-correctness.md), [304](304-spellcheck-rendering-cost.md), [305](305-spellcheck-language-support.md)   | Closed; transferred to plans |

## Closed or already shipped

- Mesh #80 closes by the owner's low-priority decision. Its two historical read warnings do not establish a shared cause or a persistent outage. No timeout increase or session pruning is authorized by that closure.
- Mesh #107 remains closed with its measured fix in [PR #111](https://github.com/ShaulLavo/mesh/pull/111), commit `9f27816b96d8b23491703bbd4c04e6d2564b4d7a`.
- Fregat #359 remains closed. Plan 308 retains single-login Claude visibility through Plan 289, with pooling disabled.
- Fregat #389 remains closed. Its timeline references PRs #382 and #393. This planning pass makes no new claim about runtime verification for that already-closed ticket.

## Next investigation pass

Leave these open until their focused reproduction or measurement work runs:

- Fregat [#349](https://github.com/ShaulLavo/fregat/issues/349), [#352](https://github.com/ShaulLavo/fregat/issues/352), [#358](https://github.com/ShaulLavo/fregat/issues/358), [#360](https://github.com/ShaulLavo/fregat/issues/360), [#363](https://github.com/ShaulLavo/fregat/issues/363), [#364](https://github.com/ShaulLavo/fregat/issues/364), [#368](https://github.com/ShaulLavo/fregat/issues/368), [#390](https://github.com/ShaulLavo/fregat/issues/390), [#391](https://github.com/ShaulLavo/fregat/issues/391), [#395](https://github.com/ShaulLavo/fregat/issues/395).
- Mesh [#76](https://github.com/ShaulLavo/mesh/issues/76), [#77](https://github.com/ShaulLavo/mesh/issues/77), [#78](https://github.com/ShaulLavo/mesh/issues/78).

The fresh #364 build reproduces the Bun diagnostic with exit 0 and a 17.37 KB bundle. Its
functional impact remains unconfirmed. No repeated full-suite campaign or additional agent
launch is part of this next-pass record.

## Delivery

Four additional issues arrived during planning. They remain open for the next pass and were
not converted or implemented here:

- [fregat #400](https://github.com/ShaulLavo/fregat/issues/400) ghostty-webgpu: browser tests intermittently hang CI after terminal-ui.browser.test.ts.
- [fregat #398](https://github.com/ShaulLavo/fregat/issues/398) Investigate extra Zig builds/uploads without native submissions in rolling WebGL trace.
- [mesh #117](https://github.com/ShaulLavo/mesh/issues/117) CI: pinned actions still declare deprecated Node.js 20.
- [mesh #115](https://github.com/ShaulLavo/mesh/issues/115) Unconfirmed integration flake: release transition worker cannot exec /bin/sh (EPERM).

Published planning commit: `2ac01c3ad911219949fadd2b77b43d9251ad4046`.
The narrow inventory and link checks passed for all 29 plans. Required pre-commit formatting,
whole-tree gates, 24 workspace builds, and repository typechecks passed.

The final API refresh verifies 30 source issues closed with plan links, plus Mesh #80 closed by
the owner's drop decision. Seventeen issues remain open: twelve in Fregat and five in Mesh.
Singapore, Ghostty WebGPU, hotkeys, and tree-sitter-md have no open issues; tree-sitter-x keeps
its tracker disabled. Evidence is retained in
`/work/tmp/fregat-evidence/20261003-issue-plan-conversion/`.

This pass writes plans and updates tracking. Runtime implementation remains in the Approved
checklists. No scheduler was registered, no recurring agent launch was enabled, and no UI
implementation or browser scenario was changed. The mesh web release uses the repository's
normal deployment and live-check path after this delivery record is pushed.
