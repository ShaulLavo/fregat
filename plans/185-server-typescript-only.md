# Plan 185: Platform always uses the server TypeScript backend

## Status and authorization

- Status: DONE 2026-09-26 on lane L7 (PR #37), before merge. Owner ruling 2026-09-26.
- Priority: P1. It blocks merging PR #37 (lane L7), which carries the code this plan removes.
- Owner ruling (2026-09-26): "I don't want Platform to know about it at all; that's a mistake. Platform always uses server TS;
  the worker should just be a nice-to-have Editor feature."

## Outcome

Platform runs TypeScript and JavaScript language intelligence only through the server backend. The browser-worker TypeScript
backend stays an Editor-repo feature (`@singapore-editor/typescript-lsp` worker, Editor PR #34) for other Editor consumers,
and Platform has no code, setting, route, bundle or test that refers to it.

## Scope

This plan changes Platform only. The Editor repo and every `@singapore-editor/*` package stay as
they are: the `@singapore-editor/typescript-lsp` browser worker (its worker entry, the plugin that
runs it, and their tests) is a supported Editor feature. Platform stops using it; nothing else
changes.

## What to remove from lane/L7 (before #37 merges)

Plan 153's Platform-side worker integration arrived in `b2a181504`, `f8938d350`, `8ccefa1ba`, `cb01d1c0d` and `37615ac10`,
plus the worker parts of `313daf456` and `959275437`:

- Web: `features/editor/state/typescript-worker-{budget,documents,plugin,project}.ts`,
  `features/editor/utils/typescript-worker-{bytes,paths,query}.ts`, their tests, the worker branch in
  `hooks/use-lsp-plugin.ts`, the `typescriptWorker*` keys in `utils/query-keys.ts`, and any mutation keys.
- Settings: `lsp.typescript.backend` and the worker file and byte limits. Regenerate the schema and reference.
- Server: the `/lsp/typescript/project`, `/lsp/typescript/program-files` and `/lsp/typescript/program-files/read` routes,
  `lsp/typescript/{program-files,worker-program,worker-discovery,worker-discovery-errors,worker-discovery-process,source-dependencies}.ts`
  and their tests, provided nothing on the server backend uses them (check first).
- Build and release: the `worker-discovery-process` bundle (9.48 MB) in the server build script and the release file list.
- Docs and scenarios that describe the worker backend, and the settings reference.

## What stays

- `d482f255f` "Plan 153: exit notification in one shape" and the `$/serverExited` rename: they serve the server backend.
- Everything else in #37: 071 highlight retry, E050 rows, 130 P3 stacked rows, 099 diff-source fix, the diff theme keys,
  and the restored hover Fix with AI.
- The Editor repo's worker backend, which is unchanged.

## Plan 153

Record in Plan 153 that its Platform worker-backend phases are dropped by the owner: Platform stays on the server backend,
and the worker is Editor-only.

## Verification

- `git grep -i "typescript.*worker\|workerProject\|program-files\|lsp.typescript.backend"` in apps/ and packages/ finds nothing.
- Gates, typecheck, the LSP and editor tests, and bundle size (first load and the server bundle) all shrink or hold.
- A scenario: open a TypeScript file and get hover and diagnostics on the server backend.
