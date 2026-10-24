# AGENTS.md

Instructions for AI coding agents working in `packages/singapore/` (Singapore). The [README](README.md) maps the packages, and [ARCHITECTURE.md](ARCHITECTURE.md) explains the design. Read [docs/development.md](docs/development.md) for setup.

## Plans

Fregat's [PLAN.md](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md) schedules all work. Write Editor plans in Fregat's root `plans/`, following the [Editor inventory](https://github.com/ShaulLavo/fregat/blob/main/plans/editor-backlog.md) and [authoring contract](https://github.com/ShaulLavo/fregat/blob/main/plans/editor-authoring.md). Run `bun run plans:check` from the Fregat root after you edit the inventory. Do not add `plans/` or `PLAN.md` inside `packages/singapore/`.

## The simple API comes first

Every feature works on an editor that was only given text: `new Editor(element)` and `setText(text)`, or a plugin built from plain options. Documents (an `openDocument` id, a shared `DocumentSession`, a `LanguageServerDocument`) add identity and sharing: persistence, one buffer or one protocol state behind several views. They are supported, and no feature may require one.

- When a feature needs something a document usually supplies, such as a language server's URI, take it as a plain option on the simple path and let a document fill it in when there is one.
- A new capability must not add required setup to the one-line use. If it cannot work without a document, the design is wrong, not the caller.
- Test the simple path. A feature covered only through documents has not proven it works without one.

## Read before you change

- Storage, anchors, or positions: [piece table](docs/storage/piece-table.md), [anchors](docs/positions/anchors.md), and ADRs [001](docs/adr/001-persistent-avl-piece-table.md) and [002](docs/adr/002-anchors-into-immutable-buffers.md). Deleted text stays in the tree as tombstones, because deleted anchors need it.
- Rows, geometry, or paint: [browser layout and virtualizer](docs/display/browser-virtualization.md) and [ADR 004](docs/adr/004-browser-layout-and-css-highlights.md). Add a [browser quirks](docs/display/browser-quirks.md) entry for every browser workaround you put in the code.
- Workers: [worker topology](docs/architecture/worker-topology.md) and [ADR 003](docs/adr/003-document-on-main-thread.md). Each worker has one owner object. Do not add package-level worker singletons.
- Syntax: [tree-sitter](docs/syntax/tree-sitter.md). Selections are anchors, never syntax nodes.
- Plugin hooks: [extension hooks](docs/architecture/extension-hooks.md).
- A limit or ceiling: update [known limits](docs/limitations.md) when you change one.

## Conventions

- Call the text-slice record a Piece. Other editors say "fragment".
- Combine arrays with `concat` and use fresh array results directly, following Fregat's array construction rules. Keep copies needed for ownership, iterable or typed-array conversion, tuple typing, or sparse-array behavior. A performance exception needs measurements.
- Link files inside `packages/singapore/` with relative paths. Links above `packages/singapore/` are absolute URLs, because the [singapore](https://github.com/ShaulLavo/singapore) mirror holds only this folder.
- Package READMEs follow the template that `bun run package-pages:check` enforces from the Fregat root. A package that `npm view` does not find says `Not on npm yet.` in its Install section.

## Generated files

- `docs/commands.md`: run `bun run commands:reference`.
- `docs/architecture/phase-0/*.json`: run `bun run health:write` only for an intended architecture change.
- `site/src/content/docs/docs/reference/api/`: TypeDoc output, gitignored.

## Build and test

Turborepo with Bun. Run tests through package scripts with `bun run test`. Do not use `bun test`; it bypasses the configured Vitest environments.

Before you commit, run the narrowest package test, then from `packages/singapore/`:

1. `bun run format:check`. `bun run format` formats the whole workspace, so it touches unrelated files when formatting has drifted. Keep those incidental changes.
2. `bun run typecheck` and `bun run lint`.
3. `bun run health` for any architecture-sensitive change.
4. From the Fregat root, `bun run unused:check` runs knip and reports unused files, exports, and dependencies across the monorepo.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

- On Arch Linux, run `scripts/playwright-webkit-arch.sh` from the Fregat checkout root after any `playwright install` that downloads a new WebKit, before Firefox or WebKit verification.
