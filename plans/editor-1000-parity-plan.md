> [!IMPORTANT]
> **STATUS: 🟢 CURRENT (written 2026-08-10).** The vision layer above [editor-parity-implementation-plan.md](editor-parity-implementation-plan.md) (the E-waves = 100%). Produced by an 8-lens idea fleet (101 grounded ideas), a 3-judge adversarial panel (feasibility-on-our-stack / differentiation / compounding), and a completeness critic that consolidated duplicates into flagship tracks and added the dimensions all eight lenses missed.

# The 1000% Parity Plan

**100% parity is matching VS Code + NeuralInverse + Athas feature-for-feature. That plan exists (waves E0–E9). 1000% is ten dimensions, each taken to its own 100% — nine of which no editor on the market has seriously attempted.**

This is not a brainstorm. Every feature below is grounded in a specific asset we already ship, was scored by an adversarial panel, and survived. Ideas that were parity-in-disguise, untethered sci-fi, or philosophy-contradicting were cut (see the cut list).

## The thesis: why 10× is available to us specifically

Three structural monopolies, plus a culture. Competitors cannot copy these without rewrites:

1. **The persistent buffer.** Our piece table gives O(1) immutable snapshots of _every keystroke_ (~0.6 ms/keystroke at 1M lines), durable three-tier anchors that survive undo/redo/refactor, append-only add-buffers where every character lands at a stable offset exactly once, and materialization-free snapshot-to-snapshot diff. Monaco/CodeMirror/Zed buffers are mutable singletons — for them a historical state, fork, or what-if costs a full copy and a resync; for us it is two pointers. **Time, provenance, forking, and speculation are nearly free for us and structurally expensive for everyone else.**
2. **The event-sourced workspace.** Append-only event log as durable truth, decider/projector/reactors, per-turn git checkpoint refs with revert, worktree-isolated sessions, approvals. Competitors' agent sessions are transcripts; ours are _replayable, forkable, auditable causal histories_. VS Code's Aug-2026 agentHost is converging on this from years behind.
3. **Server-owned truth.** Documents, PTYs (256 KB replay), LSP, git, and agent sessions live in the server; the IDE is a URL. Multi-device, attach/detach, spectate, and fleet views are architecture, not features. Desktop-bound competitors must bolt on sync services to imitate any of it.
4. **The evlog culture.** One wide event per operation, structured errors carrying code/why/fix, JSONL logs with a live panel. The editor can explain the program _and itself_ — no competitor has structured self-observability to build on.

## The ten dimensions

> Each dimension gets: the sentence that sells it, its flagship track (the critic merged 101 ideas into these — one substrate, many renderers), and its constituents with effort. Judges' triple-flagship ideas are marked ★★★.

---

### D1 — Foundation: everything they have

The E-waves ([editor-parity-implementation-plan.md](editor-parity-implementation-plan.md)) are dimension one of ten. Nothing below replaces them; several dimensions _upgrade_ specific E-items in place (noted as ⤴). The parity plan proceeds as written.

---

### D2 — Time: the workspace is scrubbable

**The sentence: "Drag through your working day like video. Nothing is ever lost."**

All eight lenses independently converged here — the strongest signal in the pool. The critic's key warning: at least four separate XL ideas each re-solve clock correlation and retention; build the track **layered, once**:

