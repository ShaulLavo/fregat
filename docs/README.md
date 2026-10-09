# Documentation

[README](../README.md) introduces the app. [Development](development.md) covers running it,
linked checkouts, checks and deployment. [AGENTS.md](../AGENTS.md) is the current working contract.

## Work in progress

- [Execution roadmap](../PLAN.md) and [plan index](../plans/README.md)
- [Wave register](../plans/waves.md)
- [Native client roadmap](../plans/native-plan-of-plans.md)
- [Remaining defect-audit questions](defect-audit-follow-ups.md)

The plan files own status and authorization. A dated investigation or delivery record describes
the revision it inspected; it is not a second implementation queue or proof of today's build.

## Architecture and ownership

| Area                    | References                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files and documents     | [Filesystem boundaries](filesystem-boundaries.md), [document/tab identity](document-and-tab-domain.md), [async operations](async-operation-ownership.md), [workspace indexes](workspace-indexing.md) |
| Document content views  | [Document-backed content views](document-backed-content-views.md)                                                                                                                                    |
| State and UI            | [State ownership](state-ownership.md), [web layering](web-layering.md), [design language](web-design-language.md), [shared patterns](pattern-layer.md)                                               |
| Sessions and machines   | [Session domain](session-domain.md), [worktree lifecycle](worktree-lifecycle.md), [federated environments](federated-environments.md), [remote releases](remote-server-releases.md)                  |
| Editor                  | [First paint](editor-first-paint-design.md), [Markdown experiences](markdown-experiences.md), [external edits/LSP](external-edit-lsp-findings.md)                                                    |
| Keyboard                | [Architecture](keymap/architecture.md), [matching and dispatch](vscode-keymap-development.md)                                                                                                        |
| Terminals               | [Terminal integration](terminal.md), [terminal host](terminal-host.md), [Ghostty package boundary](ghostty-webgpu-brief.md)                                                                          |
| Settings and appearance | [Settings reference](settings-reference.md), [theme bundles](theme-bundles.md)                                                                                                                       |
| Runtime and delivery    | [Boot](boot-and-first-load.md), [HTML bootstrap](html-bootstrap.md), [deployment](../plans/deployment-design.md), [observability](observability-overhead.md), [web push](web-push.md)                |

## Clients

- [Web development](development.md)
- [TUI guide](../apps/tui/README.md) and [TUI design](../plans/tui-plan.md)
- [Native macOS roadmap](../plans/native-plan-of-plans.md) and [editor core](native-editor-core-design.md)
- [Desktop shell work](../plans/114-installed-app.md)

## Research and evidence

- [Async runtime research and architecture](async-runtime/README.md): workers, three libraries, alternatives and measurement grounding

- [UI research index](ui-research/README.md), [document library survey](documents/library-survey.md)
- [Document consumer baseline](document-contributions/baseline-and-inventory.md)
- [Markdown measurements](markdown-parser/measurements.md), [large-file measurements](large-file-ceiling/README.md)
- [Search rendering findings](search-view-rendering-findings.md), [prefetch ownership](prefetch-every-press.md)
- [Dependency licences](dependency-licences.md), [provider prompt audit](prompt-audit.md)
- [Verification records](verification/) and [T3 alignment evidence](../plans/126-t3code-alignment/)

The [completion-wave record](completion-wave.md) and [wave 2/foundations closeout](next-wave.md)
retain historical owner decisions and delivery evidence. Current batch membership lives in the
[wave register](../plans/waves.md). Retired
plans and root scratch documents remain in git history; current references link to their exact
revision where the original measurements or decisions still matter.

Keep generated references with their generators, source-specific READMEs beside their packages,
and raw evidence beside the investigation that uses it. Empty scaffolding and disposable logs
belong outside tracked documentation.

## Product site

The [Fregat landing page](https://shaulavo.dev/fregat/) uses the Plates animated replica
shipped in [PR #1012](https://github.com/ShaulLavo/fregat/pull/1012).
[Plan 155](../plans/155-site-demo-replica.md) records the decision to delete the live-app demo.
See [production product sites](../scripts/product-sites/README.md) for builds and publishing.
