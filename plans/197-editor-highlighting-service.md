# Plan 197: Editor-owned highlighting service

## Status and outcome

- Status: APPROVED, 2026-09-27. Delivered 2026-09-30: [PR #202](https://github.com/ShaulLavo/fregat/pull/202) was independently reviewed, its repairs were checked, and it merged as `bfabd3cb7`. Web release `20260930T163634Z-bfabd3cb-main` passed its live check and a read-back mesh `look`; the Editor, Ghostty and hotkeys mirrors were green at their exact heads. Remaining limits are listed under "Progress 2026-09-30".
- Inspected: Platform `9c08916bf`, linked Editor `52099144`. Recheck both heads and CI's `editor-ref` before implementation.
- Outcome: Editor supplies one reusable highlighting service. Plugins, diffs, Settings previews, and rendered code consume it. Platform supplies configuration and theme data without selecting engines or constructing workers.
- Scope: a facade over existing Editor providers/workers, followed by bounded consumer migrations. Other plugin candidates are assessment only. Wallpaper image loading and Settings layout remain separate work.

Planning checklist:

- [x] Trace spelling, LSP ownership, highlighting workers, previews, and Markdown fences.
- [x] Compare two API shapes and reconcile independent architecture reviews.
- [x] Define ownership, semantics, implementation units, and checks.
- [x] Check document formatting, index registration, and required repository gates/types.

## Grounding

Spelling already separates computation from presentation. Editor's `packages/spellcheck/src/service.ts` exports `SpellcheckService`. Its `check(words)` accepts an array of words and returns misspellings; it also supplies suggestions and accepted-word state. The worker starts on demand. `plugin.ts` requires an injected `SpellcheckChecker`, while its controller tokenizes prose and paints ranges. There is no current `check(text)` method or optional plugin-created spelling service.

Optional ownership has a separate precedent. `packages/lsp-plugin/src/document.ts` exports `LanguageServerDocument`: views borrow it and its creator disposes it. The plugin disposes its document only when the caller did not supply one. Highlighting adopts that ownership distinction.

| Existing path                                                                              | Responsibility and gap                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor `packages/editor/src/shiki/plugin.ts`                                               | Separate provider/plugin factories, registration caches, engine-specific resolver configuration.                                                                                               |
| Editor `packages/editor/src/shiki/workerClient.ts` and `shiki.worker.ts`                   | Lazy worker, explicit runtime sessions, theme/language registrations, incremental edits, recoloring, packed tokens, and disposal. Oniguruma initialization and tokenization run in the worker. |
| Editor `packages/tree-sitter/src/index.ts`, `session.ts`, and `treeSitter/workerClient.ts` | Provider/plugin separation, worker-backed sessions, captures, folds, injections, and structural selection.                                                                                     |
| Platform `features/editor/state/syntax-highlighting.ts` and `utils/plugins.ts`             | Both provider families and engine choice. Tree-sitter remains available for structure when Shiki supplies colors. Diffs/prepared documents share these providers.                              |
| Platform `lib/code-theme/state/preview.ts`                                                 | Separate main-thread Shiki instance for the fixed TypeScript sample, including built-in themes that use Tree-sitter in the editor.                                                             |
| Platform `lib/code-highlight/` and `packages/markdown/src/utils/shiki-highlighter.ts`      | Another main-thread Shiki path: per-palette instances, dual-theme tokens, synchronous-cache-or-callback API, and host color normalization.                                                     |

Preview history introduced the separate instance in `99550068f`; editor worker infrastructure already exists in that revision. `da272416b` disabled the tokenization time limit, `fc97d36a0` moved acquisition into queries, and `3aec85c51` deferred imports. No documented reason to bypass the workers was found.

The motivating trace found a 90.2 ms main-thread task dominated by `highlightPreview`. It supports removing synchronous preview tokenization, but does not establish the cause of the owner's Wallpaper hitch. The scenario reached loaded wallpaper images in desktop Chromium at phone dimensions, using wheel events and a final programmatic scroll. Safari/image behavior remains unconfirmed. Evidence: `/work/tmp/fregat-evidence/20260927T131817Z-trace-settings-wallpaper-scroll/`. The engine-swap experiment was reverted.

## Architecture decision

Create the optional Editor package `@singapore-editor/highlighting`, above `core`, `tree-sitter`, and `tree-sitter-languages`. Tree-sitter already depends on core, so placing the aggregate implementation in `core/syntax` would reverse that dependency.

| Candidate                                                  | Decision                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add standalone highlighting to `EditorHighlighterProvider` | Reuses a small interface, but leaves structural registration, engine choice, grammar loading, and lifecycle coordination in Platform. Reject as the final public API; retain it internally where useful. |
| Editor-owned service plus plugin adapters                  | Hides those responsibilities and composes existing worker/session implementations. Choose this shape.                                                                                                    |

The service owns engine policy, language alias resolution, lazy grammar loading, theme registration, and worker lifetime. This is no new parser, worker protocol framework, or common base class for every plugin. Platform's workspace census remains an optional list of language identities; Editor translates and schedules prewarming.

### Caller-first API sketch

Names are proposed. Reconcile them with existing public exports before implementation.

```ts
import { createHighlightingService, createHighlightingPlugin } from '@singapore-editor/highlighting'

const highlighting = createHighlightingService({
  resolveTheme: themeCatalog.resolve,
  preloadLanguages: () => workspaceLanguageIds,
})

const syntax = createHighlightingPlugin({
  service: highlighting,
  theme: selectedTheme,
})

const result = await highlighting.highlight(sample, {
  language: 'typescript',
  theme: previewTheme,
  signal,
})

await highlighting.dispose()

// Simple editor use creates an activation-owned service.
const simpleSyntax = createHighlightingPlugin()
```

`themeCatalog.resolve` is illustrative configuration, not a required new Platform abstraction. Editor supplies valid default theme/language assets for the simple path. A snippet needs no DOM node, Editor instance, DocumentSession, public document ID, or worker handle.

Theme input describes actual data: an Editor palette or imported VS Code theme. It has no engine selector. The plugin accepts a per-binding theme or existing getter/subscription pattern. A snippet captures an explicit theme revision without changing a service-global active theme.

Derive the standalone boundary from that usage:

```ts
type HighlightTheme =
  | { readonly format: 'editor'; readonly definition: EditorTheme }
  | { readonly format: 'vscode'; readonly definition: VscodeThemeDefinition }

type HighlightOptions = {
  readonly language: string
  readonly theme?: HighlightTheme
  readonly signal?: AbortSignal
}

type HighlightResult = {
  readonly language: string
  readonly themeRevision: string
  readonly tokens: readonly Readonly<EditorToken>[]
  readonly foreground: string
  readonly background: string
}

interface HighlightingService {
  highlight(text: string, options: HighlightOptions): Promise<HighlightResult>
  dispose(): Promise<void>
}
```

Reuse existing Editor theme/token style types. Tokens use UTF-16 offsets into exactly the submitted text; preserve gaps, Unicode, newlines, empty input, and font styles. Results and nested styles are immutable. A renderer derives lines without importing Shiki's `TokensResult`, packed transport types, or HTML style conventions.

Keep `PackedEditorTokens`, `EditorTokenStore`, snapshots, and incremental patches on the document path. Convert short snippet output inside Editor; do not expand large documents into object tokens to share the snippet interface. Tokenize the complete multiline sample, preserving grammar state across lines.

The service/plugin composes the existing document providers. Prepared opens and diffs borrow the same service. Put any shared domain contract required by core/diff in core's existing public surfaces, with no runtime import back into the aggregate. Platform passes service/theme into Editor adapters and stops branching on backend tags. Final adapter signatures must preserve the existing packed and exact-revision contracts.

### Theme and language semantics

- Built-in Editor themes retain Tree-sitter scope/style resolution where the document path supports it.
- Imported VS Code themes retain Shiki/TextMate colors. Tree-sitter continues to supply structure where enabled, including folds, brackets, injections, selection, and captures.
- Settings previews follow the same policy. Align the current synthetic-Shiki built-in preview with the real editor deliberately; record expected color changes and verify sample parity.
- Preserve aliases, extension inference, JSX/TSX distinctions, embedded languages, and current document fallback behavior. Define standalone unknown-language fallback inside Editor.
- Preserve Markdown's wider language set, including languages supplied only by Shiki. Do not reduce fence coverage to the Tree-sitter registry.
- Theme identity includes content revision, not only name or dark/light mode. Same-name imported themes with changed content cannot share stale colors.
- Keep registration normalization and mutations inside Editor.
- Preserve Markdown's light/dark rendering contract through Editor-owned requests and a renderer adapter. Concurrent requests suffice initially; add a batch API only for demonstrated need.
- Move proven color-normalization rules into Editor's shared style resolution. Cover CSS custom properties and font styles with golden cases; check worker output before retaining current workarounds.

### Ownership, concurrency, and failures

One explicit service owns lazy worker owners, registration caches, and grammar/theme acquisition. Platform stores the shared service at application/resource lifetime below feature boundaries. Themes, messages, preview rows, and tabs reuse it.

An injected service is borrowed. Plugin disposal releases subscriptions, registrations, and sessions, never the shared service. An omitted service is created per plugin activation, then disposed after that activation's consumers detach. Reusing a plugin definition across two editors must not let one teardown terminate the other. Do not use a hidden page-global default as the new ownership contract.

Snippets use independent transient runtime sessions and release their worker document state after success, abort, or failure. Document replies keep existing snapshot/version checks. An aborted or superseded request cannot publish into a new preview, theme, reopened document, or disposed service.

Cancellation rejects the caller and suppresses publication; it does not terminate a shared worker. Synchronous tokenization already running inside that worker may complete before cleanup. Do not promise preemption the engine cannot provide.

Reuse current queues and per-document ordering. Deduplicate safe acquisition while isolating each request's palette/session state. Canceling one subscriber must not cancel another's shared grammar load. Preview bursts must not queue a global theme change or large batch ahead of interactive edits; measure contention before adding scheduling machinery.

Keep caches scoped and disposable. Do not add an unbounded text-to-token cache. Consumer resource queries retain preview results by exact content/theme revision; document stores retain incremental state. Measure transient-session retention after repeated previews.

Unsupported syntax may return documented plain text. Operational failures must remain distinguishable from successful highlighting. Reuse Editor's error/reporting boundary, settle each pending request once, and allow only bounded recovery. Never silently fall back to heavy main-thread tokenization. UI consumers retain a correct held result or use their existing plain/error presentation. Repeated disposal is safe and leaves no live listeners or pending requests.

## Implementation units

### 1. Add the Editor service and adapters

- [x] Recheck source/API drift and package dependency directions.
  - Editor is `editor/packages/` in this repo since Plan 207; no `editor-ref` exists. `highlighting` depends on core (peer), tree-sitter, tree-sitter-languages and `shiki`; nothing below imports it.
- [x] Add public package exports, build entries, metadata, and built-entry smoke tests. Keep worker assets lazy.
  - Root workspaces glob, `knip.json`, `.changeset/config.json`; tests import the built core worker asset.
- [x] Move engine policy, grammar/alias loading, and registration ownership into Editor; reuse current workers/providers. Do not duplicate Platform tables into another live owner.
  - `languages.ts` uses Shiki's bundled grammar/alias table; Platform `shiki-languages.ts` deleted.
- [x] Implement standalone highlighting, theme revisions, immutable output, abort behavior, and transient-session cleanup.
  - A stateless `highlight` worker request on one snippet highlighter; themes load under `name@contentHash`, so no document state is created or left behind.
- [x] Implement optional-service plugin ownership and preserve Tree-sitter structure under Shiki colors.
- [x] Adapt prepared documents and diffs without changing packed/incremental or exact-revision behavior.
  - Prepared opens and diffs take `service.highlighterProvider(EDITOR_THEME_SOURCE)` / `syntaxProvider()`, the same instances the plugin registers; the document path is unchanged.
- [x] Take over prepared diff syntax from Platform (Plan 177 Phase 3, added 2026-09-28).
  - `DiffSyntaxStore` in `highlighting/src/diffs.ts` owns keys (per-side content fingerprint + palette scope), running preparations, viewed counts and the 16-side bound; the service exposes `canPrepareDiff`, `prepareDiff` and `showDiff(plugin, file, side, theme)`. Platform's store, fingerprint and claim/store/view functions are deleted; `diff-syntax-preparation.ts` keeps only the intent mutation.
  - Today Platform's `features/editor/state/prepared-diff-syntax.ts` owns a 16-side store of the
    Editor's `PreparedDiffSyntaxSource` objects, each holding a live session. Platform also owns
    the store's key (a fingerprint of each side's drawn lines), its eviction, the map of
    preparations still running, the set of views on screen, and clearing the store when a provider
    is disposed.
  - Move all of that into the service. The diff plugin then finds or awaits prepared syntax by
    content, and a closing view hands its parse back to the service. Platform keeps only the
    intent call ("prepare this diff" when a git read settles), which runs through the service.
  - Delete Platform's store, `claimPreparedDiffSyntax`, `storePreparedDiffSyntax`,
    `viewDiffSyntax` and the per-source clearing in `syntax-highlighting.ts`.
    `prepareDiffSyntax`, the `setFile(file, prepared)` input and `releasePreparedSyntax()` become
    service internals, or are removed.
  - Keep: a hovered diff and a revisit paint colour with their first rows; a view awaits a running
    preparation instead of parsing twice; no preparation starts for a diff already on screen or a
    read already claimed.
