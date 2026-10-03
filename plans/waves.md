# Work waves

Updated 2026-10-03. [PLAN.md](../PLAN.md) owns execution order across packages and clients.
A wave groups related work for delivery. Its closure applies to its approved batch; each
owning plan retains unfinished units, deferred scope and acceptance gates.

This register preserves the batches and their membership. Read the linked delivery records
for receipts and the owning plans for current status. Old lane assignments, ports, worktrees
and concurrency rules describe their original runs.

## Batch register

| Batch                               | Disposition                                                               | Membership and retained work                                                                                                                                                                  | Record                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Completion wave, September 25       | Historical delivery/coordination record                                   | L0–L9 retain their original queues. Surviving work stays in the indexed owning plans, including 126, 139–145, 147, 172 and the Editor inventory.                                              | [Original lanes and decisions](../docs/completion-wave.md)                                                                                                                     |
| Wave 2, September 26 launch         | Bounded closeout closed October 2; desktop acceptance completed October 3 | 132/179 delivery, 099 units 0–1 disposition, 114 acceptance, bounded 126 proofs and 156 P0–P2. 099 units 2–7, 198 acceptance, 126 residual/account checks and 156 P3+ remain in their plans.  | [Closeout and evidence](../docs/next-wave.md), [original full membership](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/docs/next-wave.md) |
| Foundations, September 30           | Closed October 1 with partial calibration disposition                     | 179 remaining isolation phases, 099 units 0–1, 198 foundation contracts, 197 highlighting and bounded 126 proofs. 282 replaces unfinished 099 calibration; its acceptance remains open.       | [Delivery and partial calibration](../docs/next-wave.md#foundations-wave-2026-09-30)                                                                                           |
| Package consolidation, September 30 | Source move delivered; publication separately deferred                    | 207's Editor, Ghostty and hotkeys source/mirror cutover. 204/205 retain standalone hotkeys installation/publication prerequisites.                                                            | [207](207-one-repo-with-mirrors.md), [delivery record](207-migration-completion.md)                                                                                            |
| Original wave 3                     | Retained follow-on grouping, now scheduled through current programs       | Parser/Markdown/composer, plugins, native intelligence, tree, phone/site, rich documents and T3 residues. Exact surviving membership is below.                                                | [Original wave 3](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/docs/next-wave.md#wave-3-what-wave-2-unblocks)                             |
| October 2 issue triage              | Dated decisions and small-fix delivery                                    | Source issues, implementation owners, reproduction needs and larger work carried into October 3 plans.                                                                                        | [Triage](issue-triage-2026-10-02.md)                                                                                                                                           |
| October 3 issue-to-plan conversion  | Planning/transfer delivered; implementation checklists remain open        | 290–318 retain 29 approved scopes. Closing an issue for transfer preserves its unfinished work in its linked plan.                                                                            | [Source-to-plan mapping](issue-plan-conversion-2026-10-03.md)                                                                                                                  |
| October 3 remaining issues          | Execution pass delivered; eight investigations retained                   | Nine reports closed. Eight keep their specific unknown causes or missing baselines. Gateway safe reload/live receipt remains explicit until completed or reconciled through 308 retirement.   | [Outcomes, issue links and evidence](remaining-issues-resolution-2026-10-03.md)                                                                                                |
| Keymap and Zed/Vim programs         | Approved next structural cutover and dependent work                       | 204 + 205 → 206, then bindings for 220–271 and 274–280. 272/273 preserve excluded inventory. Existing feature-owner gates remain.                                                             | [Root ordering](../PLAN.md#next-programs), [Zed workstream](../PLAN.md#zed-parity-workstream)                                                                                  |
| October additions                   | Retained with individual timing                                           | 281–287 terminal/performance follow-ups; 308 replaces 289's producer; 320 compile-time proof; 335 current icon phases with later packs. 288, 319, 327 and 328–334 remain explicitly deferred. | [Current and deferred programs](../PLAN.md)                                                                                                                                    |

## Upcoming waves

126's bounded Wave 2 scope is closed. The owner's [finite pre-keymap
pass](126-t3code-alignment/finite-closeout-2026-10-03.md) updates its ledger and disposition;
the larger alignment program remains in separately scheduled follow-ons.

The [root delivery-wave table](../PLAN.md#upcoming-delivery-waves) schedules preparation,
command foundation, document foundation, coherent feature batches and broad migrations.
The [readiness review](wave-readiness-2026-10-03.md) explains placement of the large additions.
Use those current dependencies when drawing work from the historical batches below.

## Original wave 3 membership

The former batch remains useful as a work grouping. Each row links its current owner;
it carries no additional implementation authorization or fixed lane assignment.

| Original scope                              | Current owner and boundary                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser improvements after the Markdown lane | [189](189-tree-sitter-md-improvement.md) follows [176](176-markdown-parser.md)'s release/integration gates. [317](317-tree-sitter-phase-two-prerequisites.md) preserves the stopped parser Phase 2 preparation. |
| Composer and visual Markdown                | [171](171-composer-on-our-editor.md), [111](111-editor-decorations.md) P4–P5 → [108](108-markdown-modes.md) P2–P3. Reconcile delivered authoring work first.                                                    |
| Document/plugin runtime                     | [122](122-composable-plugins.md) P6–P9 and [E025](e025-runtime-plugins.md), with [099](099-document-contributions.md)'s runtime gates and the [Editor inventory](editor-backlog.md)'s hook dependencies.        |
| Native code intelligence                    | [088](088-native-code-intelligence.md) after [087](087-stateless-mcp.md)'s required contracts. This is separate from the native Swift client.                                                                   |
| Tree drag-and-drop and cleanup              | [178](178-tree-in-the-app.md) and its linked sub-plans; retain the app-owned state and parity gates.                                                                                                            |
| Phone and animated site                     | [143](143-phone-layout.md) P5–P6 and [155](155-site-demo-replica.md), with 155 after the relevant 143 work and explicit device checks.                                                                          |
| Rich documents                              | [156](156-documents-in-the-editor.md) P3–P6; P0–P2 are delivered. DOCX editing retains its Markdown/fidelity gate.                                                                                              |
| T3 providers, remote and forge residues     | [126](126-t3code-alignment.md) G/H/I remaining rows. Use its current ledger to distinguish shipped pairing/review from real residual work.                                                                      |
| Prefetch follow-up if still needed          | [177](177-prefetch-every-press.md) P3, with delivered phases reconciled before execution.                                                                                                                       |

## Longer product waves and inventories

Keep [Editor parity E0–E9](editor-parity-implementation-plan.md),
[beyond-parity H1–H3](editor-1000-parity-plan.md), [Logseq parity](logseq-parity-implementation-plan.md),
the [61-entry Editor inventory](editor-backlog.md) and the
[native editor-first breakdown](native-plan-of-plans.md). They preserve wanted work and research.
Current numbered approvals govern changed decisions, including localization, notebooks,
settings profiles and extension lifecycle. Their group labels do not establish a second schedule.

## Updating a batch

Add new work to its owning plan and [index](README.md), then place its timing or dependency
in [PLAN.md](../PLAN.md). Update this register when batch membership or disposition changes.
Record partial delivery explicitly. Preserve the source links, accepted decisions and remaining
checks when closing a wave. Run `bun run plans:check` before publishing.
