# Plan 170: Language census for grammar and theme prefetch

Status: **research done 2026-09-25** (findings below; the in-app before/after paint measurement belongs to the implementation phases). Split out of [Plan 110](110-workspace-indexing.md) question 7. Decided 2026-09-25: owner — split the language census into its own small plan. Amended 2026-09-26: tree-sitter warm-up joins the scope (see "Tree-sitter has no warm-up"). [Root PLAN.md](../PLAN.md) owns scheduling.

Editor fix (owner question 1, answer (a)) done 2026-09-26 in wave 2, lane E1:
[singapore#41](https://github.com/ShaulLavo/singapore/pull/41), in `editor-ref` `ec3fc15`. A Shiki
session's open carries only its own grammar, edits carry no registrations (84 grammars cost 18.1 ms
to clone per keystroke; now under 0.1 ms), and the worker schedules background languages once per
language. Phase 3's getter and the census phases remain.

## Why

The editor preloads every Shiki grammar and every theme after first paint
(`EDITOR_SHIKI_PRELOAD_LANGUAGES` in
[`shiki-languages.ts`](../apps/web/src/features/editor/utils/shiki-languages.ts), consumed by
`features/editor/state/syntax-highlighting.ts`). A TypeScript project needs about four grammars.
VS Code loads a grammar on the first file of that language; the goal is to be earlier than that
without being exhaustive.

Plan 110 names this the smallest consumer of a workspace index: a fold over extensions that
[`workspace-index.ts`](../apps/server/src/fs/workspace-index.ts) already holds, nearly free, and a
measurable win (110 questions 4 and 7).

## Scope

1. **The census.** Per workspace, count entries per language from what the index already holds.
   No new reads, no parsing. It inherits the index's readiness states (`cold`, `building`,
   `ready`, `stale`, `failed`), and a consumer can ask for them.
2. **The consumer.** The editor's grammar and theme prefetch reads the census and preloads the
   languages the workspace contains. When the census is not `ready`, it falls back to today's
   behaviour (110 question 6).
3. **The measurement.** Before and after, on a real repository: grammars loaded, bytes fetched and
   time to first highlighted paint, per [AGENTS.md § Optimization](../AGENTS.md#optimization-and-performance-work).

## Open questions

1. Where does the census cross to the client: a query of its own, or a field on an existing
   workspace response?
2. Which extensions count, and how are ignored and default-ignored entries treated?
3. Is there a floor below which a language is not prefetched?

## What this plan does not do

- It does not answer Plan 110's other questions (storage, symbol index, document graph,
  content classification). Those stay in 110's research.
- No change to the index's watcher or search behaviour.

## Research findings (2026-09-25)

Read from `origin/main` at `9f343825`; no open PR branch carries a different version of this plan.
Editor at `c23cd30`. Probes and raw output are in `/work/tmp/research/170/` (throwaway).

### What the preload does today

- **Only the Shiki path preloads.** Shiki runs when the code theme is not a built-in
  (`syntax-highlighting.ts:47-57`). The defaults `dark-plus` / `light-plus` are Shiki themes
  (`packages/contracts/src/settings/keys.ts:275-293`), so this is the default path. The native
  tree-sitter path has no preload at all.
- **Themes are not preloaded after first paint.** Platform never passes `preloadThemes`
  (`syntax-highlighting.ts:87-95`), so a session loads only the active theme. All 66 bundled
  themes load only when the command palette's theme group mounts
  (`color-theme-groups.tsx:16-18` → `color-theme-store.ts:219-224`), for hover preview. Themes are
  per user, not per workspace, so the census has nothing to say about them.
- **When it fires.** After the first Shiki document's first highlight result
  (`packages/editor/src/shiki/workerClient.ts:403`), the main thread imports all 53 language
  modules (`plugin.ts:249-264`) and posts them to the worker. The worker waits 1 s, then loads
  them (`shiki.worker.ts:254-269`). The Editor's own measurement: loading the 53-language set
  costs **1 280–1 780 ms** of worker time (`shiki.worker.ts:216-220`, Editor `f92cac7`). That is
  the one Shiki worker thread, so opens and edits queue behind it.
- **What it costs in bytes.** The 53 ids expand to **84 unique grammars** (ruby alone pulls 30,
  including cpp at 785 KB raw). Transitive chunk closure in the deployed build
  (`/work/platform-production/current/web/assets`, import graph walked from each language's entry
  chunk): **119 chunks, 3 661 823 bytes raw, 485 704 gzip.** The mesh serves them uncompressed
  (`curl -H 'Accept-Encoding: gzip, br'` on `typescript-*.js` returns `content-length: 181067`, no
  `content-encoding`), so first-visit wire cost is the raw number. Chunks are
  `immutable`, so later visits pay parse and worker load, not network.