- [x] Take over the tree-sitter warm-up. Plan 170 already made it a `warmLanguages` getter on the
  - Service option `preloadLanguages`, fed by the language census through `bindHighlightingLanguages`.
    tree-sitter provider; the service accepts the same getter (its `preloadLanguages`) for both
    engines.
- [x] Migrate affected Editor examples/callers, then remove superseded setup paths. Retain low-level engine APIs only where independent consumers still need them.
  - The example app points at `createHighlightingPlugin`. `examples/stress` keeps the low-level Shiki and Tree-sitter factories because it benchmarks the engines themselves.
- [x] Document simple-plugin, shared-plugin, standalone, and creator-disposes usage.
  - `editor/packages/highlighting/README.md`.

### 2. Migrate Platform editor documents and Settings previews

- [x] Merge/push/build Editor first; bump Platform's exact `editor-ref` in `.github/actions/setup/action.yml` with the consumer change.
  - Superseded by Plan 207: Editor is built from `editor/packages/` in this repository; there is no `editor-ref`.
- [x] Add the package using existing linked-package symlink/override/CI provisioning conventions. Verify built exports from a clean CI clone.
  - Root workspaces, `knip.json`, `.changeset/config.json`; `bun run build:workspaces` builds it and the web bundle gate imports its dist.
