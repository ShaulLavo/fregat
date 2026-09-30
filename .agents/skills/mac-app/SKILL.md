---
name: mac-app
description: Build, run, test, and develop the native macOS Swift client in apps/mac (EditorCore, EditorBench, MacApp). Use for any Swift work in this repo, the native editor, or native/plan-of-plans tasks.
---

# Native Mac app development

## Doctrine (do not re-argue)

- `apps/mac` is a SECOND frontend. The web app stays for cross-platform; never propose replacing it.
- The Bun server stays the brain (fs, git, LSP proxy, PTYs, settings). The Swift app is a thin client of the same contracts.
- **Editor-first, editor-gated**: no shell/platform FE work until the from-scratch native editor meets or beats the web editor's measured baselines. Checked-in web numbers live in `editor/docs/architecture/phase-0/performance-baseline.md`; the oft-quoted 5.8 ms typing / p95 6 ms highlight figures are NOT recorded anywhere — plan 1 re-establishes end-to-end baselines via the `__EDITOR_PERFORMANCE_DIAGNOSTICS__` sink. Perf claims come from `EditorBench`, never vibes.
- Plan queue and open decisions live in `docs/native-plan-of-plans.md`. Read it before starting native work; update statuses when a plan lands.
- **Port-first**: wherever the web editor (`editor/`) already solved a problem, port its design 1:1 (its tests are the spec), then Swift-ify (value types, Sendable snapshots, ARC-aware allocation) and fix known mistakes. Design fresh only what the web never had (CoreText layout, NSTextInputClient, NSAccessibility, AppKit). The buffer is the web piece-table treap ported, not a new rope — see `docs/native-editor-internals-research.md`.

## Build/run/test (from `apps/mac`)

```bash
swift build
swift test             # swift-testing (@Test/#expect), not XCTest
swift run EditorBench
swift run MacApp
```

- Requires full Xcode 26+, not Command Line Tools. If `xcodebuild -version` errors with "requires Xcode", the fix is `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (needs the user's password — ask them).
- `apps/mac` is intentionally outside the bun/turbo workspace — no `package.json`, and don't add one.

## Conventions

- Swift idiom wins inside `apps/mac`: PascalCase filenames, one primary type per file. Repo-wide rules that still apply: guard clauses / max nesting 3, short comments, no `else` after early return.
- Placeholder code (like `Document`) is marked with a pointer to the plan doc that will replace it — don't grow placeholders before their design plan lands.
- The type-safety boundary (OpenAPI for REST, codegen for WS events) is plan 3 in the plan-of-plans; don't hand-write mirror types for server payloads.
