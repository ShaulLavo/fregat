# Duplicate cleanup

The broader scan started with 196 matches: 52 handwritten and 144 generated. Including `scripts/` found eight more matches. Shared implementations now cover protocol validators, provider session plumbing, filesystem recovery and sync, tree construction and sorting, socket adapters, search models, diagnostic sanitization, cache housekeeping, editor focus, dialogs, settings inputs, state operations, and browser fixtures.

`nowMs` has one implementation in `packages/utils/src/timing.ts`. The named-function gate also rejects inline performance-clock/Date fallbacks outside that file.

## Gates

- `bun run dupes` scans `apps`, `packages`, and `scripts`, with a zero threshold. It runs in root `lint`, which CI already runs.
- Existing clone sensitivity remains six lines / 60 tokens. Existing test/build exclusions are unchanged; generated TypeScript remains included.
- `bun run dupes:functions` checks function bodies and clock fallback expressions.
- A deliberate copied source fixture was detected and rejected with exit status 1.

These are detector results, not a claim that automated scanning can prove the absence of every semantically equivalent implementation.

## Verification

Affected server, web, TUI, contracts, client-core, observability, tree, utils, and scripts typechecks pass. Changed-source lint, formatting, design census, and protocol generation checks pass. Focused tests cover filesystem rollback/recovery, workspace indexing and caches, sockets, receipts, projections, provider adapters, tree ingestion, settings buffers, command routing, font input, dialog actions, and sanitizer policies.

Evidence and test logs: `/work/tmp/platform-no-dupes/`. `decisions.tsv` records decisions and corrections; `complete-task.patch` compares this cleanup with its initial dirty-workspace snapshot.

Browser screenshots were inspected:

- `/work/tmp/fregat-evidence/20260919T205820Z-scenario-editor-split-state/`: save from a split, dirty close, cancel, final save.
- `/work/tmp/fregat-evidence/20260919T205907Z-scenario-settings-defaults/`: read-only defaults and return to user settings.
- `/work/tmp/fregat-evidence/20260919T205930Z-scenario-search-input-undo/`: undo in search and replace inputs.
- `/work/tmp/fregat-evidence/20260919T210044Z-scenario-settings-font-input/`: cancel a font draft without changing the saved family.
- `/work/tmp/fregat-evidence/20260919T210206Z-scenario-logs-search-no-flicker/`: log panel and search.

The settings scenarios retain the pre-existing `/themes/bundles` and `/themes/wallpapers` 404 responses and unknown theme-setting warnings. The logs scenario completed but emitted a duplicate React row-key warning; log row identity code was unchanged by this cleanup. These observations are separate from copied source code.

## Review and release

Final results: **0 cloned blocks across 2,161 source files**, **0 duplicated function groups / inline clock fallbacks across 2,224 files**, and **0 duplicate exports**. The independent baseline comparison records all 79 protocol method validators with identical serialized Valibot structure in `/work/tmp/platform-no-dupes/protocol-parity.json`.

Reviewed by **gpt-5.6-sol**: no implementation defects found. The review caught stale audit evidence pointers; superseding rows now point to the complete delta and separate test/browser artifacts. Browser observations above remain visible rather than being reported as a clean console.

Deployed with a server rebuild to **20260919T210659Z-e4ee5f1d-no-duplicates** at <https://omarchy.mesh.shaulavo.dev/platform/>. The release endpoint confirms this release for both web and server. The production live check reports no failures, console errors, or console warnings. Evidence: `/work/platform-production/releases/20260919T210659Z-e4ee5f1d-no-duplicates/live-check.json`.