- [x] Create one shared application resource owner. Platform supplies themes, language census, and product enablement.
  - `apps/web/src/lib/highlighting/state/service.ts`.
- [x] Replace provider/worker ownership and the custom engine-switch plugin in `features/editor/state/syntax-highlighting.ts` and `utils/plugins.ts`. Preserve settings, diffs, prepared opens, and supported inspection/idle hooks.
- [x] Replace `lib/code-theme/state/preview.ts` with a resource query calling the service, keyed by exact theme revision. Retain visibility-triggered work and held-result behavior.
  - Keyed by theme id: registrations are immutable for a build (`staleTime: 'static'`), and the service's `themeRevision` separates content inside the worker.
- [x] Migrate preview rendering to Editor token styles; delete the private engine and unused conversion path.
- [x] Audit direct Shiki imports/dependencies before removal. Markdown still uses them until unit 3.
  - No `shiki` imports remain in `apps/web/src` or `packages/markdown/src`; `@shikijs/langs` dropped from apps/web and `shiki` from packages/markdown.

### 3. Migrate rendered Markdown

- [x] Replace `packages/markdown/src/utils/shiki-highlighter.ts` and Platform's per-theme engine cache with a thin shared-service adapter.
- [x] Change `CodeHighlighter`'s Shiki-specific result seam to renderer-neutral tokens. Preserve exact-content caching, streaming updates, and stale-result suppression.
  - Streaming holds the last answer while text only appends (`highlighted-code.test.tsx`, scenario `stream-code-colour`).
