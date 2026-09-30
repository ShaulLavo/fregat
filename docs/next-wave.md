# Wave 2 closeout

## Wave 2 closeout (reconciled 2026-09-28)

The owner identified 099, 156, 179, 114, 126 and 132 as the remaining wave 2 closeout queue.
This record supersedes the original lane ordering for those plans. It is a scheduling
reconciliation, not proof that every other wave item is complete. Do not infer new production
permission from a documentation update; preserve explicit gates and owner-only checks.

Default sequence: **179 → 099 → 114 → 126 → 156**. Independent work can move earlier;
only the dependencies in this table require serialization.

| Plan | Remaining wave 2 delivery                                                                            | Actual dependencies and follow-ups                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 132  | Delivered 2026-09-30: typechecks, native Vite updates, memory/cold-start proof and capture ownership | Mac vibrancy ownership is transferred to 114 Gate 3.                                                                                                                                                |
| 179  | Delivered 2026-09-30 in PR #204: P0 instruments, P3 Mermaid, P5 CSS, P6 isolation rule               | P1/P2/P4 landed earlier. 156 consumes the isolation policy. Physical Mac/iPhone rendering is unconfirmed.                                                                                           |
| 099  | Unit 1 delivered in PR #203. Unit 0's native-input calibration matrix is still running               | Unit 1 includes 198's retained-analysis subscriber. Units 2–7 retain their explicit gate; no repeat SAB deletion.                                                                                   |
| 114  | Gates 1–4: Chromium, native fallback, macOS, Electrobun removal                                      | Preserve mesh ownership; Mac verification precedes removal. Consumes 132 ownership reconciliation, not an obsolete server lease.                                                                    |
| 126  | Bounded proofs merged in PR #210; remaining A–F/J residues                                           | A/D/F and parts of C/J delivered. Desktop cases use 114; independent chat/provider work can move earlier. G/H/I retain follow-up scope, with H pairing and I agent review already partly delivered. |
| 156  | P0 binary guard, P1 PDF, P2 CSV                                                                      | Existing file identity/buffers and 179 policy suffice. P3–P6 are format/review/editing follow-ups; P7 DOCX source editing stays parked on Markdown and fidelity decisions.                          |

