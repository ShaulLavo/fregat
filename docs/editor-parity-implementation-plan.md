> [!IMPORTANT]
> **STATUS: 🟢 CURRENT (reconciled 2026-08-24).** Living product roadmap, not an executable plan.
> E0 is complete and E1 is partially landed. Root [`PLAN.md`](../PLAN.md) is the only execution
> scheduler; linked files under `plans/` are the executable handoffs. Companion analysis:
> [editor-parity-gap-matrix.md](editor-parity-gap-matrix.md). The beyond-parity vision layer lives in
> [editor-1000-parity-plan.md](editor-1000-parity-plan.md) (this plan is its dimension D1).

# Editor Mode Parity Plan — VS Code / NeuralInverse / Athas

Target: our editor mode reaches feature parity with **all** features of the three references — VS Code (`f321c7605d4`, 2026-08-10), NeuralInverse (`2d68ded2f2b`, 2026-07-22), Athas (`2c25c47b`, 2026-06-16), all pinned at upstream HEAD in `references/`.

Scoreboard after a verified sweep of 448 features: **80 have · 109 partial · 259 missing**, plus 11 cross-cutting areas (encodings, untitled buffers, file-op undo, Emmet, commenting, bulk edit, custom editors, deep links, …). "All" is honest scope: with everything included this is a multi-year program for one implementer. The wave order below is chosen so value density falls monotonically — stopping after any wave leaves a coherent product.

## Where we stand

**At or beyond parity already:**

- The editing core fundamentals: piece-table document model (fuzz-tested, ~0.6ms/keystroke at 1M lines), durable anchors, multi-cursor, find/replace, folding, virtualized rendering, minimap, diff engine (split/stacked, word-level, live projection), merge-conflict editing. Athas's in-house engine is experimental (they default to Monaco) — **our core beats theirs**.
- The agent runtime: event-sourced orchestration, checkpoints with revert, worktree sessions, approvals, plan mode, session rail. VS Code's Aug-2026 agentHost/agentSessions work is **converging on what we already built**; NeuralInverse's equivalent services are less production-grade than ours.

**The three deficit bands:**

1. **Typing assistance** — auto-close, auto-indent, snippets, signature help, suggest filtering/docs. This cluster is what makes an editor feel finished, and it is almost entirely missing.
2. **Workbench shell** — one editor group, no splits, no status bar, narrow settings, no chords. Deliberately modest so far; recent investment went to chat-mode.
3. **Whole subsystems** — debug, testing, tasks, notebooks, extensions marketplace, database client, GitHub integration: greenfield.

**Three structural findings that shape everything below:**

- **The server is ahead of the client.** The native TS session already answers signatureHelp, rename, codeAction, documentSymbol; the stdio proxy passes any LSP method through; the git service has applyPatch, branches, worktrees, file-at-ref with no UI consumers. Many "missing" features are client-UI-plus-wiring, not full-stack builds.
- **The engine has narrow ready seams, not a generic surface host.** Injected rows, inline replacements, gutters, highlighters, and decorations cover their specific text/paint jobs. The broad block/zone system was removed and is not a compatibility target. The landed [diagnostic peek](../apps/web/src/features/editor/components/diagnostic-peek.tsx) proved that a floating React product surface can use ordinary composition over Editor-owned anchor geometry. Data is even pre-computed in places (tree-sitter worker already ships bracket ranges with zero consumers).
- **PLAN.md is the spine.** The reconciled cross-project roadmap schedules the remaining keymap
  work; the diagnostic surface is landed. The CommandBus, FocusService, WorkspaceEdit transaction,
  document/file-sync, and multi-server-per-document LSP foundations are already live. Do not rebuild
  their obsolete ownership or add parity features on parallel transaction wiring.

## Shared substrates and consumer gates

The critic pass found the same infrastructure hiding inside dozens of feature requests. Each shared substrate is listed in the wave where it lands; violating that list means five features each half-build the same thing. S3 keeps its roadmap number for continuity but is the exception: it is one consumer decision and implementation, not a build-once surface promise.

