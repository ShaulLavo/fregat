# Known limits

The [source-backed limits inventory](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/limitations.md) records Singapore's measurement ceilings, analysis budgets and bounded package behavior. Each entry gives the exact value, source, behavior beyond the boundary and any work that owns changing it.

Start there when choosing fonts, opening large documents or attaching optional packages. It covers the 32,000-code-unit BiDi measurement ceiling, native scroll-height mapping, Tree-sitter budgets, search highlighting, clipboard output, paging and collaboration transfers. The proportional-text measurement ceiling is marked pending PR #1186.

The [browser quirks document](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/display/browser-quirks.md) separately records engine bugs and their workarounds.

A successful file open does not establish a universal size guarantee or interactive typing budget. Choose representative files and measure your integration with the [large-file guide](https://shaulavo.dev/singapore/docs/guides/large-files/).
