# Wave 2 closeout

## Wave 2 closeout (reconciled 2026-09-28)

The owner identified 099, 156, 179, 114, 126 and 132 as the remaining wave 2 closeout queue.
This record supersedes the original lane ordering for those plans. It is a scheduling
reconciliation, not proof that every other wave item is complete. Do not infer new production
permission from a documentation update; preserve explicit gates and owner-only checks.

Default sequence: **179 → 099 → 114 → 126 → 156**. Independent work can move earlier;
only the dependencies in this table require serialization.

| Plan | Remaining wave 2 delivery                                                                                 | Actual dependencies and follow-ups                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 132  | Delivered 2026-09-30: typechecks, native Vite updates, memory/cold-start proof and capture ownership      | Mac vibrancy ownership is transferred to 114 Gate 3.                                                                                                                                                |
| 179  | Delivered 2026-09-30 in PR #204: P0 instruments, P3 Mermaid, P5 CSS, P6 isolation rule                    | P1/P2/P4 landed earlier. 156 consumes the isolation policy. Physical Mac/iPhone rendering is unconfirmed.                                                                                           |
| 099  | Unit 1 delivered in PR #203. Unit 0 is partial (5/10) in PR #224; 282 replaces the unfinished calibration | Unit 1 includes 198's retained-analysis subscriber. Units 2–7 retain their explicit gate; no repeat SAB deletion.                                                                                   |
| 114  | Gates 1–4: Chromium, native fallback, macOS, Electrobun removal                                           | Preserve mesh ownership; Mac verification precedes removal. Consumes 132 ownership reconciliation, not an obsolete server lease.                                                                    |
| 126  | Bounded proofs merged in PR #210; remaining A–F/J residues                                                | A/D/F and parts of C/J delivered. Desktop cases use 114; independent chat/provider work can move earlier. G/H/I retain follow-up scope, with H pairing and I agent review already partly delivered. |
| 156  | P0 binary guard, P1 PDF, P2 CSV                                                                           | Existing file identity/buffers and 179 policy suffice. P3–P6 are format/review/editing follow-ups; P7 DOCX source editing stays parked on Markdown and fidelity decisions.                          |

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
      132 and 179 are delivered; the foundations wave below is closed. 114, most of 126 and
      156 P0–P2 have not started.
- [ ] Reconcile owner-only checks and explicit follow-ups before declaring wave 2 complete.

## Foundations wave, 2026-09-30

Status: Closed, 2026-10-01. Approved scope delivered with the partial calibration disposition
recorded in PR #224. This closes the foundations wave, not all of wave 2 or the programs below.