1. **History graph** (L) — land the documented TODO.md undo-graph plan (Fred-proved: one edit = two pointers; the only flaw today is the `redo: null` discard). Undo becomes branching; no edit state is ever lost. _Prerequisite for everything below._
2. **Total Oplog** (L) ⤴E4 — extend the event log to every workspace mutation: file ops, git ops, bulk edits, settings. "Undo the branch switch." E4's file-op undo, local history, and hot exit become _projections of this log_ instead of standalone features. GitButler's `but-oplog` crate validates demand.
3. **The unified timeline — Workspace EKG** (L) — one brushable bar under the workbench aligning every timestamped stream: saves, watcher events, agent turns, terminal bursts, log histogram, checkpoints. Brush a range, every panel filters. Clock correlation is solved _here, exactly once_.
4. **Replay renderers** — the payoff layer, shipped incrementally:
   - ★★★ **Total Recall** (L) — every-keystroke history with a video scrubber; the decode animation is the ready-made playback renderer.
   - **Keystroke time scrubber per buffer** (M) ⤴E4 — release the playhead anywhere to fork a branch from that moment.
   - **Buffer branches** (M) — name any history node; approach-A/approach-B of one file, instant switch, diff any two, merge via the existing conflict plugin. Cheaper than commenting code out.
   - **Anchored range resurrection** (M) — "history of this function" → scrub versions inline as ghost text → restore one _without_ reverting the rest of the file. Kills "it worked an hour ago but I've changed 12 other things since."
   - **Find-in-time** (M–L) — grep everything that has _ever_ been in the workspace ("who deleted this function," "that regex I discarded yesterday"). Append-only buffers + tombstones mean deleted text is still there; walkers are snapshot-agnostic and structural sharing makes history search sub-linear.
   - **Ghost pane** (M) — pin "this file 20 minutes ago / at turn 12 / when tests were green" as a live continuously-diffed split.
   - **Immortal buffers** (M) ⤴E4 hot-exit — transaction log persisted server-side; crash mid-word loses nothing; reopen next week from another browser with full branching history to file creation.
   - **Time-scrub from the logs** (M) — click an error spike in the histogram, the editor opens the implicated file _as it was at that moment_ (server `file(path, ref)` already exists with zero consumers).
   - **Session replay theater / Director's Cut** (XL, later) — replay any agent session as a scrubbable movie; re-render a slice as a polished screencast with typos elided. The demo artifact that markets the product by itself.
   - **Surgical turn revert** (XL, last) — remove turn 34's edits from three days ago and rebase the 200 subsequent transactions over the removal; genuine overlaps land in the merge-conflict UI. Git-revert at keystroke granularity for the uncommitted.

**Gate (from D9): secret-scrubbing at ingest ships before or with layer 1. An immortal record that remembers pasted API keys is a liability, not a feature.**

---

### D3 — Provenance: every character answers for itself

**The sentence: "Hover any character: typed by you at 14:32, pasted, or written by agent turn #347 — with the prompt that produced it."**

Four lenses proposed this identical substrate; five more ideas are pure consumers. Build **one add-buffer interval map** (append-only buffers make it cheap: record transaction id per inserted range at commit time), then everything else is a renderer:

