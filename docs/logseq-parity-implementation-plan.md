> [!IMPORTANT]
> **STATUS: ⏸️ DEFERRED until further notice (2026-08-27).** Not scheduled, not authorized for implementation. The agent-view/product-vision initiative takes priority. This deferral covers the companion docs ([logseq-parity-gap-matrix.md](logseq-parity-gap-matrix.md), [logseq-port-map.md](logseq-port-map.md)) as well. The content below is preserved as-is for whenever this is revisited.

> [!NOTE]
> **Generated implementation plan — 2026-08-22.** Companion to [logseq-parity-gap-matrix.md](logseq-parity-gap-matrix.md) (feature-level status of ~600 features across 9 domains) and [logseq-port-map.md](logseq-port-map.md) (per-module port / reimplement / skip verdicts with license exposure). Produced by three independent roadmap agents over the same verified matrix, synthesized and adjudicated; where they disagreed the fork is recorded in [Rejected alternatives](#rejected-alternatives) rather than smoothed over.

# Logseq Parity Implementation Plan

Reference (pinned at analysis time): `references/logseq` — logseq/logseq `fab2774` (2026-08-18). READ ONLY.

Status markers are OUR coverage: ❌ missing · 🟡 partial · ✅ have. Effort is cost to build **in our stack** (React + `@singapore-editor/*` editor engine + Bun/Elysia + SQLite), not to port Clojure: S = days, M = 1–2 weeks, L = 3–6 weeks, XL = multi-month. Every wave ends with `bun run verify` green and the app usable.

**Licensing, stated once as a fact.** Logseq is AGPL-3.0. Transliterating its code produces a derivative work carrying AGPL obligations including the network-use clause; reimplementing a module from a behavioural description does not. Every port verdict in the port map carries a `licenseExposure` label. The highest-exposure artifacts, in order, are the plugin host (`libs/src`, 5,585 LOC of already-TypeScript AGPL — never open it with intent to copy), `deps/db/.../reference.cljs`, and `worker/search.cljs`. This is the user's call to make; it must be made knowingly, **before** anyone opens a file, and each ported file must carry an in-file label naming its source path.

---

## The decision

**Files are the source of truth. A note is a markdown document. A block is a markdown list item, which is a line range. The index is derived, disposable, server-side, and rebuildable.**

This is settled, not proposed. Three independent roadmap passes over the same evidence reached it separately, which is as strong a signal as this exercise can produce. It has two halves and both matter.

**Half one: files, not a database.** Logseq's DB version makes SQLite authoritative and emits markdown as a one-way mirror that is _never read back_ (`worker/markdown_mirror.cljs`, 714 LOC — editing a mirrored file silently does nothing). They did that because they are a browser app with no server, no filesystem authority, and no git. We have all three, working: path-confined fs routes (`apps/server/src/fs/path.ts`), atomic writes with `baseVersion`/mtime optimistic concurrency (`apps/server/src/fs/write.ts`), a native watcher fanned over SSE with app-save attribution (`apps/server/src/fs/watch.ts`, `app-save-marker.ts`), editor buffers, `FileSyncService`, per-turn git checkpoints. Choosing DB-truth demotes every one of those to irrelevant _for notes_, and converts the product promise from "my notes are plain files" into "my notes are exported as plain files".

**Half two: documents, not a block tree.** `@singapore-editor/core` is a flat piece table. It has no block or node tree, no node identity beyond `Anchor` (buffer + offset + bias), uniform text-row height, and a **closed** `EditorCommandId` union of ~116 ids — a plugin literally cannot register `outline.indent`. Building a block-tree outliner means reimplementing caret geometry, selection, undo, and typing latency that a text buffer gives us free, and it reintroduces Logseq's type-ahead-loss bug class on every Enter (their pending-new-block buffer exists solely because block creation is a worker round trip).

### What this decision costs, stated honestly

| Given up                                                                 | Why it is acceptable                                                                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O(1) page rename                                                         | Rename becomes a span-aware multi-file rewrite behind a git checkpoint and a dry-run preview. Obsidian pays exactly this and its users do not notice.                                  |
| Same-name pages disambiguated by tag (`Apple #Company` / `Apple #Fruit`) | Two notes cannot share a filename in one folder. Distinct paths + a frontmatter display title covers it.                                                                               |
| Invisible block identity                                                 | Block ids live in text as `^blockid` anchors — additive text, cheap to retrofit, and the Obsidian ecosystem convention.                                                                |
| Per-block query granularity                                              | Bought back cheaply by recording **section line ranges** in the index from wave 1. Retrofitting positions into an FTS-only index is a full reindex, which is why it goes in slice one. |
| Offline editing                                                          | The server is loopback and single-writer. An offline edit is not queued — it is not possible. Say so in the product framing rather than discovering it.                                |

### What this decision deletes

Roughly 60% of the parity matrix becomes **inapplicable, not deferred**: the block/outliner data model, DataScript + the `kvs` blob store, transit (213 call sites), semantic undo (`construct.cljc`, ~1,300 LOC, rated XL), the client op queue and rebase (`apply_txs.cljs`, 1,924 LOC), convergence checksums, E2EE, multi-writer election, `:block/left`, `:block/path-refs`, property-values-as-blocks, and the markdown mirror. Under document-first, **structural undo is text undo** — indent, outdent, move-subtree, merge and split are all `TextEdit[]` on the existing piece table, landing on the buffer's undo stack for free. That is the substrate paying for itself, and it is why wave 0 needs no new undo stack.

### The migration path to the other model, if it is ever wanted

The outliner is not foreclosed — it is deferred to wave 7 as a **mode**, not a foundation, and the path back is short because nothing above it assumes a block database:

1. **Block identity** — mint `^blockid` anchors on demand (copy-a-link-to-this-item). Additive text; the index gains one column. Nothing already written changes.
2. **Order** — under file truth, document position _is_ the order, so no key exists to migrate. If a persisted order key ever becomes necessary, take npm `fractional-indexing` (CC0, base-62 with an integer part), **not** `packages/contracts/src/order-key.ts` (base-26, fraction-only, no integer part — 2,000 sequential appends produce a ~500-character key, and appending is the most common outliner operation).
3. **Keyboard model** — the list-tree algebra (`indentItem` / `outdentItem` / `moveItemUp` / `moveItemDown` returning `TextEdit[]`) lands in wave 2 as a bug fix, so wave 7 is UI and persistence, not algorithms.
4. **What would have to change** — only if the user later wants same-name-pages-by-tag, invisible ids, or true offline multi-device merge. Those three are the one-way doors, and none is on the roadmap.

Everything below hangs off this decision.

---

## Layer split

The editor packages live in a **separate repo** (`/Users/shaul/Desktop/D/Editor`, published as `@singapore-editor/*`) and must stay host-agnostic: no knowledge of workspaces, file trees, a notes graph, our server, or our React app. The tiebreaker: if a module needs workspace, graph, or server knowledge it cannot live in an editor package, full stop.

| Domain                                                                                   | Layer                       | New `@singapore-editor/*` package?                   | Rationale                                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Note metadata index (frontmatter, headings + section ranges, link/tag spans, link graph) | platform-server             | no                                           | Whole-vault knowledge by definition. Needs the watcher and SQLite.                                                       |
| Wikilink / tag scanning and resolution                                                   | platform-server             | no                                           | The scanner is pure, but resolution needs the vault name index; keeping them together prevents two disagreeing scanners. |
| Backlinks, unlinked mentions, include/exclude filters                                    | platform-server             | no                                           | Index traversal. The pane is thin platform-web on top.                                                                   |
| FTS5 search, operators, snippets                                                         | platform-server             | no                                           | Already SQL. Snippet windowing is pure and lives in `packages/contracts`.                                                |
| Query DSL → SQL compiler, watch keys, invalidation                                       | platform-server             | no                                           | Needs the index and the write path (before/after state).                                                                 |
| Typed property schema, property coercion                                                 | platform-server + contracts | no                                           | Schema is graph state; the type union is a shared contract.                                                              |
| Rename / move with link rewriting                                                        | platform-server             | no                                           | Multi-file transaction over the atomic write path.                                                                       |
| Wikilink decoration + mod-click in the editor                                            | platform-web                | no                                           | A platform-authored `EditorPlugin` closing over a resolver — same shape as `language-server-plugin.ts`.                  |
| Backlinks / outline / tags / properties panes                                            | platform-web                | no                                           | Workbench surfaces.                                                                                                      |
| Graph view (local + global)                                                              | platform-web                | no                                           | Renderer + layout over a server-derived payload.                                                                         |
| Daily notes, templates, quick switcher, bookmarks                                        | platform-web                | no                                           | Commands over `keymap/` + fs routes.                                                                                     |
| Callouts, `==highlight==`, `%%comments%%`, footnotes                                     | editor-markdown             | no — extends `@singapore-editor/markdown`            | Pure inline rendering, no graph knowledge.                                                                               |
| **Variable-height text rows; multi-line inline replacements**                            | **editor-core**             | no — engine surgery                          | The one hard ceiling. See wave 4.                                                                                        |
| Markdown grammar/query additions (`task_list_marker` captures, `(list_item)` folds)      | editor-core                 | no — `.scm` edits in `tree-sitter-languages` | Grammar-level, host-agnostic.                                                                                            |
| List-tree algebra (parse → indent/outdent/move → `TextEdit[]`)                           | **ambiguous**               | **not yet**                                  | See below.                                                                                                               |
| Trigger-character completion popup (`[[`, `#`, `/`)                                      | **ambiguous**               | **not yet**                                  | See below.                                                                                                               |

### The ambiguous rows, and what decides them

**List-tree algebra.** Genuinely host-agnostic — it knows about markdown list indentation and nothing else — so by the tiebreaker it _could_ be `@singapore-editor/outline`. It is **not** promoted in the first pass, on the two-consumer rule: shipping a package into the separately-published Editor repo costs `bun link` + root `overrides` + a Vite restart on day one, plus the stale-`dist`-after-pull failure mode, for a package with exactly one consumer. It lives as platform-local `packages/outliner` and is promoted verbatim as `@singapore-editor/outline` the moment a second consumer appears, with the public surface: `parseListTree(text) → ListItem[]`, `indentItem/outdentItem/moveItemUp/moveItemDown(tree, selection, opts) → TextEdit[]`, `applyEdits(text, edits)` — pure, no DOM, no workspace knowledge.

**Completion popup.** Same shape, same verdict, different reason: the LSP completion controller already exists in `@singapore-editor/lsp-plugin` and already owns anchoring (`getRangeClientRect`), filtering, and the up/down/enter model. Reuse it before extracting `@singapore-editor/completion`. If it is ever extracted, the public surface is `createTriggerCompletionPlugin({ triggers, provideItems, renderItem })` with items supplied entirely by the host.

**What must live in the Editor repo from the start** is editor-core itself: variable-height text rows, multi-line inline replacement spans, and the markdown `.scm` additions. That is wave 4, and it is engine surgery, not a new package.

---

## Where the index lives

**The index is server-side SQLite, in its own database file, derived from the vault and rebuildable at any time.** Not client memory, not a client database.

**Against client memory:** `WorkspaceIndex` (`apps/server/src/fs/workspace-index.ts`) already proves the failure mode — it holds path + metadata + a 512-byte content sniff, in memory, rebuilt on every workspace open, lost on restart. A link graph over a 50k-note vault held in a browser tab is the ceiling Logseq spent a whole worker infrastructure working around.

**Against a client database:** there is no client persistence beyond localStorage (`apps/web/src/features/workspace/state/cache.ts`, `CACHE_VERSION` 17, ~5 MB shared budget, 8-project eviction cap). Zero IndexedDB references exist anywhere. Roughly a third of Logseq's worker infrastructure — `shared_service.cljs`'s Web Locks master election, the BroadcastChannel fan-out, OPFS pool management — is compensating for having nowhere but a browser tab to put a database. Our Bun server is a strictly better worker: real filesystem, native SQLite, one writer by construction, and it outlives the tab.

**Its own SQLite file, from the first migration.** One file backs the entire platform today (`~/.platform/fs-metadata.sqlite`, WAL, `busy_timeout` 5000, shared with the orchestration event log and eight `projection_*` tables — 14 migrations). An FTS5 trigram index is roughly the size of the indexed text, and a full vault reindex holds the write lock against chat event appends. Logseq runs three SQLite files per graph for exactly this reason. Give notes its own file and `ATTACH` if a cross-database join is ever genuinely needed.

### Contracts and routes this implies

| Table           | Shape                                                                                                | Indexed on                      |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| `notes`         | `path` PK, `nameKey`, `title`, `mtimeMs`, `size`, `contentHash`, `frontmatterJson`                   | `nameKey`                       |
| `note_links`    | `fromPath`, `targetName`, `targetNameKey`, `heading`, `span`, `line`, `isEmbed`, `resolvedPath` NULL | `targetNameKey`, `resolvedPath` |
| `note_aliases`  | `path`, `aliasKey`                                                                                   | `aliasKey`                      |
| `note_tags`     | `path`, `tagKey`                                                                                     | `tagKey`                        |
| `note_sections` | `path`, `headingText`, `level`, `startLine`, `endLine`                                               | `path`                          |

Routes, mounted with `.use(notesRoutes(notes))` in `apps/server/src/app.ts`, valibot contracts in `apps/server/src/notes/contracts.ts`, DTOs re-exported from `packages/contracts/src/notes.ts`:

- `GET /notes/status` → `{ state: 'cold' | 'building' | 'ready' | 'stale' | 'failed', noteCount, linkCount, buildId }`
- `GET /notes/resolve?name=` → `{ kind: 'resolved', path } | { kind: 'unresolved' } | { kind: 'ambiguous', chosen, candidates }`
- `GET /notes/backlinks?path=` → `{ groups: Array<{ fromPath, title, occurrences: Array<{ line, snippet, ranges }> }> }`

DTOs are JSON primitives only — no `Date`, no `Map`, no class instances — so payloads survive the Eden/WS boundary unchanged. Every failure goes through `defineErrorCatalog` in `apps/server/src/notes/structured-errors.ts` carrying `code`/`status`/`why`/`fix`. **Zero `new Error` in the feature.** Every build and incremental flush emits one wide evlog event (`notes.index.build`, `notes.index.sync`) carrying `fileCount`, `linkCount`, `durationMs`, `buildId`, and the trigger reason, so wave-2 performance questions are answerable from `logs/` rather than by guesswork.

**Binding constraint:** `docs/workspace-search-next-steps.md` is 🟢 and settled — ripgrep stays the correctness oracle for exact search. The notes FTS path must not alter what file-scoped exact search returns; any semantic or structural mode is an explicitly separate mode.

---

## Port posture

**Roughly 15–20% ported, 20% reimplemented-from-spec, 60% skipped.** The skip fraction is a _consequence_ of the document-first decision, not a shortcut — it is exactly the block/DB/sync tier that the decision deletes. Full per-module detail with line references and license labels is in [logseq-port-map.md](logseq-port-map.md); this is the shape.

**PORT — transliterate; AGPL derivative work; label each in-file:**

| Module                                             | LOC          | What it buys                                                                                                                                                                     | Wave |
| -------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `deps/db/.../common/reference.cljs`                | 326          | The include/exclude backlink filter asymmetry. The densest thing worth taking in the whole reference; its docstring counterexample becomes our first test.                       | 3    |
| `worker/search.cljs` (partial)                     | ~400 of 1218 | FTS5 trigram DDL + the three triggers, five-lane orchestration with the `enoughExact` short-circuit, `get-match-input` sanitization, RRF fusion, snippet windowing. Already SQL. | 3    |
| `deps/db/.../property/type.cljs`                   | 253          | Property types with cardinality and closed values as **orthogonal** axes. Better than Obsidian's own model.                                                                      | 3    |
| `graph_parser/block.cljs` extract-properties       | ~150         | Value coercion behaviour **and** the worked test oracles.                                                                                                                        | 3    |
| `worker/markdown_mirror.cljs` `normalizeStem`      | ~60          | Filename policy lookup table.                                                                                                                                                    | 1–2  |
| `outliner/template.cljs`                           | ~140         | Variable expansion + local-midnight date arithmetic.                                                                                                                             | 2    |
| `outliner/core.cljs` indent-outdent / move-up-down | ~115         | Convergence filters, right-sibling sweep, `lastChildOrSelf` asymmetry. The subtlest algorithms in the inventory.                                                                 | 2    |
| `worker/graph_view.cljs` + `pixi/logic.cljs`       | ~250         | Link dedup-and-upgrade, two-phase orphan computation, tuned analytic layout constants.                                                                                           | 6    |
| `handler/query/builder.cljs`                       | ~200         | Path-addressed tree algebra. Pure.                                                                                                                                               | 5    |

**REIMPLEMENT FROM SPEC — rules survive, mechanism does not:** wikilink/tag scanning and rename rewriting (span edits over parsed inline nodes, **never** `String.replace` — their regex substitution is the acknowledged corruption source); index fan-out rules → recursive CTEs; query DSL → SQL compiler; watch-key extraction and transaction→invalidation-key derivation; palette group-ordering policy; page title validation; breadcrumb visibility budget; recurring-task repeater semantics (public org spec, zero exposure); FSRS integration (the algorithm is MIT `ts-fsrs`, not Logseq's).

**CONSUMED AS AN ARTIFACT: nothing from Logseq.** This is a deliberate divergence from two of the three input roadmaps, which both wanted `mldoc`. **mldoc is rejected** — see [Rejected alternatives](#rejected-alternatives). External deps we do take, all license-clean: `ts-fsrs` (MIT), `fractional-indexing` (CC0) if outline ordering ever needs a persisted key, a `turndown`-class HTML→markdown converter, KaTeX, mermaid.

**SKIPPED, with the reason recorded in a code comment so nobody re-adds it:** DataScript + datalog (npm 1.8.1 ships no `datascript.storage`, so the lazy index tree that makes Logseq viable at 50k blocks is absent from the JS build); TanStack DB for graph data (query IR has no fixpoint, IVM has no `iterate`, so `parent` / `class-extends` / `has-ref` are inexpressible); the `kvs` blob store and its GC; transit; the whole op vocabulary + `construct.cljc` + `undo_redo.cljs`; `apply_txs.cljs` rebase; db-sync, checksums, E2EE, framed snapshot streaming; `shared_service.cljs` master election; the markdown mirror and its decoration resync; the plugin host; recycle bin; property-values-as-blocks; `:block/left`; `:block/path-refs`; SM-5; whiteboards; `search_fuzzy.cljs`; Logseq's keymap dispatcher; the `___` filename↔title codec; `custom.js` / SCI.

---

## Engine prerequisite — the widget-row primitive

> [!IMPORTANT]
> **Added after the sweep, 2026-08-22.** The nine domain surveys and six capability inventories behind this plan were produced _before_ the block-surface system was deleted from the engine repo. Every matrix row and risk that mentions `registerBlockProvider`, `EditorBlock*`, or block rows describes code that no longer exists. This section is the correction, and [Wave 4](#wave-4--live-preview-fidelity-the-engine-track--48-wk-engine-gono-go-decision-due-in-week-1) depends on it.

**What was deleted.** The whole block-surface system: 8 dedicated files and ~4,200 lines across 57 files in `../Editor` — `editorBlocks.ts`, `blockSurfaceController.ts`, `editorBlockSurfaces.ts`, `virtualizedTextViewBlockLanes.ts`, the React wrapper, three test files, and every threaded reference. Typecheck 34/34, full serial suite green in every package. Uncommitted at time of writing.

**Why deleted rather than fixed.** Two independent reasons, and the second is the one that matters here.

1. _It never worked in production._ Blocks were built for one consumer — editor-backed search result tabs. That consumer abandoned them and now runs a pool of editors with hand-rolled virtualization, which the original block plan had listed under its own non-goals. `docs/editor-blocks-plan.md` was deleted two weeks later. Zero production consumers survived in either repo; every remaining `registerBlockProvider` reference was a stub in some other plugin's mock context.
2. _It was the wrong shape._ Blocks are **lanes around** a text range — top/bottom/left/right surfaces. A row is never itself a widget. The deleted plan said so explicitly as a V1 non-goal: _"Do not replace normal text rows with arbitrary HTML in V1. […] If a row is no longer text, editor selection, copy, cursor mapping, hit testing, and find all need special cases."_ Everything with real height in this plan — inline embeds `![[Note]]`, images that grow their line, wrapping tables, display math, mermaid, query result surfaces — needs precisely the forbidden thing. A bug-free block system would still not have delivered it.

**What survived, deliberately.** Three mechanisms were protected through the deletion because this plan depends on them:

| Mechanism                                                                                             | Status                | Consumer                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| Variable-row-height virtualizer (`rowSizes`, `rowHeightIndex.ts`, the `fixedRowVirtualizer` branches) | retained, unreachable | blocks were its only feeder; the widget-row primitive becomes the new one |
| `InlineReplacementSpec.render` + its geometry/rows plumbing                                           | retained, unreachable | none yet — this is the inline-widget path                                 |
| `insertion` (phantom text at a point) · `registerInjectedTextRowProvider`                             | shipping              | `ghostText.ts` · `packages/diff`                                          |

**What has to be built.** One primitive: **a row range replaced by a variable-height widget** that stays coherent under the five verbs the old plan named as the hard part — selection across it, copy through it, cursor mapping past it, hit testing inside it, and find spanning it. It is not a port; Logseq is an anti-reference here for the reason Wave 4 already gives. Two working TypeScript designs are cloned and readable: **CodeMirror 6's replace-decoration / block-widget model** (`references/zettlr` runs on CM6) and **Muya** (`references/marktext/packages/muya`, MIT, ~86k LOC, a from-scratch WYSIWYG markdown engine). Muya's licence permits lifting code, not merely reading it.

**Gate.** Spike this first — one variable-height widget replacing a row range, then scroll past it, edit above it, select across it, copy through it, find across it. Those five verbs either hold or they don't, and the answer is worth a day. Wave 4's go/no-go decision is really this spike's result, and the spike is now _load-bearing_ rather than a de-risking exercise, because the block-row fallback that used to backstop a "months" answer no longer exists.

---

## Wave 0 — the first slice

> **Note index + `[[wikilink]]` navigate + backlinks pane.** Estimate: **2.5–3 weeks, 1 engineer.**

### Why this slice

Every downstream feature is a consumer of one table set. We have **zero** content index today — every content query re-spawns ripgrep, and `WorkspaceIndex` holds path + metadata + a 512-byte sniff, in memory, rebuilt on every workspace open. `apps/server/src/db/schema.ts` exports only `schema_migrations`, `fs_metadata`, `orchestration_*` and eight `projection_*` tables: nothing note-, link-, or FTS-shaped exists.

Building the index headless as an "infrastructure wave" would let the parse layer, the schema, the watcher wiring and the query rot independently, so it ships with **exactly two thin consumers, one per direction**. Mod-click navigation exercises the WRITE direction (edit a file → watcher → coalesce → reindex → invalidate), which is the riskiest plumbing in the whole plan. The backlinks pane exercises the READ direction (index → route → UI) and is the day-one demo: open a note, see who links to it, edit another file, watch it update.

**Deliberately not paid in slice one:** no new `WorkspaceUiMode` value, and no new editor document-id prefix. Notes are `.md` files in the workspace the app already opens, so the ~9-site document-kind checklist (render branch, three enablement predicates, four tab-model sites, cache `pathForWorkspace`, **both** halves of the address token codec, palette label, opener) is not paid until a notes-specific surface genuinely has nowhere else to live.

### Scope

- **Server-side markdown parse** (remark/mdast, **not** mldoc) producing a `NoteRecord`: YAML frontmatter with key order and comments preserved for later write-back; title resolution (frontmatter `title` → filename stem → first H1); aliases; inline + frontmatter tags merged; headings with `{ text, level, startLine, endLine }`; section spans; outbound links/embeds with byte spans.
- **Wikilink + tag scanner** covering `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]`, `![[embed]]`, `#tag`, `#[[multi word]]` — matching over **parsed spans** so fenced code, indented code, inline code and URLs are excluded _structurally_, never by regex over the raw string. Ported ordering rules only: nested-brackets-first, longest-first, the `(^|[^#])` page guard, the tag punctuation lookahead.
- **Byte-offset discipline:** one prefix-sum UTF-8→UTF-16 index per file (O(n) once), never a `TextDecoder` per span.
- **Schema + one numbered migration** in a dedicated notes SQLite file (tables per [Where the index lives](#where-the-index-lives)).
- **`NotesIndexService`:** initial build from the existing `WorkspaceIndex` entry map (no second directory walk); incremental maintenance on the `FileChangeHub` raw listener with the same 25 ms coalesce / 500-event full-rebuild policy `watchWorkspaceIndex` already uses; readiness state machine; build-id supersede so a newer build silently wins; a version stamp written only after a complete successful build, so an interrupted build rebuilds.
- **Fan-out on write:** reindexing note B must invalidate the backlink view of every note B links to, computed against **both** the before and after link sets, so a removed link disappears from the target's pane.
- **Resolution:** case-insensitive `nameKey`, aliases folded in, Obsidian shortest-unambiguous-path matching, deterministic tie-break (shortest vault-relative path, then lexicographic) with the ambiguity reported, and an explicit `unresolved` result. **Never eagerly create the target note** — that is Logseq's behaviour and it fills a vault with typo pages.
- **Client:** a platform-authored `EditorPlugin` decorating `[[…]]` spans in markdown documents with resolved/unresolved styling and mod-click open-or-create; plus a Backlinks sidebar panel grouped by source note with a one-line context snippet, live-updating from the watcher.
- **One settings key**, registered in the same pass as its consumer: `notes.newNoteFolder` (scope `window` — it selects a location _inside_ the workspace and reaches no execution). Regenerate `docs/settings-reference.md`.

**Out of scope, deliberately:** the `[[` autocomplete popup, unlinked mentions, FTS5, rename rewriting, tags pane, any new `WorkspaceUiMode`, any new editor document-id prefix.

### Files to create

```
packages/contracts/src/notes.ts
packages/contracts/src/tests/notes-wikilink.test.ts

apps/server/src/notes/contracts.ts
apps/server/src/notes/structured-errors.ts
apps/server/src/notes/routes.ts
apps/server/src/notes/service.ts
apps/server/src/notes/resolve.ts
apps/server/src/notes/backlinks.ts
apps/server/src/notes/parse/frontmatter.ts
apps/server/src/notes/parse/wikilinks.ts
apps/server/src/notes/parse/headings.ts
apps/server/src/notes/parse/note-record.ts
apps/server/src/notes/parse/byte-offsets.ts
apps/server/src/notes/index/db.ts
apps/server/src/notes/index/schema.ts
apps/server/src/notes/index/migrations.ts
apps/server/src/notes/index/build.ts
apps/server/src/notes/index/watch.ts
apps/server/src/notes/utils/name-key.ts
apps/server/src/notes/utils/filename.ts
apps/server/src/notes/tests/wikilinks.test.ts
apps/server/src/notes/tests/note-record.test.ts
apps/server/src/notes/tests/notes-index.test.ts
apps/server/src/notes/tests/resolve.test.ts
apps/server/src/notes/tests/backlinks.test.ts

apps/web/src/features/notes/utils/wikilink-spans.ts
apps/web/src/features/notes/utils/wikilink-plugin.ts
apps/web/src/features/notes/utils/create-note.ts
apps/web/src/features/notes/utils/note-path.ts
apps/web/src/features/notes/hooks/use-note-resolve.ts
apps/web/src/features/notes/hooks/use-open-note.ts
apps/web/src/features/notes/hooks/use-backlinks.ts
apps/web/src/features/notes/components/backlinks-panel.tsx
apps/web/src/features/notes/components/backlink-group.tsx
apps/web/src/features/notes/tests/wikilink-spans.test.ts
apps/web/src/features/notes/tests/open-note.test.tsx
apps/web/src/features/notes/tests/backlinks-panel.test.tsx
```

Folder shape follows house conventions: `components/` render-only `.tsx`, `hooks/` `use-*`, `utils/` pure and React-free, `tests/` feature tests, no barrel `index.ts`, exact `@/` imports.

### Files to change

| Path                                                           | Change                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/contracts/src/index.ts`                              | Export the notes contracts (package entry point — the one legal barrel).         |
| `packages/contracts/src/settings/keys.ts`                      | Register `notes.newNoteFolder` alongside its consumer. Never inert.              |
| `apps/server/src/app.ts`                                       | Mount `.use(notesRoutes(notes))`.                                                |
| `apps/server/src/client-contract.ts`                           | Surface the notes routes to Eden.                                                |
| `apps/server/src/fs/service.ts`                                | Start/stop the notes index alongside the workspace index in `openWorkspaceRoot`. |
| `apps/web/src/features/editor/utils/plugins.ts`                | Install the wikilink plugin for `languageId === 'markdown'`.                     |
| `apps/web/src/lib/query-keys.ts`                               | Notes query keys.                                                                |
| `apps/web/src/features/workbench/utils/panels.ts`              | Add the backlinks tab to the closed union.                                       |
| `apps/web/src/features/workbench/components/sidebar-panel.tsx` | Render branch for the backlinks tab.                                             |
| `apps/web/src/lib/focus/state/service.ts`                      | A notes `FocusArea` and typed target identity.                                   |
| `docs/settings-reference.md`                                   | Regenerate with `bun run settings:reference`.                                    |

### What it ports

| Source                                                            | Taken                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deps/db/.../frontend/content.cljs`                               | **Ordering and guard rules only** — nested-brackets-first, longest-title-first, the `(^\|[^#])` page-vs-tag guard, the tag punctuation lookahead, the no-ID_REF early bail. Reimplemented as span matching over parsed inline nodes; their `String.replace` over whole blocks is the acknowledged corruption source and is explicitly **not** the mechanism. |
| `deps/graph-parser/.../extract.cljc`                              | Page title resolution precedence, and the sanitized-lowercase-lookup-key vs display-title split — the thing that makes case-insensitive links work.                                                                                                                                                                                                          |
| `deps/graph-parser/.../utf8.cljs`                                 | The byte-offset discipline only (parser offsets are UTF-8 bytes, JS strings are UTF-16, encode/index once per file). Reimplemented as an O(n) prefix-sum map instead of their O(blocks) decodes.                                                                                                                                                             |
| `worker/search.cljs` `get-affected-blocks` / `sync-search-indice` | The fan-out **rules**: referrer expansion, alias expansion in both directions, and comparing indexability BEFORE and AFTER so a note that became unindexable is actively deleted rather than merely not re-added.                                                                                                                                            |
| `deps/db/.../common/reference.cljs`                               | Vocabulary only in this slice (`ownRefs`/`effectiveRefs`, aliases folded into the id set at step 1). The include/exclude traversal itself lands in wave 3.                                                                                                                                                                                                   |
| `worker/markdown_mirror.cljs`                                     | `normalizeStem` for the create-on-click path: NFC; replace `<>:"\|?*\/` and control chars; strip trailing dots and spaces; truncate on UTF-8 **bytes** (fixing their JS-char bug); reject blank results and Windows device names.                                                                                                                            |

### Done when

1. `bun --bun vitest run --project node apps/server/src/notes/tests/` is green, including a **golden fixture** asserting that a `[[link]]` inside a ``` fence, a `#tag` inside `` `inline code` ``, and a `[[link]]` inside an indented code block produce **zero** index rows, while the same tokens in prose produce exactly one each.
2. A vault containing notes `foo` and `foo-bar` indexes `[[foo-bar]]` as one link to `foo-bar` and **never** as a link to `foo`.
3. A fixture note whose **first** block contains an emoji and CJK reports link spans that slice correctly on the client — the UTF-8/UTF-16 test is in the first block, not the last.
4. Opening a workspace root builds the index **without a second directory walk**; `GET /notes/status` reports `ready` with a count equal to the non-ignored `.md` files in the fixture vault; opening the same root a second time does **not** rebuild.
5. `GET /notes/resolve?name=Foo` returns `Foo.md` regardless of case, resolves through a frontmatter `aliases:` entry, returns an explicit `unresolved` for an unknown name **without creating anything**, and reports the ambiguity when two notes share a name (shortest path wins, then lexicographic).
6. `GET /notes/backlinks?path=` lists every note containing `[[Foo]]`, grouped by source with a one-line snippet, excluding code-fence / inline-code / URL occurrences.
7. Writing `[[A]]` into note B through the real in-process server updates A's backlinks within one coalesce window — an in-process test writes, awaits the flush, re-queries and sees the edge. **No test opens a socket to our own server.**
8. Removing a link from B removes it from A's pane, so the before/after fan-out is exercised and not just the after side.
9. Deleting a note leaves its inbound links `unresolved` and rewrites **zero** files.
10. An external rename performed out-of-band on disk (arriving as delete+create) is reconciled as a move by matching `contentHash` inside one coalesce window; a test renames on disk and asserts backlinks survive. When reconciliation fails, a wide `notes.index.rename_unresolved` event names both paths — it never silently drops rows.
11. `[[Note#Heading]]` resolves to a concrete line range, proving section boundaries are in the **first** migration rather than retrofitted.
12. In the running app, `[[Foo]]` renders with a link affordance in a markdown editor; mod-click opens `Foo.md`, or creates it under `notes.newNoteFolder` with a sanitized filename and opens it. A title containing `/`, a trailing dot, and 200 CJK characters each produce a legal, unique file.
13. One `notes.index.build` wide event per build (`fileCount`, `linkCount`, `durationMs`, `buildId`, `reason`) and one `notes.index.sync` per incremental flush; a build started mid-flight supersedes the earlier one silently and only the winner stamps the index version.
14. Zero `new Error` in the feature; every failure carries `code`/`status`/`why`/`fix`. No new localStorage key and no hardcoded threshold — the panel default is a registered setting.
15. No new `WorkspaceUiMode` value and no new editor document-id prefix were added. `bun run verify` passes at the repo root.

---

## Waves 1–7

### Wave 1 — Vault index + links + backlinks · **2.5–3 wk** · = Wave 0

Wave 0 _is_ wave 1; it is broken out above because someone must be able to start coding from that section alone.

**Goal:** stand up the keystone — a persisted, incrementally-maintained note metadata index and link graph — and prove the whole loop with exactly two visible consumers.

**Features (named from the matrix):** Note metadata index (the prerequisite everything consumes) · `[[page ref]]` page references incl. nested refs · Follow the link under the cursor · Unresolved-link state as a first-class rendered state (Obsidian delta; Logseq has no equivalent) · Page title resolution order · Title→filename normalization and collision allocation · Linked references section · Outgoing links pane · YAML frontmatter parsed and preserved.

**Layers:** platform-server (parse, index, resolution, routes) + platform-web (wikilink plugin, backlinks/outgoing panes) + contracts (DTOs, one settings key).

**Unlocks:** everything. Nothing else in the roadmap is reachable without this table set, and it proves the watcher → coalesce → index → invalidate loop — the riskiest plumbing in the plan — before anything depends on it.

---

### Wave 2 — A vault you can live in · **4–5 wk**

**Goal:** make the folder feel like a vault — complete links as you type, resolve aliases, rename without breaking anything, land on today's note, and find any note in two keystrokes.

**Features:** Wikilink autocomplete on `[[` (index-fed; `#` offers headings, `^` reserved for block anchors) · Aliases (frontmatter `aliases:`, folded into resolution, search and backlinks) · Hover link preview · Link-preserving rename and move (span-aware multi-file rewrite, dry-run preview, git checkpoint before the batch, one transaction) · Page title validation and safe file-stem generation · Quick switcher (notes group in the existing palette, via `fuzzyRank`) · Daily notes (today / next / previous; folder and date format as settings keys) · Templates (folder of template notes + `<%today%>` / `<%time%>` / `<%current page%>` expansion at insert time) · Bookmarks, random note, recent notes.

**Plus one self-contained bug fix, verified in source and shipping here rather than as a foundation:** `Mod+]` / `Mod+[` are bound to `editor.action.indentLines` / `outdentLines` and `Alt+ArrowUp` / `Alt+ArrowDown` to `moveLinesUpAction` / `Down` (`apps/web/src/keymap/editor-commands.ts:278–341`). `indentLines` prepends a tab per selected line with **zero list awareness**, so on a parent it detaches the item from its own children; `moveLines` swaps with the physically adjacent row, so moving a parent past a sibling-with-children lands it between that sibling and its first child. **Those four hotkeys actively corrupt an outline today.** Make them list-aware in markdown (subtree rides along, right-sibling sweep on outdent, `lastChildOrSelf` hop on move-up), falling through to the existing line commands elsewhere.

**Layers:** platform-web (completion, follow/hover, palette group, commands) + platform-server (rename transaction, alias resolution) + contracts (settings keys; list-tree algebra in platform-local `packages/outliner`).

**Ports:** `markdown_mirror.cljs` `normalizeStem` + deterministic collision suffixes from a **persisted** index (follow ADR 0016, not the shipped code, which renumbers everyone's files when the alphabetically-first duplicate is deleted) · `outliner/validate.cljs` title rules minus the journal/tag machinery · `content.cljs` rename rewrite ordering as span edits over parsed inline nodes · `outliner/template.cljs` variable expansion (unknown placeholders pass through **unchanged**; local-midnight date arithmetic, never `toISOString`) · `common/date.cljs` formatter table as data (re-expressed on date-fns; Joda tokens do not map 1:1) · `cmdk/core.cljs` palette group-ordering policy and the create-affordance suppression rule · `outliner/core.cljs` `indent-outdent-blocks` + `move-blocks-up-down` for the hotkey repair.

**Unlocks:** the daily-driver threshold. Also settles note identity: path IS identity, rename rewrites via spans behind a checkpoint, and external delete+create pairs surface as unresolved rather than corrupting silently.

---

### Wave 3 — The note has a shape · **6–8 wk**

**Goal:** turn a linked folder into a queryable one — real backlink semantics, tags, typed properties, a content index that replaces ripgrep for notes, and a reading view.

**Features:** Linked-reference include/exclude filters (click includes, shift-click excludes, tri-state) · Include filters satisfied by descendants, excludes only by self+ancestors · Unlinked references section (FTS-backed, never an unindexed scan) · Per-note and per-section reference count badge · Tag hierarchy and inline tags (`#tag`, `#[[multi word]]`, `a/b` nesting; frontmatter + inline merged) · Tags pane · Typed property schema across the vault · Properties panel with typed editors writing back to frontmatter as span edits · Property value coercion and key normalization; invalid keys quarantined as literal text · Per-transaction FTS5 trigram index update with progress and idle gating · Search operator syntax (`file:` / `path:` / `tag:` / `line:` / `section:`, quoted phrases, AND/OR/NOT, parens) · Search snippets with highlighted terms, exact-title fast path, subsequence fuzzy fallback · Reading view · Callouts `> [!note]`, footnotes, `%%comments%%`, `==highlight==` · Outline (headings) pane.

**Layers:** platform-server (reference algebra, FTS5, property schema, search lanes) + platform-web (filter popup, panes, properties panel, reading view) + editor-markdown (callouts, highlight, comments).

**Ports:** `reference.cljs` full memoized `effectiveRefs` / `allowedSubtreeRefs` + explicit-stack DFS — **port its docstring counterexample as the first test** (`foo > baz > bar`, include=`bar`, exclude=`baz` must NOT match `foo`) · `worker/search.cljs` FTS5 trigram DDL + the three triggers (UPDATE as delete-then-insert), lane orchestration with the `enoughExact` short-circuit, `get-match-input` sanitization, RRF fusion, `ensure-highlighted-snippet` windowing (emit `{ text, ranges[] }`, not sentinel-spliced strings) · `property/type.cljs` type set with cardinality and closed values as orthogonal axes plus the two allow-lists · `graph_parser/block.cljs` + `text.cljs` property typing oracles, taken verbatim as the first test table.

**Explicitly NOT ported:** their unlinked-references full scan, and their fuzzy scorer — `packages/contracts/src/fuzzy-rank.ts` is strictly better (tiered, multi-field, deterministic comparator; theirs is a gist-derived subsequence walk with a documented dead accumulator).

**Unlocks:** a queryable vault. Wave 5's query engine becomes a compiler over an index that already exists rather than new infrastructure, and rename stops being the command everyone fears.

---

### Wave 4 — Live Preview fidelity: the engine track · **4–8 wk engine; go/no-go decision due in week 1**

**Runs in the separate `@singapore-editor` repo, in parallel from week one, priced independently so the notes roadmap never blocks on engine surgery and never pretends the gap is closed.**

**Goal:** lift the uniform text-row-height ceiling in editor-core so a heading is actually large, an image grows its line, and a table cell wraps.

**Features:** Variable-height text rows in the row-height index and virtualization · Multi-line inline replacement spans (`inlineMap` currently hard-filters to single-line) · Heading size and item styling follow the text while typing (real scale, not the 1.35em cap) · Inline image rendering with drag-to-resize and persisted width · LaTeX `$inline$` and `$$display$$` · Mermaid diagrams in fenced code blocks · Callouts as real multi-row boxes · Tables rendered with wrapping cells · Inline embeds `![[Note]]` and `![[Note#Heading]]` · Clicking a rendered task checkbox toggles it · Markdown grammar/query additions (`task_list_marker` captures, `(list_item)` folds instead of `(list)`) · Source mode toggle (per-pane, persisted) — the platform half · **Fix the live `editor.syntax.structural_error` "crossing fold ranges" fault (997 occurrences, `logs/` 2026-08-17..22) before anything leans on folds.**

**Ports: none.** Logseq is an **anti-reference** here — its editor swaps the focused block for a `<textarea>`, so it never solved caret geometry over rendered content, variable row height, or multi-line decorations. Do not port `find-position`, `caret-range`, or the `#mock-text` mirror; our source-is-the-buffer model makes all three unnecessary.

**There is no interim fallback any more — read [Engine prerequisite](#engine-prerequisite--the-widget-row-primitive) first.** An earlier draft of this wave proposed falling back to rendering images, math and mermaid as **block rows below the line**, on the grounds that block rows already supported variable height and `ResizeObserver` measurement. That escape hatch no longer exists: the block-surface system was **deleted from the engine repo on 2026-08-22**, after this sweep's inventory agents had already read the code. See Wave 0 for what replaced it and why the deletion made this wave's dependency harder rather than softer.

What survived the deletion is the piece that matters: the **variable-row-height virtualizer machinery** (`rowSizes` on `FixedRowVirtualizerOptions`, the `rowHeightIndex` branches in `fixedRowVirtualizer.ts`, and `virtualization/rowHeightIndex.ts`) was deliberately retained. Blocks were its only feeder, so it is unreachable from production today, but it is generic row-height infrastructure and it is exactly what the Wave 0 primitive feeds. This wave is therefore not starting from zero — it is starting from tested machinery with its consumer removed.

**Unlocks:** every visual feature in the product, and block-level transclusion — which is gated on the same multi-line capability as inline images, and is precisely why deferring the outliner costs nothing extra here.

---

### Wave 5 — Query and view · **6–8 wk**

**Goal:** let users ask the index questions — a small query language compiled to SQL, live query blocks embedded in notes, and one reusable table/list/gallery view that backlinks, tags and all-notes all share.

**Features:** Simple-query DSL parser and compiler (to SQL, not datalog) · Boolean operators with arbitrary nesting, including the or/not combinations Logseq documents as not working · Property filters `(property k v)` including class-inherited defaults · Tag filter, path filter, task filter, priority filter · Journal date range `(between -7d +7d)` and timestamp ranges · Full-text term inside a query · Dynamic template variables in queries `<% today %>` · Embedded live query blocks in a note (` ```query ` fence) · Query results render as a shared table / list / gallery view (multi-key sort, typed filters, group-by) · Query result count, foldable header, no recursion into nested queries · Queries re-run automatically on relevant changes (static watch-key extraction + per-transaction invalidation-key derivation) · All-notes index view.

**Layers:** platform-server (parser → typed IR → SQL, watch keys, invalidation) + platform-web (view engine, query builder chips) + contracts (AST + IR types).

**Ports:** `worker/query_dsl.cljs` five-stage pipeline structure, coercion rules, positional page-ref semantics, resolve-at-compile-time — target SQL; **drop** `add-bindings!` and the appended-`or` workaround (both exist only to satisfy datalog's grammar) · `deps/db/.../rules.cljc` rule **semantics** only; recursion becomes `WITH RECURSIVE` CTEs, which is the thing their file carries a 20-line warning about · `deps/db/.../view.cljs` closed-value position ordering, type-aware sort keys, the empty predicate, ref-filters by id, multi-valued group fan-out · `handler/query/builder.cljs` path-addressed tree algebra (pure, ~200 LOC) · `render_affected_keys.cljs` + watch-dependency extraction — the allowlist-or-opaque conservatism: a **missing** key is a correctness bug, an **extra** key is a wasted re-run, so err broad.

**Unlocks:** Dataview-class capability without a plugin host, plus the saved-view table that tag pages, all-notes and backlinks all want — build it once here or it gets built three times.

---

### Wave 6 — Graph, embeds and panes · **5–7 wk**

**Goal:** the features people screenshot, plus the workbench work a multi-pane notes app needs.

**Features:** Local graph with depth control (including the second-degree pass that makes it a neighbourhood rather than a star) · Global graph with filters, groups, display settings and performance tiering · Graph node interaction with an accessible selection list · Notes excluded from the graph via a property · Embeds and transclusion in reading view, then in-buffer once wave 4 lands · Split panes and linked panes (currently hard-stubbed to `false`) · A **surface registry** replacing the three closed string unions + if-chains, built when the fourth notes pane arrives · Attachment handling (paste/drop → vault asset with a per-note folder policy → link rewrite) · Markdown / OPML / HTML export options · **Canvas — deferred decision:** `.canvas` JSON as a document kind, with no Logseq reference available (whiteboards were deleted upstream in Dec 2025).

**Ports:** `worker/graph_view.cljs` link dedup-and-upgrade (one edge per ordered pair; later contributors upgrade type/label), the **two-phase** orphan computation, depth-bounded label resolution, and the final drop-links-whose-endpoints-vanished pass · `extensions/graph/pixi/logic.cljs` analytic O(n) layout constants (phyllotaxis, ring placement, cluster seeding, golden-angle jitter) — tuned numbers, the cheapest port in the set.

**Reject two anti-patterns:** colours baked into derivation (forces a rebuild on theme change — emit semantic node kinds and resolve tokens at render, per our styling rules), and the silent 20,000-link truncation (report "showing 20,000 of N").

**Unlocks:** differentiation and the multi-pane shell. Nothing structural depends on this wave, which is exactly why it sits after the query engine.

---

### Wave 7 — Optional depth · **open-ended; each item independently shippable**

**Goal:** self-contained features that differentiate but block nothing. Pick by appetite, not by order — and only after the document-first product is real.

**Features:** **Outliner mode as a MODE, not a foundation** — block ids as `^blockid` anchors, block links, Enter/Backspace/Tab semantics over markdown list items, per-item collapse persisted in the workspace cache (never `collapsed:: true` in the file), bullet-drag reorder, zoom into an item · Task status and priority as closed-value properties; TODO/DONE cycling; Scheduled/Deadline datetimes; today's agenda on the daily note · Recurring tasks with the three org repeater semantics (`.+` / `+` / `++`), computed in UTC with whole units · Flashcards by tagging a note/section `#Card`; FSRS scheduling via `ts-fsrs` (MIT — the algorithm is not Logseq's); cloze deletion; three-phase reveal; decks as saved queries · Built-in PDF viewer with text and area highlights; annotations as linkable notes; jump back into the PDF · Quick capture from the OS; unique-note creator; custom home page · Publish public notes as a static site (one-level-deep public closure).

**Ports:** `outliner/core.cljs` indent-outdent convergence filters and move up/down asymmetry (already landed in wave 2 for the hotkey repair; the mode reuses them) · `worker/commands.cljs` three repeater semantics and the declarative post-transaction rule-engine shape (reimplement; do the arithmetic in UTC) · `extensions/fsrs.cljs` card serialization, default-card and due-query rules only · `extensions/pdf/utils.js` `viewportToScaled` / `optimizeClientRects` / `fixSelectionTextBreakline` — **verify provenance**: this appears to be react-pdf-highlighter (MIT), not Logseq, and if so it is the one unit that ports with zero AGPL exposure · `deps/publish/*.cljs` one-level-deep public closure rule (a security rule, not a size optimisation).

**Unlocks:** nothing structural. This wave exists to be cut, reordered, or driven by what the user actually reaches for after wave 3.

---

## Sequencing summary

| Wave         | Theme                                        | Size       | Blocks                                 |
| ------------ | -------------------------------------------- | ---------- | -------------------------------------- |
| 1 (= wave 0) | Vault index + links + backlinks              | 2.5–3 wk   | everything                             |
| 2            | A vault you can live in                      | 4–5 wk     | 3, 5, 6                                |
| 3            | The note has a shape                         | 6–8 wk     | 5                                      |
| 4            | Live Preview fidelity (engine, **parallel**) | 4–8 wk     | every visual feature; in-buffer embeds |
| 5            | Query and view                               | 6–8 wk     | saved views everywhere                 |
| 6            | Graph, embeds and panes                      | 5–7 wk     | —                                      |
| 7            | Optional depth                               | open-ended | —                                      |

Dependency spine: **1 → 2 → 3 → 5 → 6**, with **4 running in parallel from week one** and **7 cut or reordered at will**. Waves 1–3 are the product; 5 is the differentiator; 4 is the risk.

---

## Risks

1. **THE ENGINE CEILING, and it is ours, not Logseq's — decide in week 1.** Text rows have uniform height, and `packages/markdown/src/style.css:7` states outright that heading scale is capped so content fits `--editor-row-height`. _(Superseded citation: this risk originally read "`hasVariableRows` is true only for BLOCK rows, `virtualizedTextViewLayout.ts:229`". That symbol was deleted with the block system on 2026-08-22. The ceiling itself is unchanged — arguably worse, since the only code path that ever produced a non-uniform row height is now gone. See [Engine prerequisite](#engine-prerequisite--the-widget-row-primitive).)_ Inline replacements are additionally hard-filtered to single-line spans (`inlineMap.ts:227`). Real headings, inline images, wrapping tables, display math and in-buffer embeds are **all** behind this, in a separate repo with `bun link` + root-overrides + Vite-restart friction and a stale-`dist`-after-pull failure mode. Everything else in this plan is weeks; this could be months. Spike it behind a flag during wave 1 so wave 3's UI design is not committed to an assumption.
2. **External renames arrive as delete+create.** Both watcher backends map to created/changed/deleted only; `apps/server/src/fs/service.ts:315` emits a real `renamed` event ONLY for renames through our own API. A Finder move or a `git checkout` silently orphans every backlink unless the index reconciles same-`contentHash` delete+create pairs inside one coalesce window. Design it into the FIRST slice, not retrofitted, and when reconciliation fails emit a wide event rather than deleting rows.
3. **Folds are throwing in production right now.** `editor.syntax.structural_error` — "Fold projections `editor.folds.syntax` and `editor.folds.fallback` contain crossing fold ranges" — fires 997 times across `logs/` 2026-08-17..22. `createSyntaxSession` is also first-provider-wins, so an outline fold source must **replace or wrap** the tree-sitter provider rather than compose with it. Fix before section collapse, outline pane, or per-item collapse ships.
4. **ONE SQLite file backs the entire platform today.** `~/.platform/fs-metadata.sqlite`, WAL, `busy_timeout` 5000, shared with the orchestration event log and eight projection tables. An FTS5 trigram index is roughly the size of the indexed text and a full vault reindex holds the write lock. **Mitigation baked into the plan:** give notes its own SQLite file from the first migration. Measure chat-append latency against a realistic vault in wave 3 regardless.
5. **The index is a silent-failure surface.** A missed fan-out is a stale backlink nobody reports; an under-indexed file is a note that is simply unfindable. Build a reconciliation command from day one (diff index against disk, report drift as a wide event) rather than trusting the incremental path — and follow the house rule: if the logs do not explain a failure, fix the logs first.
6. **`InlineReplacementSpec.render` has ZERO production consumers** and no browser tests (only happy-dom with faked rects). Anything routed through it — inline images, math, tags, checkboxes — is **unproven plumbing, not integration**. Price the first one as a spike. Same for `EDITOR_PASTE_HANDLER`, whose only registrations are the engine's own built-ins. _(`registerBlockProvider` was named alongside it in the original draft; it no longer exists — deleted 2026-08-22. `render` was explicitly retained through that deletion precisely because this plan depends on it.)_
7. **No surface registry.** Sidebar tabs, bottom tabs and chat-mode tabs are three closed string unions rendered by hand-written if-chains, and adding an editor document kind is a ~9-site checklist (render branch, three enablement predicates, four tab-model sites, cache `pathForWorkspace`, **both** halves of the address token codec, palette label, opener). Missing one yields a tab that renders but never persists, or persists but is unaddressable — neither fails loudly. Notes adds at least four panes; build the registry when the **second** lands, not the fourth.
8. **AGPL exposure must be decided before anyone opens a file.** The plugin host (`libs/src`, 5,585 LOC of already-TypeScript) is the highest-exposure artifact and the most tempting because it needs no translation — copying it converts the whole application into a derivative work including the network clause. `reference.cljs` and `search.cljs` are genuine derivative-work ports and must be labelled in-file. Nothing in this plan requires opening the plugin host.
9. **Three markdown pipelines, heading for four.** `@singapore-editor/markdown` drives editor live preview via tree-sitter captures; chat renders through react-markdown + remark; wave 1 adds a server-side remark parser for the index; wave 3's reading view would be a fourth. Decide deliberately: **remark server-side for the index, tree-sitter in the editor, reading view REUSES the chat pipeline.** Three renderers that disagree about what a callout is will be discovered by users, not by tests.
10. **Two order-key implementations would coexist if outliner mode lands.** Verified: `packages/contracts/src/order-key.ts` uses `ORDER_KEY_DIGITS = 'a'..'z'`, is fraction-only with no integer part, and `generateSpreadOrderKeys` caps at two digits (675 slots). Correct for the chat rail and project list — tens of rows — and wrong for a 10k-item outline where append is the most common operation. Under file-truth, document position IS the order and no key is needed at all; if wave 7 ever needs one, take npm `fractional-indexing` (CC0) and leave a comment at each definition naming the other and why. This is exactly the six-`basename` hazard `CLAUDE.md` warns about.
11. **Two editor views over one buffer do not repaint each other** — stated outright at `packages/editor/src/editor/autoCloseStore.ts:20` (nothing in core subscribes to buffer changes), and the platform wires no `buffer.subscribe` bridge. This bites the moment "open note in sidebar", linked panes or split panes ship (wave 6), and it will present as data loss.
12. **Ripgrep stays the correctness oracle** per `docs/workspace-search-next-steps.md` (🟢, binding). A notes index that silently changes what exact search returns violates a settled decision. Any semantic or structural mode must be an explicitly separate mode, and the notes FTS path must not alter file-scoped exact search.
13. **Scope honesty on plugins.** For a large share of Obsidian users the product IS the ecosystem — Dataview, Templater, Excalidraw. We are correctly not shipping a plugin host, which means Dataview-class querying must be first-party (wave 5) and Templater-class scripting is explicitly out of scope. Say that in the product framing before someone benchmarks us against a plugin we cannot host.
14. **`PLAN.md` is scheduled to delete the React-effect wiring** that new editor features would naturally attach to, and the editor-parity plan names it a prerequisite. Check where the wikilink plugin and the notes panes hook in before writing wave 1's client half, or it gets rewritten underneath us.

---

## Rejected alternatives

- **DB-authoritative graph with a derived one-way markdown mirror** — Logseq's own destination, and the single most expensive wrong turn available. It demotes our strongest assets (atomic writes with `baseVersion`/mtime guards, the native watcher with app-save attribution, the file tree, editor buffers, `FileSyncService`, git integration, per-turn checkpoints) to irrelevant _for notes_, and pulls in a 714-line mirror renderer, filename policy, a coalescing write queue, one-way lossiness (embeds expand inline), import + repair passes, semantic undo, and eventually rebase — all before the user writes a second note. Their mirror is explicitly never read back, so editing a mirrored file silently does nothing. It buys O(1) rename; it costs the product's premise. Rejected independently by all three input roadmaps.
- **Block-tree-first as the foundation.** `@singapore-editor/core` has no block/node tree, no node identity beyond `Anchor`, uniform text row height, and a closed `EditorCommandId` union. A block tree means reimplementing caret geometry, selection, undo and typing latency that a text buffer gives free, and it reintroduces Logseq's type-ahead-loss bug class on every Enter. Deferred to wave 7 as a **mode** over markdown list items. The only thing genuinely lost by deferring is per-block query granularity, and recording section line ranges in wave 1 buys most of that back.
- **mldoc.** Rejected despite being ISC, out-of-repo and therefore license-clean — a deliberate divergence from two of the three input roadmaps. It parses **Logseq's** dialect: no `![[embed]]`, no `> [!callout]`, no `^blockid`, no `%%comment%%`, while carrying org-mode, property drawers and `((uuid))` we are refusing. It is also a 424 KB js_of_ocaml black box, unmaintained since 2024-08, unpatchable without an OCaml toolchain, and synchronous/CPU-bound. Use remark + mdast (positions, gfm, frontmatter) with a hand-written wikilink/tag scanner over parsed spans. Its license cleanliness is real and irrelevant when the dialect is wrong.
- **npm `datascript` as the query layer.** Verified: the published 1.8.1 dist contains no `datascript.storage` namespace at all, so the lazy SQLite-backed index tree that makes Logseq viable at 50k+ blocks is simply absent from the JS build — you would hold the whole graph in memory, untyped, in compiled ClojureScript, and against upstream rather than Logseq's fork. Its one advantage (1:1 transliteration of query code) evaporates.
- **TanStack DB for graph data.** Its query IR has no fixpoint and its IVM operator set has no `iterate`, so `parent`, `class-extends` and `has-ref` — the three recursive relations everything rests on — are inexpressible as live queries. It also assumes collections live in memory on the client. Our slot-cache + `useSyncExternalStore` pattern (already used in 11 modules) plus SQL recursive CTEs covers it.
- **A client-side database, offline op queue, and rebase pipeline.** The server is loopback and single-writer by construction, which deletes the reason Logseq needed Web Locks master election, a client-ops SQLite database, and `apply_txs.cljs` (1,924 lines with a mid-rebase retry loop, ~8 drop-stale filters, and an undo-history wipe). State the consequence plainly rather than discovering it: an offline edit is not queued, it is not possible. If offline multi-device ever becomes a requirement, the survey is explicit that this design should not be copied — it needs a real op-based CRDT underneath.
- **Semantic undo/redo over structural ops** (`construct.cljc`, ~1,300 LOC, rated XL). Under document-first most structural operations ARE text edits and land on the buffer's existing undo stack for free. Revisit only if wave 7's outline ops produce changes the text stack cannot invert.
- **Porting the plugin host** (`libs/src`, 5,585 LOC). Rejected twice over: it is already TypeScript so "porting" means copy-paste of the highest-AGPL-exposure artifact in the reference, and its iframe-slot model structurally cannot host a view-owning plugin (Excalidraw/Canvas class) — the exact thing Obsidian users install plugins for. If plugins ever ship, derive the registration surface from the feature list and write transport/sandbox/teardown ourselves, with `registerView` bound to file extensions from day one.
- **Transit serialization** (213 sites). It exists to move ClojureScript values across a boundary. TypeScript objects already ARE the wire format; keeping it would reintroduce an opaque payload our JSONL-log-driven debugging culture depends on being readable. This also rules out Immutable.js, which is neither structured-cloneable nor JSON-serializable — note our root override on `immutable@4.3.9` is a transitive pin, not adoption.
- **The `kvs` blob store / DataScript `IStorage`** (`sqlite.cljs`, `gc.cljs`, the 1000 ms `d/store` debounce, manual WAL checkpointing, a dedicated GC module plus a TODO for a second). With rows in SQLite the index tree has no job, and we gain a database inspectable with `sqlite3` — which Logseq gave up.
- **`:block/left` prev-sibling pointers and `:block/path-refs`.** Both were removed by Logseq itself (path-refs by an explicit schema-65.11 retraction) because a lost write orphans a sibling run and a subtree move rewrites every descendant. Do not rebuild either under a different name. Compute ancestor refs at query time with a recursive CTE.
- **Property values as hidden child blocks.** Named in the survey as the largest source of accidental complexity in their outliner core, and verifiable: it creates a second notion of "child" that leaks into sibling navigation (a whole parallel code path at `deps/db/src/logseq/db.cljs:427-495`), move, indent/outdent and delete. Store scalars inline in an EAV table; promote to a node only when the value is genuinely a reference.
- **`collapsed:: true` written into the file.** Fold state is view state; writing it to disk produces a git diff on every collapse. Persist per-note in the existing versioned workspace cache, keyed by note path + heading/item anchor.
- **Eager page creation on `[[link]]`.** Logseq creates page `foo` the moment you type `[[foo]]`, which silently fills a vault with typo pages and is why they later needed orphan-page garbage collection. Obsidian's unresolved-link state is correct AND cheaper: the link renders dimmed, the note is created only on click.
- **A `custom.js` / SCI-equivalent user-scripting hook, and raw-SQL escape hatches in the query language.** Forbidden by our own settings doctrine: a value that reaches execution cannot be workspace-scoped, and a workspace file ships inside a cloned repository. Logseq's 7-day-expiring `confirm()` is not a security control. Declarative transforms only, and say so explicitly rather than leaving the field open.
- **A web worker for the notes graph.** Zero workers exist in the app today, and roughly a third of Logseq's worker infrastructure is compensating for having nowhere but a browser tab to put a database. Our Bun server is a strictly better worker: real filesystem, native SQLite, one writer by construction, and it outlives the tab. Keep `worker: { format: 'es' }` in the Vite config as an escape hatch, not as a plan.
- **Logseq's fuzzy scorer, its unlinked-references implementation, and its keymap dispatcher.** All three would be downgrades: `packages/contracts/src/fuzzy-rank.ts` is tiered, multi-field and deterministic where theirs is a gist-derived subsequence walk with a documented dead accumulator; their unlinked references is an unindexed full scan over every block title; their keymap runs two competing window-level listeners with `:before` guards, which their own notes call the source of most subtle ordering bugs. Take their binding TABLE as data and nothing else.
- **Whiteboards** — deleted upstream in Dec 2025 along with the vendored tldraw v1 fork, so there is nothing to port against. If a canvas is ever wanted, use current tldraw and store the document as an opaque asset; do not make shapes blocks. **SM-5 spaced repetition** — superseded by FSRS, and its OF matrix is written under the old ease factor and read under the new one, so a faithful port reproduces a bug.
- **A third `WorkspaceUiMode` for notes in wave 1.** Notes are `.md` files in the workspace the app already opens. A mode costs seven consumer edits plus an address-grammar change and buys nothing a user can see in the first month. Revisit only when a notes-specific surface (graph, all-notes table) genuinely has nowhere else to live.
- **Leading with the outliner keyboard model** (one input roadmap's wave 1). Its first slice is kept — the four hotkeys genuinely corrupt outlines today and fixing them is cheap, falsifiable and creates no one-way doors — but it is grafted into wave 2 as a self-contained repair rather than being the foundation. Leading with it would delay the keystone every other feature consumes by 4–5 weeks in order to ship a keyboard model the product may never want as its default.
- **A new `@singapore-editor/*` package in the first pass.** Two were proposed — `@singapore-editor/outline` and `@singapore-editor/completion`. Both are genuinely host-agnostic, and both are rejected FOR NOW on the two-consumer rule. See [Layer split](#layer-split) for the promotion criteria and the public surface each would carry.

---

## Open questions for the user

1. **AGPL posture — answer before anyone opens a file.** Every module labelled `port` above produces derivative work carrying AGPL-3.0 obligations including the network-use clause. Are ports acceptable with in-file source labels, or should the highest-exposure modules (`reference.cljs`, `search.cljs`) be rebuilt clean-room from their behavioural descriptions at extra cost?
2. **Wave 4 go/no-go — now a real fork, not a hedged one.** Variable-height text rows are engine surgery in the separate repo and could be months. The original framing offered a block-row fallback (images/math/mermaid below the line, not inline); **that fallback was deleted on 2026-08-22** along with the rest of the block system, so the question is no longer "spike or fall back". It is: fund the widget-row spike in week 1 and design wave 3's UI around the result, or accept that everything with real height slips indefinitely and ship a text-only vault first. See [Engine prerequisite](#engine-prerequisite--the-widget-row-primitive).
3. **Plugins.** Dataview and Templater are the two plugins Obsidian users would miss most. We are shipping Dataview-class querying first-party in wave 5; Templater-class scripting is out of scope. Is "no plugin host, ever" the stated product position, or a "not yet"?
4. **Canvas.** `.canvas` is an Obsidian format with no Logseq reference (whiteboards were deleted upstream). Is it in scope at all, and if so as a document kind we render, or as an opaque asset we merely store?
5. **Same-name notes.** Document-first means two notes cannot share a filename in one folder, so `Apple #Company` / `Apple #Fruit` is not expressible the way Logseq expresses it. Acceptable, or does the display-title-in-frontmatter workaround need to be a first-class feature?
6. **Reading view pipeline.** Reuse the chat markdown renderer (react-markdown + remark) or build a third? Reusing means one renderer's callout semantics become the product's; building means three pipelines that will disagree.
