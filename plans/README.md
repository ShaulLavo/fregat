# Plans

[PLAN.md](../PLAN.md) owns execution order and cross-plan dependencies. Each plan below owns
its current status, scope, authorization and acceptance checks. This index lists the files that
exist; it does not duplicate status summaries that drift when a plan changes.

## Current plan files

| Plan                                         | Topic                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| [087](087-stateless-mcp.md)                  | Implement stateless MCP support                                               |
| [088](088-native-code-intelligence.md)       | Build native code intelligence for agents and the editor                      |
| [099](099-document-contributions.md)         | Route document consumers through one contribution runtime                     |
| [108](108-markdown-modes.md)                 | Two markdown modes: split view and live preview                               |
| [110](110-workspace-indexing.md)             | Workspace indexing: what we index, and what should index us                   |
| [111](111-editor-decorations.md)             | Editor decorations: learn from CodeMirror and Lexical, then beat what we have |
| [112](112-large-file-ceiling.md)             | The large-file ceiling: what we can actually open, and who gets to decide     |
| [114](114-polaron-shell.md)                  | Polaron, a desktop shell we own                                               |
| [122](122-composable-plugins.md)             | Composable, full-power plugins with selective execution                       |
| [126](126-t3code-alignment.md)               | Align Platform behavior with pinned T3 Code                                   |
| [132](132-process-and-dev-ownership.md)      | Processes, leases and dev plumbing each get an owner                          |
| [139](139-acting-on-agent-diffs.md)          | Act on the agent's diff                                                       |
| [140](140-editor-agent-advantage.md)         | The editor is the agent's advantage                                           |
| [141](141-usage-and-rate-limits.md)          | Usage, cost and rate limits                                                   |
| [143](143-phone-layout.md)                   | Platform on a phone                                                           |
| [144](144-unattended-agent-work.md)          | Unattended and multi-agent work                                               |
| [145](145-harness-controls.md)               | Surface the controls the harnesses already have                               |
| [147](147-log-hygiene-and-noise-gate.md)     | Log hygiene and a noise gate                                                  |
| [155](155-site-demo-replica.md)              | The site demo becomes an animated replica                                     |
| [156](156-documents-in-the-editor.md)        | Documents in the editor                                                       |
| [166](166-bare-function-keys.md)             | Bare function keys in text fields                                             |
| [169](169-agent-review-mode.md)              | Agent review mode                                                             |
| [170](170-language-census.md)                | Language census for grammar and theme prefetch                                |
| [171](171-composer-on-our-editor.md)         | The chat composer runs on our own editor                                      |
| [172](172-shared-undo-stack.md)              | One shared undo/redo stack                                                    |
| [174](174-external-mcp-servers.md)           | Managed external MCP servers                                                  |
| [176](176-markdown-parser.md)                | One markdown parser                                                           |
| [177](177-prefetch-every-press.md)           | Prefetch every press                                                          |
| [178](178-tree-in-the-app.md)                | The file tree in the app                                                      |
| [179](179-isolating-foreign-content.md)      | Isolating content the app did not write                                       |
| [180](180-file-icon-variants.md)             | File icon variants                                                            |
| [181](181-chat-timeline-end-anchoring.md)    | Chat timeline on TanStack's end anchoring                                     |
| [182](182-search-view-rendering.md)          | Search view rendering                                                         |
| [183](183-claude-ide-in-terminals.md)        | Platform as Claude Code's IDE in its own terminals                            |
| [184](184-dependency-diet.md)                | Dependency diet                                                               |
| [186](186-pull-request-sync-rate.md)         | PR sync: an off switch and a smarter poll rate                                |
| [187](187-setup-scripts-in-terminals.md)     | Setup scripts run in visible terminals                                        |
| [189](189-tree-sitter-md-improvement.md)     | Keep improving tree-sitter-md                                                 |
| [190](190-faster-ci.md)                      | Faster CI                                                                     |
| [191](191-file-picker-polish.md)             | The file picker, resizable and in the app's icons                             |
| [192](192-no-swap-flash.md)                  | Views switch subjects without flashing                                        |
| [195](195-settings-defaults-browser.md)      | Browse Settings defaults in UI and JSON                                       |
| [196](196-shared-control-polish.md)          | Polish sliders, menu switches, and picker triggers                            |
| [197](197-editor-highlighting-service.md)    | Editor-owned highlighting service                                             |
| [198](198-document-owned-editor-analysis.md) | Keep editor analysis with the document                                        |
| [200](200-document-backed-content-views.md)  | Shared documents behind content views                                         |
| [201](201-cheap-overlay-marks.md)            | One-frame typing in large files, starting with cheap underlines               |
| [202](202-unified-workspace.md)              | One workspace for chat and code                                               |

## Supporting work

- [Tree implementation sub-plans](178-tree-in-the-app.md) and [T3 alignment records](126-t3code-alignment.md)
  stay with their owning plans.
- [Editor backlog](../../Editor/plans/README.md) and [native client roadmap](../docs/native-plan-of-plans.md)
  own package/client work outside this index.
- [Research, architecture and delivery records](../docs/README.md) are reference material.
- [Unresolved September 12 audit questions](../docs/defect-audit-follow-ups.md) need current
  reproduction before they become implementation work.

## Maintenance

Add a link when creating a plan. Keep unfinished plans, including ones waiting on owner checks.
Retire a completed plan after preserving current contracts and updating incoming links to the
implementation reference or an immutable historical revision. Git history keeps the full record.
Do not copy completed plans into an archive directory or add a completed-plan ledger here.
