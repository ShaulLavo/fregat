# Phase 0 Architecture Health

This directory is the Phase 0 baseline for `docs/architecture-recovery-plan.md`.
It is intentionally descriptive before it is aspirational: the files here record the current knots so
future changes can make them smaller deliberately.

## Command

Run the guardrail check from the repository root:

```bash
bun run health
```

Regenerate baselines only when the architecture change is intentional and reviewed:

```bash
bun run health:write
```

The CI workflow `.github/workflows/architecture-health.yml` runs `bun run health` on pull requests,
pushes to `main`, and manual dispatch.

## What The Check Measures

- Ignored local source mirrors: `.desloppify`, `node_modules`, `opensrc`, `references`, build output,
  and VCS/cache directories are excluded from health source scans.
- Package-level cycles between workspace packages.
- Source-level import cycles in `packages/editor/src`, editor virtualization, `packages/lsp/src`,
  `packages/lsp-plugin/src`, and `packages/typescript-lsp/src`.
- Missing package scripts for the root Turborepo contract: `build`, `test`, `typecheck`, `lint`,
  `format`, and `format:check`.
- Duplicate LSP module candidates between `@singapore-editor/lsp-plugin` and `@singapore-editor/typescript-lsp`.
- The current `@singapore-editor/core` public export inventory.
- Production timer usage that must stay justified until Phase 3 scheduling work replaces it.

## Current Known Issues

- Package cycles: none reported in the Phase 0 baseline.
- Source cycles: seven components across the overlapping scan scopes remain in `@singapore-editor/core`
  and `@singapore-editor/lsp-plugin`. The scan includes type imports.
- Duplicate modules: the LSP plugin and TypeScript-LSP packages share four same-name modules.
- Package scripts: every workspace package provides all six expected scripts.
- Public API: 15 explicit entry points are inventoried, including the opt-in debug and keymap APIs.
- Timers: 42 timer, frame, idle, or microtask usages are inventoried, including browser benchmark
  observers. Some older entries retain their Phase 0 legacy justification; new entries require a
  specific scheduler justification in `timer-usage.json`.

The E032 refresh includes earlier public facade additions for chord keymaps, piece-table inspection,
visible paint capture, text-content rendering, and syntax folding. The additional source-cycle
memberships include type dependencies for text measurements, display projection, paint snapshots,
selection reveal, scroll viewports, and row decoration projection; these remain visible to the gate.

## Review Rules

- New public `@singapore-editor/core` exports must update `core-public-api.json` in the same reviewed change.
- New production timers must update `timer-usage.json` with a specific justification. Leaving the
  generated `TODO` text makes `bun run health` fail.
- A new timer ID cannot inherit a reason from another occurrence with the same source text. An inline
  `@justification` travels with its callback; baseline reasons are retained only for the same timer ID.
- Fixed cycles, removed exports, or deleted timers should update the baseline in the same change so
  the checked-in files continue to describe reality.
- Source mirrors belong in `opensrc/` or `references/`; they must not be added under package source
  roots.

## Baseline Files

- `health-baseline.json` records package cycles, source cycles, duplicate modules, ignored roots, and
  missing package scripts.
- `core-public-api.json` records `@singapore-editor/core` package entry points and exported names.
- `timer-usage.json` records production timer usage and required justifications.
- `performance-baseline.md` records the first reproducible performance numbers for Phase 0.