The owner superseded the former “198 first after wave 2” rule on 2026-09-28. Reconcile its
landed analysis code alongside 099. Schedule remaining 198 guarantees before the consumers that
need them, without making unrelated shell, Mermaid or PDF work wait. Plan 197's standalone/diff
highlighting is independent; Plan 200 needs the relevant 099/198 contracts and 197's diff service
for its comparison integration. The [root roadmap](../PLAN.md#wave-2-closeout-and-dependency-order)
records those boundaries.

Closeout checklist:

- [x] Refresh the six plan statuses and remove known completed implementation from their queues.
- [x] Replace historical ordering with current ownership/dependency boundaries.
- [ ] Execute remaining authorized units and record focused checks plus applicable live evidence.
      132 and 179 are delivered; the foundations wave below is still open. 114, most of 126 and
      156 P0–P2 have not started.
- [ ] Reconcile owner-only checks and explicit follow-ups before declaring wave 2 complete.

## Foundations wave, 2026-09-30

The owner approved a foundations and closeout wave on 2026-09-30. Its scope: the remaining 179
phases, 099 units 0–1 with 198's foundation contracts, every 197 consumer, and bounded
independent 126 proofs. Full 126, 099 units 2–7, the rest of 198, 114, 156, keymap, TUI,
localization and workspace stayed outside it. The wave is **open** until the checklist below
is done.

GitHub PR numbers are not plan numbers. PR #202 delivered Plan 197 and PR #204 delivered Plan
179; PRs #205–#209 are CI and test repairs unrelated to Plans 205–209.

| PR   | Delivered                                                                                          | Merge       | Shipped in                                      | Limits                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #203 | 099 unit 1 captured-frame publication; 198 configuration/range/cancel/retention contracts          | `cf4e84419` | web `20260930T153009Z-cf4e8441-main`            | 099 unit 0 unfinished; 198 acceptance matrix open                                                                                                           |
| #204 | 179 phases 0, 3, 5 and 6: Mermaid isolation, instruments, CSS, isolation rule                      | `3293142d2` | web `20260930T161942Z-7076858b-main`            | No physical Mac/iPhone check                                                                                                                                |
| #205 | Paged-session hook tests control index invalidation order (test only)                              | `5c8c7310b` | same batch                                      | No product code                                                                                                                                             |
| #206 | Textbuffer CI installs only its package; benchmark control vendored                                | `3a0f097d6` | same batch                                      | npm and matplotlib still need the network; no offline install claim                                                                                         |
| #207 | Deploy builds workspace exports before web type checks                                             | `7076858b1` | same batch                                      | None recorded                                                                                                                                               |
| #202 | 197 highlighting service; editors, previews, Markdown and prepared diffs migrated                  | `bfabd3cb7` | web `20260930T163634Z-bfabd3cb-main`            | WebKit Settings and full typing-trace proofs are in the harness lane; no iPhone run                                                                         |
| #209 | tree-sitter-x update workflow recovers stranded branches and existing PRs                          | `ef44ea220` | CI only                                         | Main run 36748860722 reconciled PR #208, which stays open and unmerged                                                                                      |
| #210 | 126 bounded two-owner lifecycle proofs, fixture Settings repair, silent-terminal guard             | `4edb43b18` | server and web `20260930T173217Z-4edb43b1-main` | Full 126 row ledger, desktop, state-loss and live-account gates stay open                                                                                   |
| #212 | Harness: WebKit Settings shortcut driving; bounded 305-character comment-typing scenario and trace | `c65b3407e` | harness only                                    | Request marks share one interval; no proof of worker overlap, queue wait, reply latency or performance. Function-burst Undo and full-checkout OOM stay open |

The wave coordinator deployed #210 to server and web as `20260930T173217Z-4edb43b1-main` (commit `4edb43b18`,
dirty 0, no pending release, live check passed at 17:32:35Z) and read back a healthy mesh
`look` (`/work/tmp/fregat-evidence/20260930T173300Z-look-platform-1440x1000/`). The five-minute
production log window is not empty: it holds restart disconnects and another session's request
to a wrong release path. The terminal host (pid 2692, build `20260930T153616Z-c47bd174` from
another session's unmerged branch) predates the release and survived the restart. `/release`
still reported this state at 17:57 UTC; peers can advance it, so read it before citing it.
Main `405d70b56` (Git diff paths) and `3ca862a4b` (app-save hot-update skip removed, see 132)
came from other sessions and were independently reviewed after landing; they are not wave work.

Remaining before the wave closes:

- [ ] 099 unit 0: the full expanded native-input calibration, owned by the Plan 099 author
      (`wave/foundations-input-calibration`), who also owns that plan and its proof documents.
      Instrument `dbdaa7ced` runs baseline `2ac20743c` and candidate `3a0f097d6` package sets,
      both frozen with hashed fixtures. Native passes its three controls and holdout, its real
      delayed negative fails all 36 dispatch groups, and its candidate passes the frozen
      108-blocking matrix. The Tree-sitter candidate is running; eight configurations remain.
- [ ] Bounded worker disposal. Shiki's and Tree-sitter's worker owners await a disposal reply
      before `terminate()`, so a busy worker stalls disposal and leaks. The Shiki 1 MB-line
      baseline reproduces it: the worker sat at 100% CPU with no sample in 400 s. A separate
      author (`wave/worker-cleanup`) reproduces it with busy and unresponsive transports and a
      real Chromium worker; no PR yet. It needs independent review and merge.
- [ ] Long-line reconciliation in Plan 099. The five Shiki-bearing configurations (`shiki`,
      `tree-sitter-shiki`, `shiki-minimap`, `all`, `platform`) record the long-line fixture as
      unsupported. That record is baseline evidence only. The plan must reconcile each
      long-line consumer case and keep the original 108-blocking/36-advisory native input
      acceptance. A matrix that excludes those cases cannot close unit 0 or this wave, and
      an in-flight measurement is no claim that long-line syntax settles.
- [x] Harness proof (#212): Playwright WebKit 26.6 opens Settings at 1440×1000 and with touch
      at 390×844, asserting off-screen, dark-only and light previews. A 305-character comment scenario and trace
      record two snippet and 29 document requests, bounded as the #212 row says.
- [ ] The original `editor-type-burst` function typing and Undo probe. An exact restoration
      check failed, but its later failure screenshot shows the original nine lines, so no
      product history defect is established. The full-checkout trace's memory cause is unconfirmed.
      The worker-cleanup author takes this after the disposal fix.
- [x] Server release with #210: `20260930T173217Z-4edb43b1-main`, live check and mesh `look` read.
- [ ] Main CI and the three package mirrors green on the final head, then a final release with
      any remaining wave fixes.
- [ ] Merge this reconciliation after independent review.

Not delivered by this wave: the tree-sitter-x bump in PR #208, 099 units 2–7, 198's acceptance
matrix, the rest of 126, and all of 114 and 156. Physical Mac/iPhone and live-account checks are
unconfirmed throughout.

Current `AGENTS.md` governs shared-checkout work, checks and deployment.

## Historical coordination

The [original lane assignments and coordination rules](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/docs/next-wave.md)
remain in git history. They describe the 2026-09-26 launch, including the original wave 3
split and owner-only checks. They are not a second current task queue.

[The completion-wave record](completion-wave.md) preserves earlier owner decisions and delivery
context. Each surviving plan owns its remaining authorization and acceptance requirements.