### Two Editor-side costs the census only shrinks

Neither is in this plan's scope; both scale with the preload set, so they matter for the phase
ordering.

1. **Registrations ride on every message.** A session resolves its registrations once, and that
   set includes every grammar already loaded from the preload list (`plugin.ts:225-247`,
   `cache.loadedLanguages(preloadLanguageNames)`). `documentOptions()` puts it on every `open`
   **and every `edit`** payload (`workerClient.ts:513-555`), and `postMessage` structured-clones
   it (`workerClient.ts:266`). So every document opened after the preload settles clones up to 84
   grammars (3.47 MB of JSON as an object graph) per keystroke. Measured in headless Chromium (Playwright 1.63), median of 40, echo worker
   (`/work/tmp/research/170/clone-bench.mjs`):

   | Registrations carried    | `structuredClone` | `postMessage` round trip |
   | ------------------------ | ----------------- | ------------------------ |
   | 1 (typescript)           | 0.4 ms            | 0.5 ms                   |
   | 4 (ts, tsx, json, md)    | 1.1 ms            | 1.2 ms                   |
   | 84 (today's preload set) | 13.9 ms           | 14.0 ms                  |

   Fourteen milliseconds per keystroke is most of a frame, spent on grammars the worker already has
   (`ensureLanguages` filters them out by name, `shiki.worker.ts:237-245`).

2. **A document opened in the preload window loads the whole set before its first paint.** Between
   the main-thread imports resolving and the worker's 1 s timer, a new session's `open` carries the
   loaded set, and `ensureHighlighter` loads every missing grammar in front of the paint
   (`shiki.worker.ts:221-245`). That re-creates the 1.3–1.8 s stall the timer exists to avoid.
   The worker also dedupes background loading per highlighter (`backgroundLoaded`,
   `shiki.worker.ts:43, 259-261`), so a second preload with a different language set, such as
   after a workspace switch, is ignored.

### Tree-sitter has no warm-up (added 2026-09-26)

Found while investigating markdown files that paint as raw source before their live-preview
decorations land. Read from Platform `d42184dc` and Editor `74e76be`.

- **Tree-sitter is on the paint path in every theme.** With a built-in theme (`tree-sitter-dark`,
  `tree-sitter-light`) it provides the colours. With any theme it provides folds, brackets and the
  captures markdown's live preview is built from, so markdown decorations wait on it even under
  Shiki. The shipped defaults `dark-plus` / `light-plus` are Shiki themes.
- **Nothing warms it.** Shiki gets `preloadLanguages` (`syntax-highlighting.ts:89`); the tree-sitter
  provider gets nothing. Its worker starts on the first request (`getWorker`,
  `Editor/packages/tree-sitter/src/treeSitter/workerClient.ts:341`), `init` then loads
  `web-tree-sitter.wasm`, each language descriptor resolves on first use through the registry's
  lazy `load()`, and the worker compiles each grammar's wasm and queries the first time it needs
  them.
- **Markdown pays the most.** Its injection closure is seven descriptors (markdown,
  markdown_inline, html, javascript, css, regex, jsdoc), resolved one after another in
  `withInjectedLanguages` (`Editor/packages/tree-sitter/src/session.ts:350`). TypeScript's is
  three.
- **Effect.** The first file of each language pays the worker start, the wasm and its grammars,
  inside its hover preparation or after the click when nothing prepared it. Prepared-open logs,
  2026-09-23 to 26: markdown stages averaged 257 ms (Shiki) and 191 ms (tree-sitter), n=8;
  TypeScript 45 ms and 23 ms, n=17. Markdown's Shiki stage costing five times TypeScript's with a
  smaller grammar is unexplained; the per-message registrations above are one candidate.

Scope addition: the consumer warms tree-sitter from the same census and floor. After first paint it
starts the worker, registers the census languages with their injection closures, and compiles their
wasm. A language below the floor still loads on demand, as it does for Shiki.

### The census on real repositories

Probe: the real `buildWorkspaceIndex` over each root, then a fold over `entryMap()` keyed by
`extension || basename`, then the web's own `languageIdForFilePath`
(`apps/web/src/features/editor/utils/file-path.ts:134-148`) per key. Files only, gitignored and
default-ignored excluded. Times are wall-clock in Bun on this machine.

| Repository          | Index build | Files  | Fold   | Map keys → languages | Languages found |
| ------------------- | ----------- | ------ | ------ | -------------------- | --------------- |
| Platform (worktree) | 177 ms      | 4 500  | 0.2 ms | 0.09 ms, 32 keys     | 12              |
| Editor              | 209 ms      | 1 416  | 0.1 ms | 0.08 ms, 26 keys     | 10              |
| references/opencode | 881 ms      | 6 573  | 0.3 ms | 0.16 ms, 61 keys     | 18              |
| references/codex    | 753 ms      | 8 673  | 0.4 ms | 0.20 ms, 84 keys     | 19              |
| references/vscode   | 2 713 ms    | 18 844 | 1.1 ms | 0.24 ms, 195 keys    | 35              |
| references/serena   | 214 ms      | 1 118  | 0.1 ms | 0.28 ms, 122 keys    | 43              |

(`references/zed` is a sparse checkout, 150 files; excluded.) The fold is noise next to the
build it rides on: 1.1 ms for 18 844 files is 0.04 % of vscode's build.

The long tail is test fixtures. vscode's 35 include 14 languages with one to five files
(`extensions/*/test/colorize-fixtures`); serena's 43 are one small project per supported
language server. Preload cost per candidate floor, same chunk-closure method as above:

| Repository | Floor ≥ 1 file                                    | Floor ≥ 5 files                | Floor ≥ 0.5 % of files      |
| ---------- | ------------------------------------------------- | ------------------------------ | --------------------------- |
| Platform   | 12 langs, 13 grammars, 940 KB                     | 9 langs, 811 KB                | 5 langs, 5 grammars, 594 KB |
| Editor     | 10 langs, 783 KB                                  | 7 langs, 535 KB                | 6 langs, 525 KB             |
| opencode   | 17 langs, 885 KB                                  | 13 langs, 751 KB               | 7 langs, 502 KB             |
| codex      | 19 langs, 24 grammars, 1.63 MB                    | 13 langs, 680 KB               | 9 langs, 9 grammars, 410 KB |
| vscode     | 35 langs, 42 grammars, 2.57 MB                    | 18 langs, 27 grammars, 2.14 MB | 9 langs, 9 grammars, 726 KB |
| serena     | 43 langs, 58 grammars, 2.83 MB                    | 32 langs, 2.55 MB              | 32 langs, 2.55 MB           |
| _today_    | 53 langs, 84 grammars, 3.66 MB (every repository) |                                |                             |

Bytes are raw (what the mesh sends). A ≥ 1 floor saves little on a polyglot repository; a share
floor gets a TypeScript monorepo to four or five grammars, as Plan 110 predicted. A language
below the floor still highlights: the document's own grammar always loads on demand
(`plugin.ts:231`), so the floor only decides who waits for one import on first open.

### Answers to the open questions

**1. Where the census crosses to the client.** A query of its own.

- The existing responses carry the wrong moment. `POST /fs/workspace-root` installs the index and
  returns at once (`service.ts:217-229`), while the build runs asynchronously
  (`service.ts:730-743`), so its `workspaceIndex` is always `building`. `GET /health` is a
  snapshot the file picker reads once (`features/file-picker/hooks/use-server-info-for-open.ts`). Neither is revisited when
  the build finishes, and nothing pushes readiness to the client.
- The server keeps one index scope, replaced on every workspace open (`service.ts:670-688`). The
  census request names its root and gets `cold` when the scope is some other root.
- The route can hold the request until the in-flight build settles (`scope.startup`), bounded by
  the request signal. The consumer runs after first paint and is not latency-bound, so the client
  needs no polling and the route answers with the readiness it ended in.
- **Send keys, not language ids.** The extension → language map lives in the web
  (`file-path.ts:4-148` plus tree-sitter metadata), and the language → Shiki grammar step is split
  between `EDITOR_SHIKI_LANGUAGE_MAP` and the Editor's private `shikiLanguageForSession`, which
  turns `.jsx` into `jsx` and `.tsx` into `tsx` (`plugin.ts:148-159, 311-319`). The server
  returning `{ key: count }` keeps one mapping, on the client. Payload: 26–195 keys.
- **Recommendation:** `GET /fs/workspace-index/languages?root=…` →
  `{ readiness, scanRoot, counts: Record<string, number> }`, read as a TanStack query in the
  owning machine's query client (`lib/environments/state/query-clients.ts:21-25`) with a long
  `staleTime`. Fold on demand over `entryMap()`; an incremental counter in `applyCountDelta`
  (`workspace-index.ts:381`) is not worth its code at 1.1 ms on vscode.

**2. Which entries count.** Recommendation:

- Effective type `file` (`targetType ?? type`, so a symlink to a file counts; the probe used
  `type` and slightly undercounts).
- Exclude `gitIgnored` and `defaultIgnored`. Children of ignored directories are never in the
  index (`shouldScanChildren`, `workspace-index.ts:805-812`); what remains are ignored files at
  scanned levels (`.env.local`, logs), which changed nothing in the probe.
- Include hidden entries. On Platform, excluding them drops 4 of 5 YAML files
  (`.github/workflows`) and 13 of 22 Python files.
- Key is `extension || lowercased basename`, so `Dockerfile`, `Makefile` and extensionless
  dotfiles such as `.babelrc` map the same way `languageIdForFilePath` maps them. Named files with
  an extension (`Cargo.lock` → toml in tree-sitter metadata, json by extension) come out wrong;
  that costs at most one extra grammar.
- Keys that map to a language without a Shiki grammar (opencode's `mdx`) are dropped on the client.

**3. A floor.** Recommendation: **a share floor, 0.5 % of counted files, plus the document's own
language.** File count predicts whether a language will be opened; the preload cost is per
grammar, not per file, and one-file fixture languages are the expensive tail (vscode: 35 → 9
languages, 2.57 MB → 726 KB). The one pathological shape, serena, has 32 languages above
0.5 %, which is the truth about that repository. Put the fraction in code as a constant; it is
not a user-facing knob.

### Fallback

Plan 110 question 6 decided that a census that is not `ready` falls back to today's behaviour.
That fallback is the expensive path (84 grammars, 1.3–1.8 s of worker time, per-keystroke
clones). It still applies to `cold`, `building` past the request bound, `failed`, and a remote
machine whose server predates the route. `stale` is
safe to use: stale entries are still present and counted.

### Owner questions

1. **Fix the Editor payload first?** The per-message registrations and the preload-window stall
   (above) are Editor bugs the census only shrinks.
   - (a) An Editor plan ahead of this one: sessions send their own grammar once, edits send none,
     the worker dedupes background loads per language.
   - (b) Ship the census first and file the Editor plan after.
   - (c) Leave the Editor as is.
   - **Recommendation: (a).** It is the larger win for every workspace, including the fallback
     path, and Phase 3 needs the same Editor option change anyway.
   - Decided 2026-09-26: owner — (a): the Editor payload fix lands before the census.
2. **Drop "theme" from this plan's title and scope?** Themes are not preloaded after first paint,
   and the census cannot inform them. **Recommendation: yes;** the palette-open preload of 66
   themes is a separate question if it matters.
   Decided 2026-09-26: recommendation (coordinator) — yes; the plan covers grammars only.

### Proposed phases

1. **Server route.** `GET /fs/workspace-index/languages`, fold over `entryMap()`, waits on
   `scope.startup` under the request signal, `cold` for another root. Test against a temp
   workspace through the real server fixture.
2. **Client census.** Query options and key in the editor feature; `shikiGrammarsForCensus(counts)`
   built on `languageIdForFilePath` and the same Shiki-id step the session uses, moved to one
   exported function in the Editor so the two cannot drift. Share floor applied here.
3. **Consumer.** The Editor's `preloadLanguages` accepts a getter (as `preloadThemes` already
   does, `plugin.ts:33`); Platform passes one that reads the census from the query cache and
   falls back to today's list. The provider is a module singleton (`syntax-highlighting.ts:84-97`),
   so the getter is read at preload time, not at construction.
4. **Tree-sitter consumer.** The tree-sitter provider gains the same getter-driven warm-up: start
   the worker after first paint, then register and compile the census languages with their
   injection closures. Worker-side dedupe per language, as for Shiki.
5. **Measurement.** `editor-syntax-benchmark` (shiki engine, settle background) and
   `editor-reload-paint` on Platform and on vscode, before and after: grammars loaded, bytes
   fetched, first highlighted paint, and worker busy time after paint. For tree-sitter: time to the
   first tree-sitter result for the session's first markdown file, and frames until its decorations
   appear, using [Plan 177](177-prefetch-every-press.md)'s Phase 0 scenario.
