# Plans

[PLAN.md](../PLAN.md) owns execution order and cross-plan dependencies. Each plan below owns
its current status, scope, authorization and acceptance checks. This index lists the files that
exist; it does not duplicate status summaries that drift when a plan changes.

A plan the owner asks for is approved work: write its status as `APPROVED` and write it for
execution. `IDEA` is only for a plan the owner explicitly calls an idea or is unsure about.

[September 29 inventory](inventory-2026-09-29.md) records remaining deliverables,
readiness, cross-project conflicts and the PR reconciliation. It is a dated audit,
not a second live status register.

## Current plan files

| Plan                                                  | Topic                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| [087](087-stateless-mcp.md)                           | Implement stateless MCP support                                               |
| [088](088-native-code-intelligence.md)                | Build native code intelligence for agents and the editor                      |
| [099](099-document-contributions.md)                  | Route document consumers through one contribution runtime                     |
| [108](108-markdown-modes.md)                          | Two markdown modes: split view and live preview                               |
| [110](110-workspace-indexing.md)                      | Workspace indexing: what we index, and what should index us                   |
| [111](111-editor-decorations.md)                      | Editor decorations: learn from CodeMirror and Lexical, then beat what we have |
| [112](112-large-file-ceiling.md)                      | The large-file ceiling: what we can actually open, and who gets to decide     |
| [114](114-polaron-shell.md)                           | Polaron, a desktop shell we own                                               |
| [122](122-composable-plugins.md)                      | Composable, full-power plugins with selective execution                       |
| [126](126-t3code-alignment.md)                        | Align Platform behavior with pinned T3 Code                                   |
| [132](132-process-and-dev-ownership.md)               | Processes, leases and dev plumbing each get an owner                          |
| [139](139-acting-on-agent-diffs.md)                   | Act on the agent's diff                                                       |
| [140](140-editor-agent-advantage.md)                  | The editor is the agent's advantage                                           |
| [141](141-usage-and-rate-limits.md)                   | Usage, cost and rate limits                                                   |
| [143](143-phone-layout.md)                            | Platform on a phone                                                           |
| [144](144-unattended-agent-work.md)                   | Unattended and multi-agent work                                               |
| [145](145-harness-controls.md)                        | Surface the controls the harnesses already have                               |
| [147](147-log-hygiene-and-noise-gate.md)              | Log hygiene and a noise gate                                                  |
| [155](155-site-demo-replica.md)                       | The site demo becomes an animated replica                                     |
| [156](156-documents-in-the-editor.md)                 | Documents in the editor                                                       |
| [166](166-bare-function-keys.md)                      | Bare function keys in text fields                                             |
| [169](169-agent-review-mode.md)                       | Agent review mode                                                             |
| [170](170-language-census.md)                         | Language census for grammar and theme prefetch                                |
| [171](171-composer-on-our-editor.md)                  | The chat composer runs on our own editor                                      |
| [172](172-shared-undo-stack.md)                       | One shared undo/redo stack                                                    |
| [174](174-external-mcp-servers.md)                    | Managed external MCP servers                                                  |
| [176](176-markdown-parser.md)                         | One markdown parser                                                           |
| [177](177-prefetch-every-press.md)                    | Prefetch every press                                                          |
| [178](178-tree-in-the-app.md)                         | The file tree in the app                                                      |
| [179](179-isolating-foreign-content.md)               | Isolating content the app did not write                                       |
| [180](180-file-icon-variants.md)                      | File icon variants                                                            |
| [181](181-chat-timeline-end-anchoring.md)             | Chat timeline on TanStack's end anchoring                                     |
| [182](182-search-view-rendering.md)                   | Search view rendering                                                         |
| [183](183-claude-ide-in-terminals.md)                 | Platform as Claude Code's IDE in its own terminals                            |
| [184](184-dependency-diet.md)                         | Dependency diet                                                               |
| [186](186-pull-request-sync-rate.md)                  | PR sync: an off switch and a smarter poll rate                                |
| [187](187-setup-scripts-in-terminals.md)              | Setup scripts run in visible terminals                                        |
| [189](189-tree-sitter-md-improvement.md)              | Keep improving tree-sitter-md                                                 |
| [190](190-faster-ci.md)                               | Faster CI                                                                     |
| [191](191-file-picker-polish.md)                      | The file picker, resizable and in the app's icons                             |
| [192](192-no-swap-flash.md)                           | Views switch subjects without flashing                                        |
| [195](195-settings-defaults-browser.md)               | Browse Settings defaults in UI and JSON                                       |
| [196](196-shared-control-polish.md)                   | Polish sliders, menu switches, and picker triggers                            |
| [197](197-editor-highlighting-service.md)             | Editor-owned highlighting service                                             |
| [198](198-document-owned-editor-analysis.md)          | Keep editor analysis with the document                                        |
| [200](200-document-backed-content-views.md)           | Shared documents behind content views                                         |
| [201](201-cheap-overlay-marks.md)                     | One-frame typing in large files, starting with cheap underlines               |
| [202](202-tui-ui.md)                                  | App-local Charm-inspired terminal UI on upstream OpenTUI                      |
| [203](203-fregat-hotkeys.md)                          | @fregat/hotkeys, our fork of TanStack Hotkeys                                 |
| [204](204-editor-on-fregat-hotkeys.md)                | The Editor on @fregat/hotkeys                                                 |
| [205](205-ghostty-on-fregat-hotkeys.md)               | ghostty-webgpu on @fregat/hotkeys                                             |
| [206](206-platform-one-keymap.md)                     | Platform owns one keymap                                                      |
| [207](207-one-repo-with-mirrors.md)                   | One repo, with mirrors for the flagship packages                              |
| [220](220-focused-widget-commands.md)                 | Finish keyboard commands for menus, pickers and notifications                 |
| [221](221-keybinding-editor-tools.md)                 | Complete the keybinding editor on Plan 206                                    |
| [222](222-editor-input-commands.md)                   | Expose editor text input, clipboard and snippet commands                      |
| [223](223-completion-widget-commands.md)              | Complete completion and signature-help widget commands                        |
| [224](224-structural-selections.md)                   | Add previous-occurrence and structural selections                             |
| [225](225-paragraph-and-kill-ring-commands.md)        | Add paragraph editing, reflow and kill-ring commands                          |
| [226](226-editor-viewport-and-fold-commands.md)       | Complete viewport, folding and presentation commands                          |
| [227](227-lsp-command-completeness.md)                | Complete LSP navigation, refactoring and display commands                     |
| [228](228-language-encoding-and-toolchains.md)        | Add language, encoding and toolchain selectors                                |
| [229](229-multibuffer-excerpt-model.md)               | Add shared multibuffer excerpt ranges and source mapping                      |
| [230](230-aggregated-source-views.md)                 | Add aggregated source views and all-match text finding                        |
| [231](231-document-outline.md)                        | Build a keyboard-accessible document outline                                  |
| [232](232-workspace-symbols-and-calls.md)             | Add workspace symbol search and incoming/outgoing calls                       |
| [233](233-project-tree-commands.md)                   | Complete project-tree keyboard operations and file clipboard                  |
| [234](234-untitled-and-save-variants.md)              | Support untitled buffers, Save As and save without formatting                 |
| [235](235-search-command-owners.md)                   | Complete search commands across project, buffer and chat widgets              |
| [236](236-pinned-tabs-and-mru.md)                     | Add pinned tabs, MRU switching and close variants                             |
| [237](237-directional-pane-commands.md)               | Complete directional pane focus, split and swap commands                      |
| [238](238-dock-and-session-sidebar-commands.md)       | Expose independent dock and session-sidebar commands                          |
| [239](239-recent-projects-and-multiple-roots.md)      | Complete recent-project and multi-root workspace workflows                    |
| [240](240-remote-project-trust.md)                    | Expose remote project opening and worktree trust                              |
| [241](241-git-navigation-commit-editor.md)            | Complete Git panel navigation and commit-editor workflows                     |
| [242](242-git-batch-range-mutations.md)               | Complete batch, range and next-change Git mutations                           |
| [243](243-git-review-hunks-blame.md)                  | Complete repository review, hunk navigation and blame                         |
| [244](244-git-branches-remotes-worktrees.md)          | Complete Git branch, remote and worktree workflows                            |
| [245](245-git-stash-lifecycle.md)                     | Add a stash picker and stash lifecycle                                        |
| [246](246-terminal-input-scrollback-search.md)        | Complete terminal input, selection, scrollback and search commands            |
| [247](247-terminal-vi-selection-mode.md)              | Add terminal vi selection mode                                                |
| [248](248-chat-navigation-session-mru.md)             | Add transcript boundary commands and session MRU switching                    |
| [249](249-conversation-text-search.md)                | Add conversation text search                                                  |
| [250](250-queued-message-commands.md)                 | Queued-message edit, delivery and steering commands                           |
| [251](251-composer-model-permission-commands.md)      | Composer, model and permission commands                                       |
| [252](252-agent-edit-review-following.md)             | Agent edit review and source following                                        |
| [253](253-agent-profiles-skill-authoring.md)          | Local agent profiles and skill authoring                                      |
| [254](254-selection-inline-assistance.md)             | Selection-based inline assistance                                             |
| [255](255-edit-prediction-controls.md)                | Edit-prediction controls and partial acceptance                               |
| [256](256-local-prediction-inspection-rating.md)      | Local prediction inspection and rating                                        |
| [257](257-project-tasks-runnables.md)                 | Project tasks, runnables and rerun commands                                   |
| [258](258-dap-session-lifecycle.md)                   | DAP session lifecycle and launch/attach selection                             |
| [259](259-source-breakpoints-stepping.md)             | Source breakpoints, logpoints and stepping                                    |
| [260](260-debug-values-watches.md)                    | Debug variable trees, watches and evaluation                                  |
| [261](261-kernel-repl.md)                             | Kernel-backed REPL and kernel lifecycle                                       |
| [262](262-notebook-cells.md)                          | Notebook documents, cells and command/edit modes                              |
| [263](263-markdown-preview-commands.md)               | Complete Markdown preview commands                                            |
| [264](264-image-svg-preview.md)                       | Image and safe SVG preview commands                                           |
| [265](265-tabular-file-preview.md)                    | Tabular file previews                                                         |
| [266](266-settings-navigation-profiles.md)            | Settings navigation and profile selection                                     |
| [267](267-theme-font-commands.md)                     | Theme mode and font-size commands                                             |
| [268](268-extension-packages-lifecycle.md)            | Extension packages, contribution boundaries and lifecycle                     |
| [269](269-extension-manager.md)                       | Extension browsing, installation and management                               |
| [270](270-local-inspector-frame-diagnostics.md)       | Local inspector and frame diagnostics                                         |
| [271](271-desktop-window-system-commands.md)          | Desktop window, app-menu and system commands                                  |
| [272](272-zed-collaboration-unmapped-inventory.md)    | Retain Zed collaboration actions as unmapped inventory                        |
| [273](273-zed-onboarding-unmapped-inventory.md)       | Retain Zed account onboarding actions as unmapped inventory                   |
| [274](274-vim-mode-input-state.md)                    | Vim mode state and modal input                                                |
| [275](275-vim-motions-search.md)                      | Vim motions and search                                                        |
| [276](276-vim-operators-text-changes.md)              | Vim operators and text changes                                                |
| [277](277-vim-text-objects.md)                        | Vim text objects                                                              |
| [278](278-vim-visual-multicursor.md)                  | Vim visual and multi-cursor modes                                             |
| [279](279-vim-registers-marks-repeat.md)              | Vim registers, marks, macros and repeat                                       |
| [280](280-vim-insert-entry-control.md)                | Vim insert entry and control keys                                             |
| [284](284-resource-aware-heavy-jobs.md)               | Resource-aware heavy jobs and a weak-machine (Raspberry Pi) lane              |
| [285](285-ghostty-site-first-frame-and-real-shell.md) | The ghostty-webgpu site paints before the wasm and runs a real shell          |
| [286](286-ghostty-extensions.md)                      | ghostty-webgpu extensions, with a line editor first                           |
| [287](287-ghostty-worker-mode.md)                     | ghostty-webgpu worker mode: the terminal on an OffscreenCanvas worker         |
| [208](208-all-text-in-json.md)                        | All app text in JSON with Paraglide                                           |