- [x] Keep cold plain-text output followed by highlighted output. A warm cache can answer synchronously; a worker request remains asynchronous.
- [x] Verify wide language coverage, both theme modes, and color normalization.
  - Wide set: fences resolve through Shiki's full alias table (`highlightingGrammar`), unknown labels render plain. Both modes: fences use the imported registration of the active mode. Normalization: the CSS custom-property recolouring never matched worker output and is deleted; palette variables resolve through core `resolveEditorThemeColor`.
- [x] Delete duplicate engine construction, obsolete grammar maps/result types, and dependencies proven unused. No Markdown parser rewrite.
  - The CSS custom-property recolouring was deleted: worker output tokenizes `--accent` and `:` separately, so its regex never matched.

### 4. Verify and ship completed consumer units

- [x] Editor API tests: text-only simple plugin; standalone snippet without DOM/document; borrowed/owned disposal; simultaneous themes; same-name changed content; multiline/Unicode/empty/style goldens; unknown language; unavailable/crashed worker; abort during acquisition/tokenization; no leaked transient sessions.
  - `editor/packages/highlighting/test/`: plugin (text-only, borrowed/owned, theme switch), service (unavailable, abort, disposal, aliases), service.browser (goldens, Unicode, empty, unknown, same-name themes), structure.browser (Tree-sitter palette path and session release, Shiki fallback, revisions, default palette, crashed worker, shared abort, retention, diff reuse, pending reuse, leave-before-settle, bound). Chromium 17 browser + 10 node; Firefox and WebKit 34 via `test:engines`.