The owner approved the remaining 179 phases, 099 units 0–1 with 198's foundation contracts,
197's service and consumers, and bounded independent 126 proofs. Full 126, 099 units 2–7,
198's remaining acceptance, 114, 156, keymap, TUI, localization and workspace retain their own
scope and gates. The [root roadmap](../PLAN.md#next-programs) retains their execution order.
Closure authorizes no additional work.

### Delivered scope

| Delivery                                                                                                                                                                                 | Result                                                                                                                             | Remaining limits                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [#203](https://github.com/ShaulLavo/fregat/pull/203), 099 unit 1 and 198 foundations                                                                                                     | Canonical revision-tagged frames feed retained analysis; configuration, range, cancellation and retention contracts proved         | 198's full browser/memory acceptance remains open                                                  |
| [#204](https://github.com/ShaulLavo/fregat/pull/204), 179                                                                                                                                | Content isolation, Mermaid measurement/display boundaries and measured CSS repairs delivered                                       | Physical Mac/iPhone rendering unconfirmed                                                          |
| [#202](https://github.com/ShaulLavo/fregat/pull/202) and [#212](https://github.com/ShaulLavo/fregat/pull/212), 197                                                                       | Editor owns document, preview, Markdown and prepared-diff highlighting; WebKit Settings and bounded comment-typing proofs recorded | Request marks prove one interval, with no worker occupancy, queue-wait or reply-latency comparison |
| [#210](https://github.com/ShaulLavo/fregat/pull/210), bounded 126                                                                                                                        | Two-owner lifecycle proofs, fixture Settings repair and silent-terminal cleanup guard delivered                                    | Broad row ledger, desktop, LIFE-06 state-loss and live-account checks remain open                  |
| [#213](https://github.com/ShaulLavo/fregat/pull/213), worker ownership                                                                                                                   | Owning Shiki/Tree-sitter transports terminate busy workers; late replies cannot recreate disposed source caches                    | Cancelling one borrowed request preserves its shared worker                                        |
| [#214](https://github.com/ShaulLavo/fregat/pull/214), typing and Undo                                                                                                                    | Nested-pair ownership follows edits; the real typing scenario verifies complete text restoration after Undo                        | Full-checkout trace memory cause remains unconfirmed                                               |
| [#215](https://github.com/ShaulLavo/fregat/pull/215), long-line fallback                                                                                                                 | Shiki leaves lines over the configured UTF-16 limit as one plain token; default 20,000, exact-limit lines still tokenize           | Fallback is bounded behavior, not full combined-consumer latency acceptance                        |
| [#216](https://github.com/ShaulLavo/fregat/pull/216) and [#217](https://github.com/ShaulLavo/fregat/pull/217), browser and fixture health                                                | Doctor checks required scripts and cancellation provenance; cleanup stops fixture production before resetting handlers             | A healthy capture certifies its own observation window; broader account proofs remain open         |
| [#220](https://github.com/ShaulLavo/fregat/pull/220), [#225](https://github.com/ShaulLavo/fregat/pull/225) and [#226](https://github.com/ShaulLavo/fregat/pull/226), cold startup and CI | Native Vite optimization includes highlighting themes; separate doctor/cold-start jobs preserve both failure results               | Historical cold/warm and normal-click proofs retain their original scope                           |
| [#227](https://github.com/ShaulLavo/fregat/pull/227), [#228](https://github.com/ShaulLavo/fregat/pull/228) and [#231](https://github.com/ShaulLavo/fregat/pull/231), text offsets        | Shiki preserves CRLF separator widths; snippets map offsets to submitted text; diff lines match editor text                        | These repairs do not supply a typing-performance comparison                                        |
| [#224](https://github.com/ShaulLavo/fregat/pull/224), 099 unit 0                                                                                                                         | Consumer-matrix harness and partial calibration delivered; reusable harness review repairs merged                                  | 5/10 historical configurations calibrated; unit 0 is partial, and units 2–7 remain gated           |

132's delivered development ownership uses the native Turbo/Vite graph. Main `3ca862a4b`
removed the remaining app-save hot-update interception. The peer Git-path fix `405d70b56` and
that interception removal were independently reviewed after landing. Neither was wave work.

### Pull-request reconciliation

GitHub PR numbers are separate from plan numbers. Checked GitHub and `origin/main`
`4ba80a6bf7e061591bb1d1073e74a5fed1b2d1f1` on 2026-10-01 at 06:59 UTC. The ledger includes
adjacent package and CI work so it does not turn every PR in the range into foundations scope.
Every merged commit below is present on that main head. PR #208 merged a standalone Markdown
runtime repair; the parser update in #222 closed without merging.

| PR                                                   | Status           | Merge       | Recorded change                                                                       |
| ---------------------------------------------------- | ---------------- | ----------- | ------------------------------------------------------------------------------------- |
| [#202](https://github.com/ShaulLavo/fregat/pull/202) | Merged           | `bfabd3cb7` | Plan 197: Editor-owned highlighting service for editors, diffs, previews and Markdown |
| [#203](https://github.com/ShaulLavo/fregat/pull/203) | Merged           | `cf4e84419` | Publish committed revision frames and preserve retained analysis                      |
| [#204](https://github.com/ShaulLavo/fregat/pull/204) | Merged           | `3293142d2` | Isolate Mermaid diagrams and finish content-isolation closeout                        |
| [#205](https://github.com/ShaulLavo/fregat/pull/205) | Merged           | `5c8c7310b` | Control paged-file index invalidation order in hook tests                             |
| [#206](https://github.com/ShaulLavo/fregat/pull/206) | Merged           | `3a0f097d6` | Install only textbuffer dependencies and vendor its benchmark control                 |
| [#207](https://github.com/ShaulLavo/fregat/pull/207) | Merged           | `7076858b1` | Build workspace artifacts before web deployment checks                                |
| [#208](https://github.com/ShaulLavo/fregat/pull/208) | Merged           | `f50bda2ff` | Share Markdown runtime in standalone Editor installs                                  |
| [#209](https://github.com/ShaulLavo/fregat/pull/209) | Merged           | `ef44ea220` | Recover parser update PRs and CI after partial workflow failures                      |
| [#210](https://github.com/ShaulLavo/fregat/pull/210) | Merged           | `4edb43b18` | Protect quiet Codex terminals and verify two-owner lifecycle                          |
| [#211](https://github.com/ShaulLavo/fregat/pull/211) | Merged           | `9798e56a8` | Reconcile the roadmap with the foundations wave                                       |
| [#212](https://github.com/ShaulLavo/fregat/pull/212) | Merged           | `c65b3407e` | Fix WebKit Settings driving and bound preview typing proof                            |
| [#213](https://github.com/ShaulLavo/fregat/pull/213) | Merged           | `77088dea0` | Release owned syntax workers while tokenization is busy                               |
| [#214](https://github.com/ShaulLavo/fregat/pull/214) | Merged           | `09d30c354` | Preserve nested closing pairs and verify complete burst undo                          |
| [#215](https://github.com/ShaulLavo/fregat/pull/215) | Merged           | `7f0dfc9e2` | Leave Shiki lines over a tokenization limit as one plain token                        |
| [#216](https://github.com/ShaulLavo/fregat/pull/216) | Merged           | `d39f146b4` | Report failed frontend loads in browser doctor health                                 |
| [#217](https://github.com/ShaulLavo/fregat/pull/217) | Merged           | `a872122dd` | Stop federation fixture recovery before handler reset                                 |
| [#218](https://github.com/ShaulLavo/fregat/pull/218) | Merged           | `a382d29c2` | Add native ghostty-webgpu history row reads                                           |
| [#219](https://github.com/ShaulLavo/fregat/pull/219) | Merged           | `b9ef7c35e` | Remove ghostty-webgpu xterm facade and release 0.2.0                                  |
| [#220](https://github.com/ShaulLavo/fregat/pull/220) | Merged           | `320359029` | Predeclare highlighting themes for cold Vite startup                                  |
| [#221](https://github.com/ShaulLavo/fregat/pull/221) | Merged           | `ce6eb19d8` | Fix terminal offline scenario socket interception                                     |
| [#222](https://github.com/ShaulLavo/fregat/pull/222) | Closed, unmerged | —           | Update tree-sitter-x to f73fbfd                                                       |
| [#223](https://github.com/ShaulLavo/fregat/pull/223) | Merged           | `8afd0c83e` | Build Ghostty distribution before standalone verification                             |
| [#224](https://github.com/ShaulLavo/fregat/pull/224) | Merged           | `4ba80a6bf` | Prove native input calibration across document consumers                              |
| [#225](https://github.com/ShaulLavo/fregat/pull/225) | Merged           | `af9a777d5` | Separate browser doctor from cold startup in CI                                       |
| [#226](https://github.com/ShaulLavo/fregat/pull/226) | Merged           | `b4a39276f` | Keep cold-start coverage after browser doctor failures                                |
| [#227](https://github.com/ShaulLavo/fregat/pull/227) | Merged           | `879af51d2` | Keep CRLF separator widths in Shiki token offsets                                     |
| [#228](https://github.com/ShaulLavo/fregat/pull/228) | Merged           | `66f10141f` | Map snippet token offsets back to the submitted text                                  |
| [#229](https://github.com/ShaulLavo/fregat/pull/229) | Merged           | `431c22275` | docs: rewrite package READMEs in the ghostty-webgpu style                             |
| [#230](https://github.com/ShaulLavo/fregat/pull/230) | Merged           | `bc09bce32` | Pin GitHub SSH host keys for mirror jobs                                              |
| [#231](https://github.com/ShaulLavo/fregat/pull/231) | Merged           | `6d81a983c` | Keep diff lines to what the editor holds on CRLF files                                |
| [#234](https://github.com/ShaulLavo/fregat/pull/234) | Open             | —           | Fix Tree-sitter capture decoding above the 2 GiB Wasm boundary                        |
| [#235](https://github.com/ShaulLavo/fregat/pull/235) | Open             | —           | Add reproducible terminal comparison benchmarks with M1 evidence                      |
| [#237](https://github.com/ShaulLavo/fregat/pull/237) | Open             | —           | Preserve intrinsic grayscale emoji colors in GPU glyph atlases                        |

### Calibration disposition

[#224](https://github.com/ShaulLavo/fregat/pull/224) merged as `4ba80a6bf`. Unit 0 is
**partial: 5/10 configurations calibrated** at historical instrument `56c8e77fb`.
`native`, `disabled`, `tree-sitter`, `shiki` and `minimap` each passed their controls,
independent holdout, delayed-negative admission and candidate blocking checks.
`tree-sitter-shiki` failed its holdout; its candidate did not run. `shiki-minimap`,
`tree-sitter-minimap`, `all` and `platform` never ran in that exclusive matrix.

The owner ended the remaining absolute-threshold matrix and planned phase sweep.
[282](../plans/282-fast-paired-input-latency-check.md) owns the paired replacement instrument
and implements that input-latency gate; its acceptance remains blocked. It does not authorize 099 units 2–7. Historical invalid
and superseded runs remain evidence in the
[historical reference](document-contributions/paired-input-latency.md#historical-reference). The merged harness
repairs have a new instrument identity; the five accepted historical configurations were not
rerun or revalidated with it. Its earlier receipt-coverage and unbounded-readiness limits stay
explicit. There is no full-matrix, combined-consumer/Platform latency or measured improvement
claim in this closeout.

### Served release

The production `/release` response checked on 2026-10-01 at 06:59 UTC reported:

- Web release `20261001T061904Z-8e59d0f0-main`, commit
  `8e59d0f067730c39a79dbfc789fe64f8ef38a67d`, dirty 0.
- Server release `20260930T234955Z-d920819a-main`, commit
  `d920819ab430beaa0621194b5242537a5acf178d`, dirty 0.
- Phase `serving`, no pending release; the web live check passed at
  `2026-10-01T06:19:23.122Z`.
- Terminal host pid 2692 retains `20260930T153616Z-c47bd174-t3code-add-squircle-shapes`,
  commit `c47bd1741383970a3e54ca1a73cb1e20dcc2a7ab`, from another session's artifact.

The served web head precedes #224's merge. This records the actual deployed state; it does not
claim #224's harness is deployed. The earlier coordinator's production capture remains in
`/work/tmp/fregat-evidence/20261001T002116Z-look-platform-1440x1000/`. Its screenshot and log
window belong to that earlier release, not this endpoint check. This documentation closeout
runs no measurements, browser capture or deployment. Other sessions can advance production;
read `/platform/release` before citing its current state.

### Remaining work and boundaries

- [282](../plans/282-fast-paired-input-latency-check.md): paired input-latency instrument;
  099 unit 0 stays partial and units 2–7 retain their replacement proof and explicit owner gate.
- [198](../plans/198-document-owned-editor-analysis.md): full browser, pixel-level and
  memory/WASM acceptance. Its landed publication subscriber is not a second analysis owner.
- [126](../plans/126-t3code-alignment.md), [114](../plans/114-polaron-shell.md) and
  [156](../plans/156-documents-in-the-editor.md): their existing row ledgers, desktop/Mac,
  state-loss, live-account and format/editing gates remain unchanged.
- [#234](https://github.com/ShaulLavo/fregat/pull/234): open Tree-sitter capture decoding
  repair above the 2 GiB Wasm boundary. The reported highlight-query `RangeError` is not
  resolved by this documentation or #224.
- Ghostty [281](../plans/281-ghostty-benchmarks-and-positioning.md) benchmarks and positioning
  and [283](../plans/283-ghostty-output-and-input-latency.md) output CPU/input latency keep
  their existing gates. [#235](https://github.com/ShaulLavo/fregat/pull/235) benchmarks and
  [#237](https://github.com/ShaulLavo/fregat/pull/237) grayscale emoji color preservation are
  open, not delivered by this closeout.
- [#238](https://github.com/ShaulLavo/fregat/pull/238), chat-diagram font measurement, is also
  open at this check and outside the closed wave.
- Physical Mac/iPhone rendering/input, fixture provider-update 500s, full-checkout trace memory
  attribution and broad live-account proofs retain their recorded limits. The earlier
  reconciliation [#211](https://github.com/ShaulLavo/fregat/pull/211) is merged; worker disposal,
  typing/Undo and browser-health repairs replace its original open findings. Failed captures
  remain historical evidence.

Current [AGENTS.md](../AGENTS.md) governs execution and deployment.

## Historical coordination

The [original lane assignments and coordination rules](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/docs/next-wave.md)
remain in git history. They describe the 2026-09-26 launch, including the original wave 3
split and owner-only checks. They are not a second current task queue.

[The completion-wave record](completion-wave.md) preserves earlier owner decisions and delivery
context. Each surviving plan owns its remaining authorization and acceptance requirements.