| [209](209-unified-workspace.md) | One workspace for chat and code; design review with implementation gates |

## Package and client plans

[PLAN.md](../PLAN.md) schedules all of these plans. Editor IDs and recorded statuses stay
in the [Editor inventory](editor-backlog.md); its [manifest](editor-backlog.json) supports
`bun run plans:check`. Source and delivery references remain with their packages.

| Plan                                                                                           | Topic                                                                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [e011-packed-piece-tree.md](e011-packed-piece-tree.md)                                         | E011: Evaluate a packed representation of persistent piece trees                       |
| [e014-parallel-search.md](e014-parallel-search.md)                                             | E014: Search immutable snapshots across workers and stream results                     |
| [e015-massive-file-loading.md](e015-massive-file-loading.md)                                   | E015: Design bounded loading for massive files                                         |
| [e016-bounded-structural-parsing.md](e016-bounded-structural-parsing.md)                       | E016: Evaluate bounded structural parsing                                              |
| [e021-styled-clipboard.md](e021-styled-clipboard.md)                                           | E021: Complete styled copy for multiple selections and portable colors                 |
| [e023-instrumentation-panel.md](e023-instrumentation-panel.md)                                 | E023: Inspect editor timing and retained memory                                        |
| [e024-syntax-tree-inspector.md](e024-syntax-tree-inspector.md)                                 | E024: Inspect the live syntax tree                                                     |
| [e025-runtime-plugins.md](e025-runtime-plugins.md)                                             | E025: Design and prove reloadable user plugins                                         |
| [e026-command-metadata.md](e026-command-metadata.md)                                           | E026: Declare Editor command metadata once                                             |
| [e027-extension-hooks.md](e027-extension-hooks.md)                                             | E027: Define and verify the extension hook contract                                    |
| [e029-runtime-and-serialized-data.md](e029-runtime-and-serialized-data.md)                     | E029: Document runtime and serialized data boundaries                                  |
| [e052-proportional-font-extents.md](e052-proportional-font-extents.md)                         | E052: Wrap and horizontal extent from measured advances when the font is not monospace |
| [e056-platform-agnostic-core.md](e056-platform-agnostic-core.md)                               | E056: Extract a platform-agnostic core and prove a Strict DOM host                     |
| [e058-spellcheck.md](e058-spellcheck.md)                                                       | E058: Spellcheck for text the editor paints itself                                     |
| [e063-tree-sitter-queries.md](e063-tree-sitter-queries.md)                                     | E063: More editor features from tree-sitter queries                                    |
| [e064-one-highlight-pipeline.md](e064-one-highlight-pipeline.md)                               | E064: One highlight pipeline for tokens and range highlights                           |
| [e065-injection-and-range-query-cost.md](e065-injection-and-range-query-cost.md)               | E065: Bound injection discovery and independent range-query scheduling                 |
| [editor-authoring.md](editor-authoring.md)                                                     | Editor backlog plan contract                                                           |
| [editor-backlog.md](editor-backlog.md)                                                         | Editor backlog                                                                         |
| [bubli-markdown-consumer.md](bubli-markdown-consumer.md)                                       | Shared Markdown semantics for Editor and Fregat TUI                                    |
| [editor-wishlist.md](editor-wishlist.md)                                                       | TODO                                                                                   |
| [editor-performance-trace-plan.md](editor-performance-trace-plan.md)                           | Performance Trace Report And Plan                                                      |
| [editor-architecture-recovery-plan.md](editor-architecture-recovery-plan.md)                   | Architecture Recovery Plan                                                             |
| [command-palette-vscode-parity-backlog.md](command-palette-vscode-parity-backlog.md)           | > [!IMPORTANT]                                                                         |
| [delta-db-implementation-plan.md](delta-db-implementation-plan.md)                             | Delta DB — Implementation Plan                                                         |
| [deployment-design.md](deployment-design.md)                                                   | Desktop and one-command web deployment                                                 |
| [diagnostic-ai-fix-plan.md](diagnostic-ai-fix-plan.md)                                         | Fix diagnostics with AI                                                                |
| [editor-1000-parity-plan.md](editor-1000-parity-plan.md)                                       | > [!IMPORTANT]                                                                         |
| [editor-parity-implementation-plan.md](editor-parity-implementation-plan.md)                   | > [!IMPORTANT]                                                                         |
| [environments-and-remote-plan.md](environments-and-remote-plan.md)                             | Environments strategy                                                                  |
| [git-panel-implementation-plan.md](git-panel-implementation-plan.md)                           | Git panel and commit graph                                                             |
| [logseq-parity-implementation-plan.md](logseq-parity-implementation-plan.md)                   | > [!IMPORTANT]                                                                         |
| [native-plan-of-plans.md](native-plan-of-plans.md)                                             | Native Mac Client — Plan of Plans                                                      |
| [native-plan-prompts.md](native-plan-prompts.md)                                               | Native Plan Prompts                                                                    |
| [native-syntax-coverage-plan.md](native-syntax-coverage-plan.md)                               | Expand native syntax coverage and improve queries                                      |
| [pane-zoom-plan.md](pane-zoom-plan.md)                                                         | Independent pane zoom implementation plan                                              |
| [structured-semantic-search-evaluation-plan.md](structured-semantic-search-evaluation-plan.md) | Structured And Semantic Search Evaluation Plan                                         |
| [t3code-chat-parity-gap-analysis.md](t3code-chat-parity-gap-analysis.md)                       | T3Code Chat Parity — Verified Gap Analysis and Roadmap                                 |
| [t3code-parity-implementation-plan.md](t3code-parity-implementation-plan.md)                   | > [!IMPORTANT]                                                                         |
| [tui-plan.md](tui-plan.md)                                                                     | TUI — Strategy                                                                         |
| [workspace-content-engine-evaluation-plan.md](workspace-content-engine-evaluation-plan.md)     | Workspace Content Engine Evaluation Plan                                               |
| [workspace-search-next-steps.md](workspace-search-next-steps.md)                               | > [!IMPORTANT]                                                                         |

## Supporting work

- [Tree implementation sub-plans](178-tree-in-the-app.md) and [T3 alignment records](126-t3code-alignment.md)
  stay with their owning plans. The [September 20 execution record](126-t3code-alignment/execution-2026-09-20.md)
  retains its original wrap-up boundary.
- [Editor backlog](editor-backlog.md) and [native client roadmap](native-plan-of-plans.md)
  preserve package/client scopes under the shared roadmap.
- [Research, architecture and delivery records](../docs/README.md) are reference material.
- [Unresolved September 12 audit questions](../docs/defect-audit-follow-ups.md) need current
  reproduction before they become implementation work.

## Maintenance

Add a link when creating a plan. Keep unfinished plans, including ones waiting on owner checks.
Retire a completed plan after preserving current contracts and updating incoming links to the
implementation reference or an immutable historical revision. Git history keeps the full record.
Do not copy completed plans into an archive directory or add a completed-plan ledger here.
