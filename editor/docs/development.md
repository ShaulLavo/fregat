# Develop Singapore

How to build, test and check the `editor/` packages. This folder lives in the [Fregat](https://github.com/ShaulLavo/fregat) monorepo. Read the [contribution guide](https://github.com/ShaulLavo/fregat/blob/main/CONTRIBUTING.md) first for the policy on issues, pull requests and AI-assisted changes. [AGENTS.md](../AGENTS.md) lists the conventions that tests do not enforce.

## Set up

You need [Bun](https://bun.sh/) 1.4.4, the version in `packageManager`, and Node.js 26 or newer. From the Fregat root:

```sh
bun install --frozen-lockfile
bun x turbo run build --filter='./editor/packages/*'
```

The second command writes `dist/` for all 23 packages. Packages import each other through `dist/`, so rebuild after you change a package that another one consumes.

## Run the demo app

```sh
bun run --cwd editor/examples/app dev
```

Vite prints the address. The app shows a file tree beside the editor and exercises most packages. It includes a history panel for the undo graph, and `?modal` turns on a modal-editing plugin.

## Run tests

Use package scripts. Do not use `bun test`, which skips the configured Vitest environments.

```sh
bun run --cwd editor/packages/textbuffer test
cd editor/packages/editor
bun x vitest run --project dom test/autoClose.test.ts
```

Each package defines its own `test`, `typecheck`, `lint` and `format:check` scripts. In `packages/editor`, Vitest has projects named `node`, `dom` and `browser`, plus browser projects for layout and paint. The browser projects drive Playwright. Install the browsers they use with `bun --cwd editor/site x playwright install chromium`, and add `firefox` and `webkit` for the cross-engine projects. On Arch Linux, run `scripts/playwright-webkit-arch.sh` from the Fregat root after downloading WebKit.

## Check the whole workspace

Run these from `editor/`:

| Command                         | What it checks                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `bun run typecheck`             | Typechecks every package through Turborepo                                            |
| `bun run lint`                  | Runs oxlint on the scripts and every package                                          |
| `bun run format:check`          | Checks formatting with oxfmt. `bun run format` fixes it across the whole workspace.   |
| `bun run health`                | Checks the full-text boundary, the command reference and the architecture baselines   |
| `bun run commands:reference`    | Regenerates [`docs/commands.md`](commands.md). `health` fails when the file is stale. |
| `bun run --cwd site docs:check` | Compiles every TypeScript example in the site pages and the package READMEs           |

From the Fregat root, `bun run package-pages:check` checks the package metadata and README structure that npm renders, and `bun run plans:check` checks the Editor plan index and the files it links.

## Where things live

| Path              | What it holds                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `packages/<name>` | One published package: `src/`, `test/`, `README.md`, optional `docs/` and `bench/`        |
| `examples/app`    | The demo app                                                                              |
| `examples/stress` | The stress and input-latency harness, with committed results                              |
| `bench/compare`   | The Singapore, Monaco and CodeMirror comparison                                           |
| `site`            | The documentation site: hand-written pages in `src/content/docs`, API reference generated |
| `scripts`         | Workspace tooling, such as the architecture health check and the command reference        |
| `docs`            | [Design documents](README.md)                                                             |

## Write documentation

Package READMEs follow a fixed template that `package-pages:check` enforces: `Install`, `Usage`, `API highlights` and `License` headings, one TypeScript example, absolute HTTPS links, and either an `npm install` line or a line that starts `Not on npm yet.` The site compiles the example, so keep it runnable. The README for a package that `npm view` does not find says `Not on npm yet.`

TypeDoc generates the pages under `reference/api` at build time, and the repository does not commit them. To change one, edit the doc comments in the package source. The [site README](../site/README.md) explains how to build the site.

Link to files inside `editor/` with relative paths. They resolve in Fregat and in the read-only [singapore](https://github.com/ShaulLavo/singapore) mirror. Links to anything above `editor/` must be absolute URLs.