| #   | Substrate                                                                                                                                                                                                          | Unlocks                                                                                                            | Wave |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---- |
| S1  | [Typed CommandBus](../apps/web/src/keymap/state/command-bus.ts) and [FocusService](../apps/web/src/lib/focus/state/service.ts) — landed                                                                            | real palette, keybindings editor, menus, chords                                                                    | E3   |
| S2  | Status bar strip (data source already exists)                                                                                                                                                                      | 6 domains' indicators: cursor/indent/encoding/EOL/language/branch/sync/problems/LSP/debug/chat                     | E3   |
| S3  | [Diagnostic-peek source](../apps/web/src/features/editor/state/diagnostic-peek-source.ts) and [real-browser proof](../apps/web/src/features/editor/tests/diagnostic-peek.browser.tsx) — landed                     | One E2 marker peek through ordinary React composition; no generic surface contract                                 | E2   |
| S4  | Language configuration engine (per-language: pairs, onEnter, word patterns; comment tokens exist)                                                                                                                  | auto-close/type-over/surround, auto-indent, word-part ops                                                          | E1   |
| S5  | [WorkspaceEdit transaction service](../apps/web/src/features/editor/state/workspace-edit-service.ts) and [Refactor Preview](../apps/web/src/features/editor/components/workspace-edit-preview-dialog.tsx) — landed | rename, code actions, organize imports, fix-on-save, AI changesets, search-replace preview, update-imports-on-move | E2   |
| S6  | Inline-suggestion (ghost text) surface in the engine                                                                                                                                                               | AI completions, FIM, NES, word-based fallback                                                                      | E7   |
| S7  | Editor groups model (split tree over shared buffers — EditorViewSession + panes package exist)                                                                                                                     | splits/grid, open-to-side everywhere, side-by-side terminal-in-editor, merge editor layout                         | E3   |
| S8  | Workspace-wide problems aggregation store                                                                                                                                                                          | Problems panel, tree/tab badges, problem matchers output, Checks-style views                                       | E6   |
| S9  | Git log/graph server endpoint                                                                                                                                                                                      | graph view, timeline, blame, commit details, incoming/outgoing                                                     | E5   |
| S10 | Quick-input framework + palette provider registry                                                                                                                                                                  | all pickers, multi-step wizards, git/task/debug quick-picks, MRU                                                   | E3   |
| S11 | Non-text document surface + editor associations ("Open With")                                                                                                                                                      | image/PDF/hex/CSV viewers, simple browser, database client, notebook (if ever)                                     | E4   |
| S12 | LSP capability breadth on the landed multi-server-per-document runtime                                                                                                                                             | semantic tokens, resolve, snippets, eslint+ts concurrently, pull diagnostics                                       | E2   |

S5 deliberately leaves server-initiated `workspace/applyEdit` unsupported. Supporting it safely
requires a separate pooled-request ownership prerequisite in `LspService`; consumers must not add a
second transaction route around the landed WorkspaceEdit coordinator.

## The waves

Effort letters from the matrix: S = days, M = 1–2 wk, L = 3–6 wk, XL = multi-month. Every wave ends with typecheck/tests green and the app usable (same gate discipline as PLAN.md).

### E0 — Unwired wins (~2 weeks total; everything here has its data or engine code already built)

> **Status: 11 of 11 landed — E0 complete.** The final AI commit-message flow uses the shared provider runtime, was covered by focused tests, and was verified in the running app without changing `HEAD` or the index.