- [x] Document regressions: incremental edits/recoloring, two views, exact prepared revision, diffs, theme switch with pending replies, and Tree-sitter structure under Shiki colors.
  - Unchanged document path: core `test/shiki` 93/93; web `prepared-open`, `syntax-worker`, `tree-pane` browser tests; `diff-tokens`, `diff-view-syntax-source`, `prepared-document` dom tests; full web node+dom suite 4916 passed. Tree-sitter structure under Shiki colours: `plugin.test.ts`.
- [x] Platform previews: actual editor parity for built-in/imported themes, concurrent mode previews, revision-aware query keys, and rapid scroll/search/toggle without stale output.
  - Built-in previews match the editor word for word (`code-theme-native-preview`; main fails it). Revision: registrations are immutable per build, so the query key is the theme id and the service revision separates content. Hold: `use-preview.test.tsx`.
- [x] Markdown: streaming supersession, aliases/unknown fences, CSS properties, and light/dark changes.
  - Streaming hold: `highlighted-code.test.tsx` (fails without the fix) and `stream-code-colour`. Unknown fences: Editor tests. Light/dark: fences follow the active mode's imported registration.
- [x] Measure cold/warm Settings scrolling and preview completion with `agent:browser trace --compare`. Record main-thread tasks, worker startup, transfers, and session retention. Read screenshots; exercise Chromium and mobile WebKit, and distinguish physical iPhone coverage.
  - `settings-wallpaper-scroll` trace: wallpaper-arrival task 94.1 ms → 6.6 ms, scripting 767.9 → 710.8 ms (after Tree-sitter previews). Chromium only through scenarios: WebKit scenarios fail identically on main (Settings never opens under the driver); the service itself passes in Playwright WebKit and Firefox. No physical iPhone was available.
- [x] Measure editor open/typing while previews/fences request work. Off-main computation must not delay interactive worker replies. Preserve Plan 170's deferred census-based prewarming.
  - `contention.browser.test.ts`, three runs: an interactive request waits 12.2–12.4 ms behind 12 Settings previews on Shiki (1.6–1.7 ms alone) and 6.2–9.6 ms on Tree-sitter (0.5–0.7 ms alone). One burst per screen of rows; no scheduling added. `trace editor-type-burst` could not run: the 7 GB slot kills it on main and here. Census prewarming is unchanged (`preloadLanguages`).
- [x] Run affected Editor tests/types/build/export checks and Platform gates/types/bundle checks. Use package test scripts, not `bun test`.
  - `build:workspaces`, package typechecks, web typecheck, `bun run gates`, `bundle:gate` (first load 1,717,080 gz, pin 1,735,134).