- ★★★ **Provenance blame** (L) — character-granularity, live, covering uncommitted and AI-written text. The audit trail every AI-codegen team wants; no editor can build it on mutable buffers.
- **Tri-source causal blame** (M over the map + S9) ⤴E5 blame — one hover chain: commit → agent turn → chat message → plan step → your manual tweak, each link clickable. Git blame answers "which commit"; we answer _why_.
- **AI-authorship heat layer** (S) — unreviewed agent-written spans tinted until a human has looked; the review-debt map.
- **Churn/thermal layers** (S) — "rewritten 20× this session" heat on minimap and gutter (feeds D10's layer stack).
- **Annotations that cannot die** (M) — notes and findings pinned to anchors survive rewrites; when code is actually deleted, the annotation becomes a portal to the historical snapshot where it still exists (tombstones + Total Recall make resurrection uniquely ours).
- **Provenance as attestation** (M, with D9) — exportable signed record of who/what wrote every span. The compliance artifact AI-governance teams will pay for.

---

### D4 — Proof: verified before landed

**The sentence: "Agents structurally cannot present unverified work."** (The critic called this the single most important track — it converts every fleet idea from impressive to trustworthy.)

One **fork-and-verify substrate**: apply candidate edits to an O(1) forked snapshot (client: in-browser TS service via change-ranges; server: shadow documents over the 25-LSP proxy; heavier: worktree runs), verify there, attach the verdict _to the edit_. Cursor's shadow workspace needs a whole headless app instance and their docs admit it is memory-heavy; our fork is two pointers.

- ★★★ **Pre-flight verdicts** (L) — every agent hunk / refactor preview / large paste shows "introduces 3 type errors" _before_ acceptance, errors inline.
- ★★★ **Shadow-validated agent edits** (L) — a verification reactor runs affected tests + incremental typecheck in the session's worktree before an edit is surfaced: "verified: 12 green, tsc clean" or the turn continues to fix its own breakage. NeuralInverse shipped the stub; we ship it real.
- **Anchored verdicts with staleness decay** (M) ⤴E8 — verdicts and coverage stored as anchors, not line numbers. On edit, snapshot-diff intersects changed ranges with covered ranges: only intersecting tests decay to "stale," the rest stay _authoritatively_ green. VS Code blows all results away on edit.
- **Buffer-resident test runs** (L) — tests run against the buffer snapshot, not the saved file, on a debounce while you type (Vitest module-graph shim served over WS). Test-the-keystroke.
- **Machine-checkable plan contracts** (M) — plans grow a definition-of-done block (tests exist+pass, tsc clean, coverage floor, named invariants); the decider _refuses to settle the turn_ until proof events satisfy it. Small delta over the existing command-invariants machinery.
- **Proof-carrying refactors** (M) — before/after snapshots both alive at zero copy cost; the "proven" badge lands only when verdict vectors match.
- **Pre-save blast radius** (L) — dirty-buffer overlay typechecks _dependents_: "this change breaks 3 callers" appears in files you aren't looking at, before any save.
- **Verification ledger** (M) ⤴E8 results-history — every test execution is a wide event; projections answer "which turn first broke this test" with the revertable checkpoint linked.
- **Green-state bisect** (L) — "show me the workspace when this test last passed": auto-bisect across per-turn checkpoint refs in a throwaway worktree; present last-green, first-red, and the diff/turn between them.
- **Characterization-test reactor** (M) — editing a zero-coverage region summons a background agent that pins down _current_ behavior as tests generated from the pre-edit checkpoint — so the tests can actually catch your mistake.
- **Verified NES** (with D1's S6/E7) — the critic's "all dessert, no bread" correction: inline completion is the surface users touch 500×/day, so _our_ next-edit suggestions run through fork-and-verify — suggestions that typecheck before they're offered. No competitor verifies completions.
- Moonshots, budget-gated (see D9 economics): mutation-on-idle ("your tests would not catch this"), fuzz-on-idle for the function under the cursor.

---

### D5 — Peers: agents embodied in every surface

**The sentence: "You don't chat with agents. You share a workspace with them."**

- ★★★ **Agent presence & region claims** (L) — every session projects a named cursor and an anchor-range claim ("rewriting this function") into the buffers it touches. Typing inside a claimed range triggers negotiation — rebase or yield — instead of silent clobbering. Zed has human cursors; nobody has agent claims with anchor-stable identity.
- ★★★ **Speculative agent universes** (L) ⤴E7 changesets — the agent types in a zero-cost fork (you watch it, decode-style) while you keep typing in yours; accept = rebase its transactions onto your head via DocumentEditChain; conflicts drop into the existing merge-conflict UI. Cursor locks or mutates your live buffer; we make agent work a parallel universe you merge on your terms.
- **The operating theater** (M) — agent edits as legible performance: tinted caret, streaming decode edits, plan-step HUD, checkpoint pins on the timeline. Any past turn replays. The runtime's superiority becomes something you can _watch — and show_.
- ★★★ **Anchored threads (flagship track 4)** (L) ⤴E9 commenting substrate — range-anchored review threads, event-sourced, that survive edits/undo/the-agent-rewriting-the-function; @mention an agent and a reactor spawns a scoped session whose resolution lands as a changeset linked back to the thread. Build once; consumers: in-buffer PR review loop, GitHub PR parity (E9), AI review findings, teammate asyncs.
- **Variant racing (flagship track 5)** (M–L) — one prompt fanned to Claude + Codex (+N) in parallel worktrees; side-by-side changesets with **per-hunk cherry-picking across candidates** (the differentiating gesture — build that applicator once). Constituents merged: tournament turns, parallel timelines, counterfactual forks (fork any conversation at any checkpoint, change the prompt/model/approval, diff the multiverse), agent variants as undo-graph branches.
- ★★★ **Cross-fleet conflict radar** (L) — a server-side projection continuously diffs every active worktree session against main _and each other_ at anchor granularity: "B and D will collide in processPayment" with one-click rebase-now or fence-the-region. Nobody on the market attempts pre-merge prediction between agents.
- **Fleet cockpit** (L) ⤴E7 agent manager — mission control where each tile is a real engine instance streaming the agent's buffer; approvals with full diff context from any device (server-side projections make the phone view nearly free).
- **Diagnostic vultures** (L) — standing reactors claim problems from the workspace store as they appear; fixes return as lightbulb entries: "agent-fixed 40 s ago, typecheck green," one click, checkpoint-revertable.
- **The workbench as an agent tool surface** (M) — agents drive the IDE through the same command registry humans use (S1): open a split with the relevant diff, pin three annotations, pre-fill a terminal. An agent finishing hands you a prepared desk, not a wall of text.
- **The plan as a live co-edited document** (M) — plan-mode plans become real markdown buffers (our in-buffer live preview) with steps anchored to the events executing them; checkboxes tick themselves as reactors observe completion.
- **Co-owned terminals** (M, needs E6 OSC 133) — command blocks tagged by author (human / agent turn N); agents request your terminal through approvals; interrupt and steer mid-command, every takeover an event.
- **Attention economics** (critic dimension — the fleet's scarce resource is _your focus_):
  - **Interruption scheduler** (M) — non-urgent asks batch at natural boundaries (typing-pause detection, file switch, test completion).
  - **Focus contracts** (S) — "don't interrupt unless the build breaks" as a mode agents must respect; violations are events, so contracts are auditable.
  - **While-you-were-gone** (M) — the digest as _the_ re-entry surface for any fleet user (grows out of the session rail's settle/snooze).
- **The extension is a prompt** (critic ecosystem strategy) — third-party extensibility without a marketplace war: stabilize the typed registries (highlighters, gutters, injected rows, zone widgets, minimap layers) + command registry as _the documented plugin API_, then the flagship demo — "build me a minimap layer that shows X" and the agent writes, registers, and hot-loads it in-session, stored as reviewable in-repo files, shared by copy. Athas's AI-extension-generation proves the demand; our registries make it safe.

---

### D6 — Transparency: the editor explains the program — and itself

**The sentence: "The distance between 'it broke' and 'I see exactly why' is one click."** Our clearest blue ocean; no editor binds runtime to source well.

- ★★★ **Emitter Lens** (L) — every evlog call site grows a live gutter badge: emission count, level, frequency sparkline, last payload on hover; click ↔ filters the Logs panel to that site; log rows jump to the emitting line _even after edits_ (anchors, not line numbers). We own the logging library — call-site capture is ours to add, no fragile stack parsing.
- **Universal log binding** (L) — extend beyond evlog via tree-sitter template fingerprinting across all 25 LSP languages: a Rust service's `tracing::info!` lines anchor to Rust code with zero SDK, matched from PTY output (256 KB replay means logs emitted before the panel opened still bind).
- **Living error catalog** (M) — throw sites using `defineErrorCatalog` render code/why/fix inline with live 24 h occurrence counts; a catalog browser cross-references entries ↔ sites ↔ real-world frequency. No reference editor has the _concept_ of an error catalog.
- **Debugger-less logpoints** (L) — click a gutter, structured events start flowing immediately: dynamic tap registry inside evlog for our runtime; Bun-inspector logMessage breakpoints for programs in our PTYs. Exceeds E8's DAP logpoints; complements, not replaces.
- **Ghost values** (XL moonshot) — select any wide event and the emitting function hydrates: payload fields render as dimmed inline values next to their identifiers; scrub across occurrences and watch values change. A postmortem debugger with no debugger.
- **Route pulse** (XL moonshot) — live p50/p95/error-rate sparklines painted on route-handler code from an evlog/OTLP exporter.
- **Test failures carry their trace** (M, with E8) — each failure captures its wide-event slice; diff a green run's stream against the red run's — the first divergent event is usually the answer.
- **The self-transparent IDE (flagship track 7)** — "Why did that happen?" (alt-click any surprising IDE behavior → the causal event chain as a mini-trace), the **Rewindable IDE** (workbench state itself event-sourced), instrumentation-coverage lint (operations with no wide event get flagged — "every feature ships with its explanation," enforced), and the **Engine Room / Glass Engine** showpiece (watch the treap light up path-copied nodes per keystroke — the caseback of the watch, doubling as the marketing proof of the whole culture).
- **Agents that read the black box** (M) — every error toast grows "diagnose": the operation's full event trail + the catalog's fix hint assemble into an agent brief. Observability agents: standing queries over the event stream dispatch scoped debugging sessions with the wide event as the case file.
- **Agent flight recorder** (L) ⤴E7 request inspector — a turn rendered as a zoomable causal DAG: prompt → tool calls → edits (each a snapshot diff) → checkpoint → emitted events, revert at any node.

---

### D7 — Leverage: the codebase as a live, editable database

**The sentence: "Define a buffer by a query; edit the query results; the files change."**

- ★★★ **Live query multibuffers** (L) ⤴E6/E5 — Zed's multibuffer is a refresh-on-demand excerpt list; ours is a _standing view_: every search match / diagnostic / dirty hunk / symbol usage / changeset hunk as one editable buffer whose excerpts are anchor pairs — self-healing as files change, write-through with one undo unit (S5). Zed's own repo proves the UX demand; anchors remove its staleness ceiling.
- **Query lenses** (XL moonshot) — projectional editing that finally ships: write a tree-sitter query, get a live editable virtual document (all SQL strings in a service as one `.sql` buffer with SQL LSP; a signatures-only lens of a 5 k-line file), edits mapped back through anchors.
- **Migration campaigns** (L) — architectural-scale refactors ("migrate all 400 callers") as event-sourced long-running objects: batched, per-batch shadow-verified (D4), resumable across days, visualized in the fleet cockpit. Where senior engineers actually spend weeks; no editor helps today.
- **Architecture as invariants** (M) — dependency rules ("features never import each other") checked continuously like types; violations land in the problems store where diagnostic vultures (D5) already hunt.
- **Codemod authoring with live preview** (M) — tree-sitter query + template, watched applying across the repo inside a live query multibuffer before anything commits.
- **Module-graph lens** (L, later) — the real import graph as a navigable surface; drag-to-restructure compiles to verified changesets.

---

### D8 — Everywhere: the editor is a URL

**The sentence: "Close the laptop. Approve the agent's diff from your phone. Reopen the exact session on another machine."**

- ★★★ **Multi-device attach, popout, handoff** (L) ⤴E9 remote — any browser attaches to a running workspace; pop the agent rail or a terminal out to your phone (zellij shipped a PWA for terminals — we do the whole IDE); concurrent multi-client attach; per-pane device popout (dockview's floating-window work in `references/` is the layout playbook).
- **Spectate links** (M) — mint a scoped read-only link to a buffer, terminal, session, or room; recipient is present in seconds, no install, no account. (Edit-capable links wait for the multiplayer epilogue — see doctrine.)
- **Accessibility as architecture** (critic dimension) — server-side truth + a semantic document model means a non-visual client is _just another client of the same state_: potentially the best screen-reader coding environment ever built, not an ARIA retrofit. **One substrate, N renderings**: every presence tint, verdict color, and timeline pin backed by a non-visual equivalent derived from the identical event stream. Voice as a peer input modality: push-to-talk turns, spoken approvals, "what just happened?" narration from the same wide events — serving every user, not only those who need it.
- **Capability lattice** (scoped, deliberate) — a defined static/degraded tier for boot-speed and demo links; a conscious decision about which subsystems must work serverless, not a second product by drift.

---

### D9 — Custody: trust, safety, and your data's future

**The sentence: "Total recall you can trust: secrets never enter the record, agents run in scoped sandboxes, and your history is yours in documented formats."** (The critic's bluntest finding: the other dimensions _create_ this liability; nobody owned it. Now it's owned, and it gates D2.)

- **Secret-scrubbed truth stores** (M, **prerequisite for D2**) — high-entropy/credential detection at ingest for PTY replay, event log, and history persistence. Secrets _structurally cannot_ enter the permanent record.
- **Capability sandboxes per session** (L) — worktree sessions carry scoped FS/network policies, rendered in approvals ("can read src/, cannot reach network"), enforced server-side.
- **Blast-radius approvals** (M) — approval prompts show computed consequences (files touchable, commands runnable, network reachable) instead of a tool name. Informed consent, not a yes button.
- **Provenance as attestation** (with D3) — signed exportable authorship record per span.
- **Open formats charter** (S–M) — history, events, provenance as documented stable JSONL/SQLite schemas + a one-command exporter. "Your history outlives this app" is a trust differentiator nobody bothers with.
- **Retention dials** (M) — per-store TTL/compaction UI (keystroke history vs checkpoints vs logs vs PTY replay) — the shared surface three moonshots each assumed someone else would build.
- **Workspace archive** (M) — single-file export of a project's complete causal history, importable by another instance (also the substrate replay-sharing silently requires).
- **Fleet economics** (critic dimension) — the governance that makes D4/D5's idle-time fleets deployable:
  - **Spend ledger** (M) — token-cost wide events joined to outcomes; _cost-per-accepted-change_ as the headline metric.
  - **Budgeted speculation** (M) — all idle-time features draw from one explicit budget pool with visible priority and starvation.
  - **Model routing by stakes** (S) — cheap models for characterization/speculation, frontier for architect turns; routing as an editable surface over the provider adapters.

---

### D10 — Craft: speed and knowledge as headline products

**The sentence: "The fastest editor you can feel — and an editor that already knows your codebase."**

Performance (critic: Zed's entire position is a latency number; a web editor is presumed slow until _proven_ otherwise — and we have the numbers):

- **The latency ledger** (M) — keystroke-to-paint p95 budgets enforced as a CI gate per commit, a live HUD in the status bar, an auto-published public benchmark page. (Perf-regression detection is just a projection over `durationMs` wide events — D6 dogfooding itself.)
- **The 1 GB file demo** (S–M) — reproducible torture benchmarks (open huge file, scrub full history, search-in-time in ms) as public artifacts; the piece table's strength turned into the demo people share.
- **Perf bisect reactor** (M) — a duration regression in the evlog stream auto-bisects to the offending commit using D4's green-state-bisect machinery pointed at the editor itself.

Knowledge (critic: eight lenses covered what agents _do_; zero covered what they _see_ — context is Cursor's actual moat, so we make it glass):

- **Glass context** (L) — every turn ships a context manifest (files, symbols, retrieval hits, token budget, evictions) as one wide event; click any item for _why it was included_; diff the manifest between a good turn and a bad one.
- **Steerable retrieval** (M) — pin an anchor-range as always-in-context, ban directories, watch the live budget meter react. Context becomes a surface you edit, not a black box.
- **Context provenance taint** (M) — content from untrusted sources (web fetches, third-party logs) labeled in the manifest and rendered tainted — the prompt-injection story no competitor has.
- **Workspace memory distillation** (M) — a reactor folds settled sessions into reviewable, in-repo, versioned knowledge files; the repo gets smarter with every settled thread.
- **Tours that cannot rot** (M) — anchored walkthroughs with verdict-style staleness decay; a materially-changed step triggers an agent to regenerate it instead of the tour dying (kills CodeTour's failure mode).
- **Ask the repo** (M) — "why is this here?" answered from tri-source blame: the commit, the agent turn, its prompt, and the thread that introduced the code, linked live.
- **First-hour concierge** (M) — opening an unfamiliar repo dispatches an agent that builds the guided map: entry points, data flow, how to run it.
- **Verified docs + session-distillation ADRs + the why layer** (M each) — doc claims anchored to code and continuously checked like test verdicts; settled threads drafted into ADRs anchored to the code they govern; zone-widget rationale annotations auto-linked via provenance to the conversation that produced the code.
- Delight, kept and systematized: **a motion system, not motion moments** (motion tokens beside color tokens; files morph from tree row to tab; go-to-definition as travel), **metadata layers / the layer stack** (flagship track 6: one layer registry + switcher + cross-fade; age/churn/coverage/log-heat/agent-touched as GIS layers over buffer and minimap — every lens's layer becomes a data adapter), and the **Engine Room** showpiece (D6).

---

## Doctrine (settled now, so ideas don't fight the house)

From the critic's contradiction analysis — adopted as rules:

1. **Keystrokes never enter the orchestration log.** Keystroke history lives in the editor's own transaction log; the event log carries one wide event per operation with snapshot refs pointing in. (Wide-event culture preserved across every time-track idea.)
2. **Secret-scrubbing precedes immortality.** No immortal-history feature ships before ingest scrubbing (D9 gates D2).
3. **Stable-store carve-out from the greenfield rule.** CLAUDE.md's no-migrations rule stays for app code — but the named durable stores (history, events, provenance) get versioned schemas _with_ migrations. A permanent-history product cannot refuse format migrations; deciding this late would be expensive. Everything else stays greenfield.
4. **Agents are the other players.** Every presence/threads/terminal primitive ships agent-first with zero auth. Human-human co-editing (CRDT/OT, identity, permissions) is an explicitly deferred epilogue — the pool's own multiplayer substrate (MP0, Rooms) was cut as philosophy-contradicting. Spectate stays read-only until then.
5. **Offline is the localhost server.** No sync engineering; "local-first with a server you own" is the story. The capability lattice's serverless tier is a scoped boot/demo decision, not a second product.
6. **The bread rule.** Inline completion (the surface touched 500×/day) gets the same 10× treatment as the exotic surfaces: verified NES (D4) is a named deliverable, not a dependency footnote.
7. **Effort accounting.** Roadmaps must not sum the idea pool's effort column: substrates were multi-counted (three time machines, four provenance entries) and the shared hard problems (clock alignment, retention, redaction) were unowned. The flagship-track structure above is the corrected accounting.

## Sequencing: three horizons

**H1 — Substrates + first wow (interleaves with parity waves E0–E3).**
History graph → provenance interval map → fork-and-verify (pre-flight TS path) → Emitter Lens → EKG v1 → agent presence/claims → secret scrubbing. Each is independently shippable and each produces a demo no other editor can replicate. H1 exit criterion: _Total Recall scrubber + provenance hover + "verified: tsc clean" badges on agent hunks, live in daily use._

**H2 — Composition (with E4–E7).**
Speculative universes + operating theater (needs E7 changesets), anchored threads + review loop (needs S3), shadow validation + plan contracts + verification ledger, live query multibuffers, variant racing, fleet cockpit + conflict radar, tri-source blame (needs S9), Total Oplog absorbing E4, multi-device attach, glass context + steerable retrieval, latency ledger + public benchmarks.

**H3 — Moonshots (post-E7, budget-gated by D9 economics).**
Session replay theater / Director's Cut, surgical turn revert, query lenses, ghost values, route pulse, migration campaigns at full scale, speculative fleet, anchored virtual branches (GitButler lanes on anchors), mutation/fuzz-on-idle, the non-visual client, NES at full depth.

## The cut list (judged and rejected, with reasons)

- **MP0 shared-buffer multiplayer + Rooms + edit-capable spectate** — philosophy-contradicting (auth/identity/OT for a single-user-first product); agents-as-peers delivers the value without it. Deferred epilogue, not foundation.
- **Sound palette, reactive wallpaper shader, project cover art, typography-as-instrument, canvas workspace, buffer carousel, niri Exposé** — delight without compounding value; the motion system and layer stack carry this dimension.
- **Snippet cards, performance archaeology (as standalone)** — subsumed by layer stack + open formats.
- **Language-breadth as a dimension** — a parity treadmill fighting VS Code's strongest moat; polyglot depth is served by query lenses + universal log binding instead.
- **Offline-first sync, openness/pricing positioning** — architecture contradiction / business strategy, not product capability.

## What 1000% means, measurably

| Dimension       | The demo that proves it                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| D1 Foundation   | Every gap-matrix row ✅ or consciously dispositioned                                            |
| D2 Time         | Scrub yesterday; fork from 14:32; find code that no longer exists                               |
| D3 Provenance   | Hover → "agent turn #347, this prompt"; export the attestation                                  |
| D4 Proof        | An unverified agent hunk is _unrepresentable_ in the UI                                         |
| D5 Peers        | Watch two agents negotiate a region claim; cherry-pick hunks across three racing candidates     |
| D6 Transparency | Log line → emitting line → live payload; "why did that happen?" answered by the IDE             |
| D7 Leverage     | Edit 400 call sites as one query buffer with one undo                                           |
| D8 Everywhere   | Approve a diff from your phone; a screen-reader user calls it their best environment            |
| D9 Custody      | Paste a key into a terminal — the permanent record provably never saw it                        |
| D10 Craft       | A public latency page competitors get compared against; "how does it already know my codebase?" |

The parity plan makes us _equal_. This makes us _inevitable_: every dimension compounds the others — time makes proof cheap, provenance makes agents trustworthy, transparency makes speed provable, and the substrate under all of it is the one thing no competitor can retrofit: **the buffer that never forgets, the log that never lies, and the server that's already everywhere.**