- ✅ **Bracket-match highlight + jump-to-bracket** — the worker's bracket ranges had no consumer past `syntaxController`; `brackets` now reaches `EditorViewSnapshot` (gated by the folds coverage check) and `bracketMatchPlugin` paints the pair. `editor.action.jumpToBracket` on `Mod+\` — VS Code's `Mod+Shift+\` is unavailable because the hotkey layer refuses Shift+punctuation as layout-dependent. Matching validates characters rather than trusting the worker's `depth`, which collides on unbalanced text (`{ a ]`).
- ✅ **Word wrap** — `wordWrap` in EditorOptions, `setWordWrap`/`isWordWrapEnabled`, and `editor.action.toggleWordWrap` on `Alt+Z`.
- ✅ **Expand/shrink selection** — provider-backed selection ladders drive `editor.action.smartSelect.expand` / `shrink`, including multi-selection history and platform keybindings.
- ✅ **Go to line/column** — `:line[:column]` quick-access mode, navigating through the same `openDefinition` path the `@` symbol mode uses.
- ✅ **Passive occurrence/word highlight** — scans only the mounted rows the snapshot carries, so it never materializes the document; whole-word matching reuses `wordRangeAtOffset`.
- ✅ **Signature help** — an LSP-plugin controller requests `textDocument/signatureHelp`, renders the shared tooltip surface, and cycles overloads.
- ✅ **Document links** — http(s) URLs underlined, Cmd/Ctrl+click to open; viewport-scoped, narrow matching, keeps a `)` the address itself opened.
- ✅ **Markdown live preview** — `@singapore-editor/markdown` is registered in the platform plugin list for Markdown documents.
- ✅ **Compare with Saved** — a `compare-saved:` document kind diffing the live buffer against disk, both sides read live so the diff keeps updating as you type. In the editor context menu. _Revert file, compare-with-clipboard, and select-for-compare remain open; revert also needs the undo-history hazard resolved (see the text-menu note)._
- ✅ **Open file at ref** — `git-ref:` document kind + "Open File at HEAD". Read-only by construction: the content lands in an _unsynced_ document, which the save path and the file-backed guards both refuse, because the editor has no read-only flag.
- ✅ **AI commit message** — the sparkle action sends staged-first (working-tree fallback) diff context through an isolated turn on the shared provider runtime, prefers ChatGPT `gpt-5.6-luna` at low effort, falls back only to advertised cheap models, and fills the existing input without committing. Loading, failure, cancellation, stale results, and user edits are handled explicitly.

### E1 — Typing assistance (the "feels finished" wave)

> **Started.** Landed: auto-closing pairs with type-over, pair-backspace, and surround-with; auto-indent on Enter (including the `{`+Enter block expansion, verified in the app); and `completionItem/resolve`, without which accepting an auto-import completion silently inserted the symbol with no import.
>
> Also landed: snippet tab-stop navigation (Tab/Shift+Tab cycle stops, falling through to indent when no session is live; repeated stops visit only their first occurrence, since editing mirrors together needs a linked-range mechanism), Format Document, and eight line operations (trim trailing whitespace, sort asc/desc, join, duplicate selection, upper/lower/title case).
>
> Also landed since: snippet expansion (a real parser for `$1`, `${1:default}`, `${1|a,b|}`, `$0`, variables and escapes — `snippetSupport` was false and snippet text was regex-stripped, so accepting a function completion inserted a bare name), client-side completion filtering/ranking (the list was the server's answer verbatim and went stale between round-trips), and **Format Document** on Alt+Shift+F (overlapping server edits reconciled by keeping the outermost, since formatters send a whole-document edit alongside nested ones and the batch applicator rejects overlaps).
>
> Still open in the typing cluster: multi-caret for auto-close/indent (needs one edit per caret — two zero-width edits at one offset pass batch validation but apply in an unspecified order), undo coalescing across an auto-close (needs `TypingRun` to carry a caret offset distinct from the edit end), and syntax-aware suppression — captures are the only scope-bearing data, are requested off, and are not projected through edits, so a `scopeAt()` would be stale exactly at the caret.

Substrate S4 first, then:

- Auto-closing pairs, type-over, surround-with-brackets, auto-delete pair (M/core)
- Auto-indent on Enter via tree-sitter indentation queries (M/core)
- Indentation commands: convert tabs/spaces, detect-from-content, reindent (S)
- **Snippets engine** — tab stops, placeholders, choices, variables; flip `snippetSupport: true` so LSP completions stop being flattened (L/core)
- Suggest-widget upgrade: client-side fuzzy filter/rank, docs flyout, `completionItem/resolve` (unblocks auto-import on typescript-language-server), themed icons, word-based fallback, commit characters (M/core)
- Bracket-pair colorization + colored indent guides variant (M)
- Line-op extras: sort/join/duplicate-selection/transpose/case transforms (S)
- Word-part (camelCase/snake_case) movement/selection/delete (S)
- Column (box) selection (M); cursor undo (S); selection anchors (S)
- Clipboard extras: copy-line-when-empty, per-cursor paste spread, copy-with-highlighting (S)
- Unicode highlighting (confusables/invisibles) + unusual-line-terminator warning (M)
- Rulers, font zoom, middle-mouse scroll, in-place value cycling, empty-buffer placeholder, overtype mode, read-only message, cursor style options (each S/niche)
- Find-in-buffer perf debt: move to piece-walker + worker (from TODO.md) so find stops materializing full text (M)

### E2 — Language intelligence completion

Run S3's go/no-go before the marker peek and build S5 for the broader wave. Reuse the landed
multi-server-per-document runtime for S12 capability breadth; do not restore one-server ownership.
Then:

- Formatting: document/range commands, default-formatter pick, **format-on-save + save participants** (trim trailing, final newline — the "file hygiene" items), format-on-type (M total)
- Rename with prepare + inline widget + multi-file preview via S5 (L→M once S5 exists)
- Code actions: lightbulb, Cmd+., refactor/source menus, fix-all + organize-imports on save (L→M via S5)
- Workspace symbols — `#` palette mode (M)
- Semantic tokens layered over tree-sitter coloring (M)
- Inlay hints (inline-replacement seam) (M); CodeLens (injected-row seam) (M)
- Color decorators + picker (M); linked editing (M); smart paste/drop providers (M/niche)
- ✅ [Anchored diagnostic marker peek](../apps/web/src/features/editor/components/diagnostic-peek.tsx) with message, severity, source, code, and related information through ordinary React composition; definition/references embedded peek remains a separate consumer decision because the current references UI already composes beside the Editor in React (M)
- Sticky scroll (separate rendering decision + scope data; no deleted top-block seam) (M)
- Outline sidebar view + breadcrumbs strip with symbol trail (M each; breadcrumbs also satisfies Athas/shell entries)
- Call hierarchy (L), then type hierarchy reusing its shell (M)
- Folding extras: LSP foldingRange fallback, `#region`, fold-all-by-level/comments/imports (S)
- Emmet — expansion, wrap, balance (M; critic addition, daily expectation for a web-dev IDE)
- Language mode picker + automatic detection + file associations + status-bar entry (M; critic addition)
- Hover polish: sticky/focusable hover, diagnostics merged into hover (S)
- Editor accessibility pass 1: screen-reader strategy decision, accessibility-help dialog, tab-focus-mode toggle (start of the XL retrofit — see Dispositions)

### E3 — Workbench shell structure

Substrates S1, S2, S7, S10 (CommandBus + FocusService weeks of PLAN.md land here if not already done). Then:

- **Editor groups**: split right/down, 2D grid, drag between groups, split-in-group, maximize, even-sizes, locked groups, per-group history (L)
- Pinned tabs + preview tabs + open-editors limit; tab sizing modes (M)
- **Status bar** with the full entry set (M — strip + entries; sources exist)
- Editor navigation history: back/forward across files, last-edit-location, Ctrl+Tab MRU overlay (M)
- Command palette upgrade on S10: MRU ranking, preserve-input, disabled reasons, virtualization, `%` quick text search (M)
- Quick open: MRU/frecency ranking (Athas fff-search idea), open-to-side, `:line` suffix chaining (M)
- **Keybindings**: chords, when-clause contexts, conflict reporting, precedence; keybindings-editor search/record/conflict UI; keymap import (VS Code json) (L)
- **Settings platform**: configuration registry (defaults, user/workspace scopes, JSON, live reload, per-language overrides) + full settings editor UI (search, categories, modified indicators) + import/export/reset (L) — absorbs Athas's 15-tab surface and NI's settings pane
- Themes: registry + live-preview picker + high-contrast + **custom theme install**; file-icon themes (M)
- Notifications center: history, DND, progress notifications, status-bar bell (M)
- Secondary sidebar (right dock) (M); activity-bar badges/reorder/hide (S); bottom-panel maximize/move/align (S)
- Menu bar: full File/Edit/Selection/View/Go categories over the declarative menu model; title-bar command center + layout toggles (M)
- Window management: zoom commands, new-window/duplicate, confirm-before-close polish (M)
- Zen mode + centered layout + banner + screencast mode + layout reset commands (S each)
- Keyboard navigation everywhere: tree type-ahead, roving tabindex, focus outlines (M, rides FocusService)
- Welcome/walkthrough system (fold NI onboarding wizard + Athas onboarding; include provider setup + theme pick) (M)

### E4 — Files & workspace robustness (critic-heavy wave)

- **Encodings**: detection, reopen/save-with-encoding, BOM handling, EOL display + CRLF/LF convert, binary-open guard — fs service is hardcoded utf8 today; this silently destroys non-UTF-8 files (M/core)
- **Untitled editors**: Cmd+N scratch buffers, save-as flow, language pick, paste-into-new-editor (M)
- **Auto-save** (afterDelay/onFocusChange/onWindowChange) + **hot exit** (backup dirty buffers incl. untitled, restore on crash/reload) — replaces the current "block on beforeunload" model (M/core)
- **File-op undo + trash**: delete-to-OS-trash with restore, undo rename/move/create/delete, explorer cut/copy/paste, OS-file drop-import, Reveal in Finder (M)
- Update-imports-on-move via LSP `fileOperations` (S once S5 exists)
- **Local history** (per-save snapshots) merged with **Timeline view** (file history — uses S9) (M)
- Large-file debts from TODO.md: streaming/windowed load, tombstone GC, tree-sitter WASM ceiling (L)
- S11 substrate + **image viewer** as first consumer (clicking a PNG currently opens nothing) (M)
- OS integration: app protocol handler / deep links (file:line, project, chat session), open-in-external-terminal (S)
- EditorConfig support (S)
- Multi-root workspaces (L/niche — schedule last in wave or defer; worktree sessions already cover the main monorepo use case)

### E5 — Git & SCM parity

Substrate S9 (one `git log`-backed endpoint unblocks four features). Then, roughly in dependency order:

- Branch picker (server API exists, zero UI): checkout, create-from, delete/rename, detached, recent-commit metadata; status-bar branch/sync entry (S–M)
- Commit box: multiline editor, validation, history navigation, amend/signoff/no-verify/commit-all/empty, undo-last-commit, COMMIT_EDITMSG completion, smart-commit, action button (M)
- **Hunk/range staging** — server applyPatch is ready; diff-gutter buttons + selected-range staging (M/core)
- **Quick-diff gutter** in normal editors (live vs HEAD/index) + peek widget with stage/revert from peek (M/core — engine liveProjection + canvas gutter unused today)
- Editable diff (working-tree side live in diff editor) (M)
- Blame: inline EOL decoration, hover with commit details, status-bar item (M)
- History: **source control graph view**, commit details as multi-file diff, incoming/outgoing (L over S9)
- Multi-file diff editor — generalize the existing chat thread-diff document (M)
- Stash (full lifecycle), tags, remote management, auto-fetch, publish/set-upstream, force-push-with-lease, pull-rebase/prune options (M total)
- Merge/rebase/cherry-pick/revert with abort/continue; conflicts SCM group; accept-both/accept-all + compare in inline conflict flow; **3-way merge editor** (L)
- Clone / init / publish repo; askpass/SSH auth bridge; checkout safety (auto-stash); branch working sets; submodules (M–L)
- Multi-repository support (L)
- Worktree UI in the workbench git panel (endpoints + chat-mode consumers exist) (S)
- Polish: changes tree-view toggle, SCM badge, git palette command set (rides S1/S10), git settings page (rides E3 settings), .gitignore action, hosting-provider links (open-on-GitHub/permalink/create-PR), image diff, status-model fidelity, diff options toggles, moved-code detection (last), history-item-as-chat-context (S)

### E6 — Terminal, tasks, problems, output, search polish

- Terminal **multi-instance + tabs + splits + profiles** — server is already multi-session-keyed; this is client UI over the panes package (M)
- Find-in-terminal (needs ghostty-web scrollback search API) (M)
- **Shell integration** (OSC 133/633): command decorations, rerun/run-recent, cwd detection — highest-leverage terminal investment; unlocks sticky scroll, quick fix, command navigation (L)
- Terminal in editor area; font/settings surface; send-sequence/auto-replies/bell; accessibility buffer; image protocols (investigate ghostty-web support) (M–L)
- **Tasks system**: tasks.json v2 core, run-task quickpick, terminal execution, rerun-last, Cmd+Shift+B defaults; npm-script auto-detection; **problem matchers** ($tsc, $eslint-stylish) feeding S8; background/watch tasks with dependsOn; folder-open tasks; absorb Athas "run actions" (L+L)
- Problems panel on S8: workspace-wide aggregation, filters (text/severity/glob/active-file), related info + clickable codes, table view, tree/tab error badges (M)
- Output channels: per-LSP-server stderr, task output, log-level control (M — our Logs panel stays the structured superset)
- Search polish: inline replace preview (old→new), preserve-case global replace, dismiss-result, open-to-side, tree/list toggle, search-editor context lines + `.code-search` persistence, `%` quick text search if not in E3 (M)
- Simple browser / web-viewer tab (S)

### E7 — AI editor integration (the differentiator — can start in parallel after E2)

We already lead on the runtime; this wave closes the gap where **NeuralInverse and VS Code lead: AI woven into the editor surface itself**. Substrate S6 first.

- **Ghost-text inline completions** on S6 → **FIM autocomplete service** (prefix/suffix windows, import injection, AST context — NI's design; BYOK model routing) → **Next Edit Suggestions** (gutter arrows, jump hints, rename propagation) (L → L → XL, strictly in that order)
- **Inline chat (Cmd+K/Cmd+I)**: run its own ordinary-React composition go/no-go — it does not inherit S3 — then build a selection-anchored prompt, streamed in-place diff, and accept/discard/rerun; selection helper widget; editor AI actions (explain/fix/review, fix-this-diagnostic); terminal inline chat (L + S + M + M)
- **Changesets over open buffers** on WorkspaceDocumentService + S5: live streamed edits into editors, per-hunk/per-file keep/undo, editor overlay with prev/next + N-files progress, auto-accept setting — merges NI fast-apply + VS Code chatEditing (L)
- Code-block actions: smart apply-to-editor, insert at cursor, run/insert in terminal, save-to-file (M)
- Context breadth: implicit active-file/selection with toggle, symbol/folder/problems attachments, screenshots (M)
- Conversation UX: edit-and-resubmit + fork, message queueing + mid-turn steering, follow-up suggestions, ask/edit-only modes, export/import, quick/side/detached chat, subagent drill-in rendering, chat request inspector (S–M each)
- **Approval rules**: persistent per-tool/per-command-pattern auto-approve, risk tiers with command parsing, project-level agent config file, global YOLO setting (M — merges VS Code risk service + NI `.neuralinverseagent`)
- **MCP**: promoted to [Plan 087](../plans/087-stateless-mcp.md), which owns managed integrations, scoped native tool exposure, and chat integration over stateless MCP `2026-07-28`. Execution order lives in root `PLAN.md`.
- Customization: instructions files with applyTo globs, prompt files with front-matter, custom modes, hooks management UI, AI-customization hub, agent plugins/store + built-in agent library (NI), tool sets picker (M each, hub L). Project/global agent memory, onboarding, and capability-based tool guidance are owned by [Plan 088](../plans/088-native-code-intelligence.md).
- **Context engine**: hybrid retrieval (BM25 + trigram + embeddings + import graph + context packer) exposed as agent tools + AI section in search view (L — NI's strongest unique idea). [Plan 088](../plans/088-native-code-intelligence.md) owns native semantic retrieval and bounded tool results; this unscheduled item retains embeddings/hybrid ranking and must consume that service rather than duplicate its symbol index.
- **Workflow automation**: file-glob/schedule/terminal-exit triggers + approval-gated orchestrator; visual composer later (L + L)
- Agent surfaces: agent manager window, parallel sub-agent UI, agent-owned named terminals, artifacts pane (S), image carousel (S), voice dictation + agent launcher (L/niche)
- Local model management (Ollama pull/list/auto-setup) + direct BYOK provider loop breadth (~21 providers) + auto model selection (M + L + M)
- Cloud/background remote coding agents (XL — after the local story is airtight)

### E8 — Debug & testing

- **DAP client core** behind the Bun server (spawn adapters like the LSP proxy; vscode-js-debug first) (XL)
- launch.json flow + config dropdown + debug quick access; preLaunchTask via E6 tasks (L)
- Breakpoints: gutter toggle/drag, verified states, breakpoints view; conditional/hit-count/logpoints/inline/triggered; function/exception/data (L + M + M)
- Execution control toolbar; call stack view + current-line decorations; variables (set value, visualizers); watch; **debug console/REPL** (L + L + L + M + L)
- Debug hover, inline values (inline-replacement seam), exception widget, status indicators (rides S2), JS auto-attach + debug terminal (M each)
- Loaded scripts (M/niche), disassembly + memory inspection (L/niche, last)
- **Testing** (best effort-to-value in this wave — Vitest is the house runner): controller/discovery model, test explorer, run/debug/coverage profiles, **continuous run on FileChangeHub**, gutter run buttons + state icons, failure peek with expected/actual via our diff engine, results panel with ANSI output, coverage view (L + L + M + M + M + M + M + L)

### E9 — Viewers, ecosystem & verticals (each item is a deliberate go/no-go)

- Viewers on S11: PDF, hex/binary, CSV table, image editor (resize/convert) (M each)
- **Database client** (Athas's biggest unique surface: connection manager, schema browser, data grid CRUD, SQL console; per-provider sidecars → our Bun server processes) — GO, it fits the server architecture (XL)
- **GitHub integration**: PR list/viewer + review comments (needs commenting-thread data, a comments panel, and its own named-consumer surface gate; it does not inherit a zone/widget host from S3), issues, Actions runs, create-PR (L + L)
- **Vim mode** built-in (operators/motions/text-objects/registers/command bar/jump list) (L)
- Extension ecosystem decision: keep first-party typed registries as the plugin story now; third-party marketplace/isolation is XL and deferred until demand is real. Athas-style **AI extension generation** is the interesting middle path — generate + install into our registries (M investigate)
- Remote: productize the client/server split (connect-to-remote UX, TLS, host management — our web architecture gets this nearly free); ports view later; SSH auto-provisioning after (M + L)
- Collaboration (Athas channels/chat/screen-share): NO for now — different product; revisit if multiplayer becomes a goal (XL)
- Notebooks: NO for now — the uniform-row virtualizer fights cell UI; revisit only with a data-science push (XL)
- Compliance pillar (NI Checks/Enclave): adopt the **Enclave-lite slice only** — outbound prompt secret/PII scanning + immutable AI action log; skip the framework engine (M vs XL)
- Settings profiles + settings sync (needs an account/backend story first) (L + XL, deferred)
- Accessibility retrofit: dedicated program for screen-reader mode, accessible views (editor/terminal/diff/chat), audio signals (XL — tracked, scheduled after E3 gives it chrome to attach to)
- Localization/i18n framework (L/niche, deferred)

## Dispositions — consciously declined or N/A (so nothing is silently dropped)

- **Print** — N/A (VS Code has no built-in print either).
- **Telemetry opt-out surfaces** — N/A (we collect none; keep it that way; a privacy note in settings suffices). Athas/NI product-metrics services: not adopted.
- **Quota/entitlement/plan-signup flows** — N/A (BYO-provider platform).
- **Fork auto-update channel** (NI) — N/A (web-delivered; clients always load the deployed version).
- **UI restyle/branding** (NI styleOverrides) — have by construction (our design system is fully custom).
- **OSS/weak-model enhancement pipeline** (NI) — N/A (our providers are tool-native agent CLIs).
- **editSessions cloud transfer / authentication / share permalinks** — declined until any cloud story exists.
- **Process explorer / issue reporter / performance tooling** — declined; the Logs panel exceeds this for our needs.
- **Enterprise policy service / managed mode** (NI + Athas) — declined for a single-user product.
- **Remote tunnels** — declined (requires a hosted relay service).
- **Firmware dev environment / Legacy modernisation** (NI) — declined; vertical-market products, not editor parity.
- **Notebook-scoped search, notebook AI** — follow the notebooks no-go.
- **floatingMenu** — optional polish, folded into E2 code-actions UX. **symbolIcons** — folded into suggest-widget theming (E1).
- **Middle tier oddities**: buffer carousel (Athas novelty) — skip; chat pet — skip (with regret).

## Sequencing summary and effort shape

| Wave | Theme                   | Rough size                      |
| ---- | ----------------------- | ------------------------------- |
| E0   | Unwired wins            | ~2 wk                           |
| E1   | Typing assistance       | ~2 mo                           |
| E2   | Language intelligence   | ~3 mo                           |
| E3   | Workbench shell         | ~3 mo                           |
| E4   | Files robustness        | ~2 mo                           |
| E5   | Git parity              | ~3 mo                           |
| E6   | Terminal/tasks/problems | ~2.5 mo                         |
| E7   | AI editor integration   | ~4 mo (parallelizable after E2) |
| E8   | Debug & testing         | ~4 mo                           |
| E9   | Viewers & verticals     | ~4 mo of GOs                    |

Dependency spine: PLAN.md services → E0 anytime → E1/E2 (need S4/S5/S12, plus S3's gate for marker peek only) → E3 (needs CommandBus) → E5/E6 ride E3's palette/status-bar/settings → E7 rides E2's edit substrate + S6 and re-gates its own surfaces → E8 rides E6 tasks + S2 → E9 rides S11. E4 is independent and can interleave anywhere after E0. Where the user-visible payoff must come first, run E0+E1 before finishing the PLAN.md weeks — they touch the engine, not the state seams.

Every wave should keep the two ours-only differentiators alive and untouched: the decode open animation and in-buffer markdown live preview — no reference has either.