- [x] Commit/push verified implementation units by path. Deploy completed Platform consumer changes to Mesh; inspect release/UI/logs/live check. This docs-only plan requires no runtime deployment.
  - Merged in PR #202 as `bfabd3cb7`, shipped as web release `20260930T163634Z-bfabd3cb-main`. The live check passed, the mesh screenshot `/work/tmp/fregat-evidence/20260930T163726Z-look-platform-1440x1000` was read back, and production `warn` logs for the next five minutes were empty.

## Other plugin candidates

| Candidate                                            | Existing separation                                              | Decision                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Spellcheck                                           | Public service/checker; controller tokenizes and paints          | Use its computation/presentation precedent. Optional ownership or a text convenience API is a separate feature. |
| LSP                                                  | Public client/document; plugin borrows or creates document state | Reuse its ownership rule. No protocol/transport rewrite.                                                        |
| Tree-sitter                                          | Public backend/provider/session and plugin                       | Compose the existing implementation; preserve structural consumers.                                             |
| Diff                                                 | Public computation, patch parsing, projections, view adapters    | Consume shared highlighting; retain diff computation ownership.                                                 |
| Editor Markdown                                      | Pure source-decoration transformations over text/captures        | Already separate; distinct from Platform's rendered Markdown highlighter migration.                             |
| Find                                                 | Internal pure matcher plus controller                            | Expose a matcher only when a real standalone consumer needs its semantics. No speculative FindService.          |
| Gutters, minimap, scope lines, sticky scroll, decode | Viewport/caret/layout or paint-dependent contributions           | Keep editor adapters. No blanket service extraction.                                                            |

## Completion boundary

Finish when editor documents, Settings previews, and Markdown fences consume Editor-owned APIs and Platform no longer constructs their syntax engines/workers. Record intentional color changes and measured scheduling limits. Other plugin refactors and an unproven Wallpaper image fix remain outside this plan.

## Progress 2026-09-30

PR #202, branch `wave/foundations-highlighting`: `d3fb84bbf` (service, editors, Settings previews), `d1e03d660` (Markdown), `db5cc643b` (streamed-fence hold), `d28813d0a` (diff syntax in the service, Tree-sitter snippets, palette format instead of engine tags), `b31f3258d` (contention, engines, preview parity scenario).

Final shape:

- `@singapore-editor/highlighting` owns engine policy, grammars and aliases, theme registration, both workers, snippet highlighting, and prepared diff syntax. Platform keeps one service (`lib/highlighting/state/service.ts`), supplies theme lookup and the language census, and names palettes (`'vscode' | 'editor'`), never engines.
- `highlight()` routes a built-in palette to one transient Tree-sitter session, disposed however it ends, with capture variables resolved against the palette. Languages Tree-sitter lacks keep Shiki under that palette. Imported themes use the stateless Shiki `highlight` request. With no theme, the default palette is Shiki's `github-dark`.

Intentional color changes:

- Built-in palette previews now use the editor's capture colours (e.g. punctuation takes the bracket colour; main painted it in the foreground).
- Markdown fences under an imported theme use its real registration in both modes (before, light mode showed a synthetic palette). Fences under built-in palettes stay plain, as before.

Evidence (all under `/work/tmp/fregat-evidence/` unless noted):

- `20260930T140412Z…`/`20260930T141303Z-scenario-code-theme-native-preview` (branch passes); `20260930T140617Z…` (main fails: `,` foreground vs bracket colour).
- `20260930T135755Z-scenario-prefetch-first-paint` vs main `20260930T135647Z…`: diff revisit colour = text (57–59 ms, 0 uncoloured frames), hovered diff 56 ms (main 97 ms), first opens equal. Screenshot `05-diffs.png` read back.
- `20260930T140225Z-trace-settings-wallpaper-scroll` compared with main `/tmp/fregat-evidence/20260930T133619Z…`.
- `renders editor-theme-preview`: `CodeThemePreviewPanel` 16 → 19 renders, the extra three with no DOM change (≈1 ms subtree), page totals within run-to-run variance (6756/7482 main, 7485/6764/7523 branch). Suspected cause: the worker reply arrives in a later task, so the held subject renders once more per new theme.
- Screenshots read back: palette preview, Settings dark preview (`20260930T140245Z…/02-appearance-shown.png`), streamed fence, diffs, Native Light preview.

Review round (`review_highlighting` on `c2061eba0`), fixed in `5e4820029`:

- **Test config:** the config serves from the shared Editor `workspaceRoot`, so `check-turbo-inputs.mjs` passes. It failed before, logged in `/work/tmp/foundations-highlighting/round3/f1-turbo-before.log`.
- **Markdown hold:** a streamed fence holds only an answer from the current highlighter's theme and the same language, and paints plain text when no highlighter applies. Two new `highlighted-code.test.tsx` cases failed before the fix.
- **Content revisions:**
  - Documents and prepared diffs re-read an imported theme's content when their source notifies, and recolour under a content-revision worker name.
  - Snippet revisions come from content on every call, not from object identity.
- **Disposal:**
  - Disposal settles callers waiting on shared grammar acquisition, then stops the workers.
  - The diff store is terminal: a parse returned after disposal, or a preparation that settles after it, is disposed and never kept.
- **Named colours:**
  - Named palette colours take precedence over shorthand fields, as `applyEditorTheme` paints them, in both `resolveEditorThemeColor` and the new core `effectiveEditorTheme`.
  - Snippets and the TextMate palette conversion read their colours through that policy.
- **Grammar outages:** a known grammar that fails to load rejects with `failed`. Unknown languages stay plain text. Chromium keeps a failed dynamic import for the life of the page, so that grammar recovers on the next page load; the service caches no failure.
- **Proof:** `test/review.browser.test.ts` has 10 cases. Eight fail on the reviewed head's sources, and all ten pass with the fixes. There is also a core DOM-parity test, `themeColorResolve.browser.test.ts`, which failed before.
- **Checks:** highlighting node 10, Chromium 28, Firefox/WebKit 34; core 127; markdown 88; affected web node+dom tests 1691; web typecheck clean.
- **Height CI:** repaired separately in PR #206. The textbuffer workflows install only that package, and the pinned control is vendored. PR #202's height job needs #206 merged first.

Follow-up repairs (`803707fc3`), merged with `main` at `3a0f097d6` (includes #203, #204, #206) in `247bffee4`:

- **Revision race:** each worker theme name now carries the exact registration it was named for. A refresh overtaken by a newer notification for the same id publishes nothing, so a late acquisition cannot put newer content under an older revision. The reviewer's race corpus went from 2 of 4 passing to 4 of 4 (`test/theme-revision-race.browser.test.ts`).
- **Admission after disposal:** `documentBackend`, `canPrepareDiff` and `showDiff` throw `disposed`, and `prepareDiff` rejects, for both cached and new theme sources. A real view is never admitted. `grammarFor` stays answerable. `test/disposed-admission.browser.test.ts` failed before and passes now.
- **Merged-tree checks:** workspace build, `bun run gates`, web/highlighting/markdown typechecks and `check-turbo-inputs` pass. Highlighting passes node 10 and Chromium 34, and Firefox/WebKit 34 before the merge. Markdown passes 88. Affected web node+dom tests: 2268 passed, 5 skipped. Web browser tests (preview, Mermaid fence, message bubble, prepared open): 29 passed.

Pre-existing failures (owners assigned by the coordinator):

- `editor-theme-preview` 15 !== 5 recolor requests, also on main: Plan 179 worker.
- `/providers/{codex,claude}/update` 500 in the throwaway server: Plan 126 worker.
- `trace editor-type-burst` is killed by the heavy-slot memory cap on main and here.
- WebKit scenario driving: `settings-appearance-open` times out on main too.
- A separate foundations harness lane owns the WebKit Settings scenario and the full typing trace. As of 2026-09-30 it has no merged PR, so neither proof is claimed here.

Remaining limits:

- A cancelled snippet cannot pre-empt tokenization already running in a worker; it only stops publication.
- Previews and interactive edits share each worker's queue (measured above); scheduling is left out until a user-visible delay is shown.
- Tree-sitter's runtime does not load in Bun workers, so built-in palette preview tests run in the browser project.
- No physical iPhone run.
