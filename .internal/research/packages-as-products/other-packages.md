# Other packages: what we have besides Fregat, Singapore and ghostty-webgpu

Research for [Plan 336](../../../plans/336-packages-as-products.md), Track A. Checked 2026-10-08
against fregat `0df5eb872`, tree-sitter-x `origin/master` `4af98281`, tree-sitter-md `ff455a7`
and fast-ulid `5717be9`. npm versions and weekly downloads come from the npm registry and
`api.npmjs.org` on the same day.

## Summary

| Package                                                               | One line                                                                 | Recommendation                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| hotkeys (`@fregat/hotkeys`, `@fregat/react-hotkeys`)                  | Zed's keymap model for the web and terminals                             | **Sell now**, after it actually reaches npm                      |
| tree-sitter-md                                                        | Incremental Markdown for editors, 676/676 CommonMark + GFM               | **Polish first**, then sell as a Singapore part                  |
| tree-sitter-x (`@singapore-editor/tree-sitter-x`)                     | web-tree-sitter without Emscripten, with in-memory text and C extensions | **Polish first**; it is the base of the Singapore speed story    |
| fast-ulid                                                             | ULID generator, about 8x faster than `ulid`                              | **Sell now** after one benchmark rerun                           |
| `packages/markdown`                                                   | Streaming chat Markdown for React, highlighted by Singapore              | **Candidate to publish**, later, as a Singapore add-on           |
| `ghostty-webgpu-line-editor`                                          | Readline for browser terminals without a PTY                             | **Candidate to publish** as a ghostty-webgpu addon once wired in |
| `packages/pty`                                                        | Bun PTY that does not lose the last bytes                                | Leave internal; upstream the finding to Bun                      |
| `packages/tree`                                                       | Fork of Pierre's file-tree model and path store                          | Leave internal                                                   |
| `packages/ui`                                                         | Fregat's design-system patterns                                          | Leave internal; mine for blog posts                              |
| `packages/client-core`, `contracts`, `observability`, `utils`, `push` | App plumbing                                                             | Leave internal                                                   |
| game-of-life                                                          | 1.07 billion cells at 43 generations/s in a browser                      | Showcase, not a product                                          |
| place                                                                 | r/place clone on WebGPU + Bun                                            | Showcase, not a product                                          |

The two that can carry a pitch on their own today are **hotkeys** (no npm library does what it
does) and **fast-ulid** (a simple number beats a 14M-downloads-a-week incumbent). tree-sitter-x and
tree-sitter-md are the strongest engineering here, but they sell best as the reason Singapore is
fast, not as standalone products.

---

## hotkeys: `@fregat/hotkeys` and `@fregat/react-hotkeys`

**One line.** Keyboard shortcuts that work the way Zed's do: bindings chosen by what has focus,
chords, user overrides and unbinding, display labels and recording, with a core that never touches
the DOM.

**Status.** Version 0.0.3 in the changeset group `["@fregat/hotkeys", "@fregat/react-hotkeys"]`
(`.changeset/config.json`), `publishConfig.access: public`, but **`npm view @fregat/hotkeys`
returns 404**. The Singapore and ghostty-webgpu packages from the same release workflow are on npm
at 0.1.2. Unconfirmed cause; the likeliest is that the `@fregat` npm scope does not exist or the
token cannot publish to it. The GitHub mirror (`ShaulLavo/hotkeys`) has 0 stars and no homepage.
Source 6,027 lines, tests 7,121 lines, about 500 test cases across both packages. Fregat itself
imports it from 40 files in `apps/` (web keymap and the TUI's `apps/tui/src/commands/state/keymap.ts`),
so it is dogfooded on two very different hosts.

**Differentiators, with evidence.**

1. **Zed context predicates over a focus tree.** Focus nodes publish contexts
   (`'Editor extension=md'`); a binding's `context` is a predicate with `==`, `!=`, `!`, `&&`, `||`,
   parentheses and `>` for descendant (`Workspace > !Terminal`). The deepest matching context wins.
   `src/context/predicate.ts`, `src/context/key-context.ts`, `docs/keymaps.md`; commit `3fe11cf81`.
   A web search found no npm library that combines expression contexts with a focus stack: the
   nearest are `context-keys` (expressions only, no keyboard), KeyboardJS and Keybindy (named
   switchable scopes, no expressions). TanStack Hotkeys offers element targets and an `enabled`
   flag, not contexts.
2. **Layered keymaps with unbinding.** Sources rank `user` > `pack` > `base` > `default`, so a user
   can take a key back from a keybinding pack: `{ keys, unbind: 'markdown.bold' }` removes one pair,
   `command: null` removes all weaker bindings (`src/dispatch/keymap.ts`; `bdb8a590e` adds Zed's
   BASE layer). This is exactly what an app needs to ship VS Code or Vim keymap packs.
3. **Command bubbling.** A handler returning `false` passes the command to the next ancestor, then
   the key to the next candidate binding (Tab indents with a selection, otherwise falls through).
   `dispatchCommand()` runs commands without a key.
4. **Correct chords.** Trie-based (`src/chords/trie.ts`). A bound prefix waits for its continuation
   then runs itself; a mismatch runs the longest bound prefix and replays the rest, as Zed does
   (`d0eeaa33e`); a pending chord ends on focus change, blur, hidden tab or pointer down
   (`76a58bf5f`, `8c9ad79ca`).
5. **Terminal adapter.** `keyInputFromTerminalKey` reads opentui key events, legacy escapes and the
   kitty keyboard protocol (`src/adapters/terminal.ts`, `6b49fb15a`). The same keymap drives a
   browser app and a TUI. No browser shortcut library does this.
6. **Measured.** `docs/performance.md`: 0.04 µs per bound key through the trie, 0.17–0.19 µs through
   the full dispatcher with context resolution, against about 83 µs for a linear match scan over
   255 bindings. Construction is linear to 25,500 bindings.
7. Kept from TanStack Hotkeys: `formatForDisplay`, single and sequence recorders, held-key state,
   hints, React hooks.

**Competitors.**

|                        | Weekly downloads | Size                                                                                                       | Contexts                                          | Chords                     | Terminal | Recorder / display |
| ---------------------- | ---------------: | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------- | -------- | ------------------ |
| react-hotkeys-hook     |             5.9M | small                                                                                                      | scopes by name                                    | sequences                  | no       | no                 |
| hotkeys-js             |             1.7M | ~2.5 KB                                                                                                    | one active scope                                  | no                         | no       | no                 |
| @tanstack/hotkeys 0.11 |             1.2M | larger, 10 framework adapters                                                                              | element target + enabled                          | sequences                  | no       | yes                |
| tinykeys               |             372k | ~650 B                                                                                                     | no                                                | sequences                  | no       | no                 |
| **@fregat/hotkeys**    |  0 (unpublished) | 17.5 KB gzip whole bundle; 8.8 KB for `createBrowserDispatcher` alone (measured with `bun build --minify`) | **Zed predicates + focus tree + layered sources** | **trie, Zed replay rules** | **yes**  | yes                |

We lose on size and on framework breadth (React only against TanStack's ten). We win on everything
an editor or IDE-style app needs. The honest positioning is "the keymap engine for apps with
panes", not "a hotkey library": the users are people building editors, terminals, design tools and
dashboards with many focusable regions, who today port VS Code's `when` clauses by hand.

**Recommendation: sell now**, once it is on npm.

- Fix publishing first (scope ownership or rename). A product page pointing at a 404 is worse than none.
- Lead with the `Mod+B` example from `docs/keymaps.md` (same key, bold in the Markdown editor,
  sidebar elsewhere, user takes it back). It shows contexts, layers and unbinding in ten lines.
- A live demo: three nested panes, a context-stack readout, the pending-chord hint, and a "which
  binding wins and why" panel built on `bindingsForInput`.
- Comparison table like the one above, with sizes measured by the same tool.
- Say "fork of TanStack Hotkeys" in the footer, not the description line; the npm description now
  starts with the fork.
- Name: `@fregat/hotkeys` ties it to Fregat. Plan 336 lists it as its own product; decide the name
  before the first public release, since renames after adoption hurt.

---

## tree-sitter-x

**One line.** A tree-sitter fork whose web runtime is built with the WASI SDK instead of
Emscripten, keeps document text in wasm memory, and loads C extensions next to the parser.

**Status.** Repo `ShaulLavo/tree-sitter-x`, 0 stars, issues disabled, About text "tree sitter for
fregat" and homepage still upstream's. Published as `@singapore-editor/tree-sitter-x` 0.28.0
(113 downloads/week, almost certainly our own installs). Plan 336 marks it out of scope until the
owner adds it.

**Differentiators, with evidence.**

1. **No Emscripten, same API.** `fc034c3a`, `295229d6`. Grammars built by the stock CLI load
   unchanged. A differential suite runs 16 grammars and about 1,500 corpus examples through both
   builds and requires identical trees, changed ranges after seeded edits and highlight captures
   (FORK.md as of `ca8b155f`, since folded into the README).
2. **`TextBuffer`: parse in place.** The parser reads text from its own memory instead of calling
   back into JS. Edit median on a 1 MB Markdown file 0.821 ms upstream to 0.352 ms (p95 1.400 to
   0.698); load of runtime plus one grammar 40.2 ms to 17.1 ms (Node 22, 4-core container,
   noise about 20%). On 156 KB of JavaScript the edit difference is within noise. `c243411d`.
3. **C extensions in the same memory.** `loadExtension(wasm)` runs C code that walks trees through
   tree-sitter's C API with no copy and no JS (`f7e8f2de`). tree-sitter-md's resolver is the first user.
4. A real upstream bug fixed: first-child-for-byte failed inside hidden trailing content
   (`083bb8e9`), with a regression test that fails without the fix.
5. TextMate scope compatibility (`docs/plans/textmate-scope-compatibility.md`): Phases 0–1 built a
   differential harness against Shiki and vscode-textmate. Baselines are 5.2–8.9% exact scope-path
   agreement and 56–100% style agreement (`/work/reports/textmate-scope-wave/README.md`). That is
   infrastructure, not a result; nothing to sell until Phase 2.

**Competitors.** `web-tree-sitter` 0.27 upstream (the default everyone uses). Lezer (CodeMirror)
for the incremental-parser role. Nobody else ships a non-Emscripten web-tree-sitter.

**Recommendation: polish first; sell as part of Singapore.** Real wins, but narrow: people who
already use web-tree-sitter and edit big documents. Before anything public: fix the About text and
homepage, rerun the bench on a quiet machine with Chromium as well as Node, publish the
differential-test result as a badge-worthy line ("identical trees on 1,500 corpus examples across
16 grammars"), and decide whether the package name stays under `@singapore-editor`. The fork's
README is already short and honest; keep it.

---

## tree-sitter-md

**One line.** Markdown for editors: a tree-sitter block grammar plus cmark's inline algorithm in C,
running as a tree-sitter-x extension, returning compact typed arrays for decorations, highlights,
folds and fence injections.

**Status.** `tree-sitter-md` 0.1.1 on npm, our name, 2,780 downloads/week (source of those
downloads not checked; likely Fregat CI and installs). Repo has 1 star. Release gates documented in
`docs/RELEASE-0.1.md`. Platform pins drifted 0.1.1 to 0.1.2 (issue #208 in fregat, per the scope
wave report).

**Differentiators, with evidence.**

1. **Correctness with receipts.** 676/676 CommonMark 0.31.2 + GFM examples; 183/183 chat
   messages; 497 pinned repository documents with zero unexpected differences; 11,300 fuzz edits
   with zero fresh-versus-incremental differences and a negative control; native ASan/UBSan runs
   (`docs/RELEASE-0.1.md`).
2. **Beats lezer where editors care.** `docs/FINDINGS.md`: 99.4% spec examples against lezer's
   97.9% (pre-release; 100% now), about 20 real corpus mismatches for lezer against 0 here, and per
   keystroke at 1 MB 0.49 ms median / 1.0 ms p95 against lezer's 0.59 / 3.0 ms in the same runs.
3. **Output shape built for editors.** `decorationsForRows(from, to)` returns a `Uint32Array`;
   warm, 60 rows cost 0.023 ms for decorations. `LinkText` ranges make live preview (hide brackets
   and destination) direct.
4. Chromium cold numbers (`docs/RELEASE-0.1.md`): 1 MB document, 41 ms full parse, 1.1 ms first
   visible outputs, 0.2 / 0.3 ms edit median / p95.

**Honest costs** (the repo already states them): 193 KB gzip total against lezer's 20 KB (82 KB if
the host already loads tree-sitter-x); 7.5 MB wasm memory for a 1 MB document; giant single
paragraphs and fences cost 50 ms per edit and need a worker; no footnotes, math or CJK flanking yet.

**Competitors.** `@lezer/markdown` (CodeMirror), upstream `tree-sitter-markdown` (two grammars,
inline split), micromark/remark (correct, not incremental).

**Recommendation: polish first, then sell as the Markdown engine behind Singapore's Markdown
mode.** Standalone pitch only to people already on tree-sitter. Polish: the README build section
defaults `WASI_SDK` to `/work/cache/...` (an owner path; make it a documented requirement), add a
size-versus-lezer note up top so nobody is surprised, footnotes and math before calling it
"Markdown for editors" without qualification.

---

## fast-ulid

**One line.** A ULID generator that is about 8x faster than `ulid` and `ulidx`, close to
`crypto.randomUUID`, zero dependencies.

**Status.** `fast-ulid` 1.2.2 on npm, 205 downloads/week, 0 stars, 13 commits, last push
2026-10-06. Error handling and timestamp validation were tightened in `5717be9`.

**Evidence.** README table (M1, Bun 1.3.10, separate bench repo `ShaulLavo/fast-ulid-bench`):
single monotonic ID 57 ns against 465 ns (`ulid`) and 476 ns (`ulidx`); timestamp decode 2.3 ns
against 284 ns. The README itself says those numbers predate the validation fixes and must be
rerun. The npm description says "Fastest spec-compliant"; the README no longer does.

**Competitors.** `ulid` 14.4M/week, `ulidx` 800k/week, `crypto.randomUUID` (and UUIDv7) for
anyone who just needs sortable IDs.

**Recommendation: sell now, after one rerun.** Small, self-contained, a single number makes the
case. Rerun the bench on current code, put date, machine and runtime beside it, add Node and a
browser row, and align the npm description with what the README proves. A UUIDv7 row belongs in
the table, since that is the real alternative in 2026. It does not need a site; a strong README
is enough.

---

## Unpublished packages in `packages/` and `ghostty-webgpu-line-editor/`

### `packages/markdown` (`@workspace/markdown`): candidate to publish, later

Streaming Markdown renderer for chat, in React. 1,485 lines. What is distinctive:

- Settled blocks are immutable and reused for the rest of the message; only the tail reparses
  (`src/utils/blocks.ts`, `session.ts`).
- Ambiguous tails are held back instead of flashing: a lone `#`, a bare list marker, an unmatched
  backtick run, a table row before its separator (`src/utils/hold.ts`). Unclosed syntax is healed
  with `remend` (`heal.ts`).
- Code fences highlight through `@singapore-editor/highlighting`, with a byte-bounded LRU.

Competitor: Vercel's **Streamdown** (8.1M downloads/week), which also uses `remend` and memoized
blocks. Our tail-holding rules are a real improvement, but the market leader is huge and the
packages share most of their approach. Publish only as a Singapore add-on ("chat Markdown with
Singapore's highlighter"), after a side-by-side flicker comparison against Streamdown proves the
difference on video.

### `ghostty-webgpu-line-editor`: candidate to publish as a ghostty-webgpu addon

Readline-style editing (grapheme-aware model, keymap, history, reverse search, cancellable
completion) for terminals with no PTY behind them, such as the ghostty-webgpu site's demo shell.
735 lines, one commit (`6e27de346`), private, already in the release changeset scope. Plan 286
(`plans/286-ghostty-extensions.md`) owns it. Competitors: `xterm-readline` (16k/week), `local-echo`
(abandoned). Real gap; publish with the ghostty-webgpu addon set once it attaches to a terminal.
Not ready today: the README says rendering and `readline()` integration are the next unit.

### `packages/pty` (`@workspace/pty`): leave internal

248 lines over Bun's native terminal (`Bun.spawn` with terminal options, Bun 1.3.14+). Its one
valuable finding is in `docs/design.md`: on Linux the child exits before the PTY's final bytes
arrive, so closing on subprocess exit truncates output; it waits for PTY EOF. That is a good bug
report or docs contribution for Bun, not a product. Competitors `node-pty` (4.8M/week) and
`bun-pty` (393k/week) cover the use; a 248-line wrapper does not earn a package.

### `packages/tree` (`@workspace/tree`): leave internal

A product-owned fork of Pierre's tree and path-store (Apache-2.0, `UPSTREAM.md`), 8,558 lines.
The view moved into the app (`8f1b62af6`, Plan 178), so the package is now the model: path store,
controller, virtualized projection, drag and drop, git status patches, prepared-input reuse (gated
at 50k paths). Upstream `@pierre/trees` is published and has 1.5M downloads/week. Publishing a fork
of a popular published package with a deliberately narrower API has no audience. If we find a
measured win (the prepared-input remount or git-status patches), send it upstream.

### `packages/ui` (`@workspace/ui`): leave internal, mine for posts

shadcn/Base UI components plus 30 patterns in `src/patterns/`: a 285-line `virtual-list`,
tail-follow for streaming logs, one shared tooltip layer driven by `data-tooltip` delegation
(`tooltip-layer.tsx`, 52 lines), listbox keys, tree row guides. Good, but tied to Fregat's tokens
and copy rules, and the category (shadcn registries, TanStack Virtual, virtua) is crowded. The
tooltip-layer and tail-follow patterns, and the "no hairlines, tone-only separation" design rule,
are worth blog posts on the Fregat site rather than packages.

### `packages/client-core`, `contracts`, `observability`, `utils`, `push`: leave internal

- `client-core` (17.7k lines) is the Fregat client: transport, chat, git, files, settings,
  optimistic state. If Fregat ever opens its protocol to third-party clients, this becomes the SDK.
  Not before.
- `contracts` (16.3k lines) is the wire and settings schema. Internal by definition.
- `observability` (936 lines) configures evlog, env files, retention and sanitizing. App-specific.
- `utils` (257 lines) and `push` (6 lines) are too small to matter.

---

## Other repositories

### game-of-life: showcase

Vanilla TypeScript, no runtime dependencies. A 32,768 x 32,768 board (1.07 billion cells) at about
43 generations per second on a 28-thread desktop while rendering at 60 fps: bit-packed cells,
bit-sliced neighbour counting, workers over `SharedArrayBuffer`, WebGL2. 3 commits, 0 stars, last
push 2026-09-04. The README explains the speed clearly. This is a great "we make browsers fast"
exhibit: link it from the Fregat site or a performance blog post, with a hosted demo (it needs
COOP/COEP headers, which Cloudflare Pages can set). Not a package.

### place: showcase

A 1:1 r/place clone: 2000 x 2000 canvas, WebGPU renderer with WebGL2 fallback, Bun + Elysia,
binary WebSocket sync, Solid 2, a load-test script. 2 commits, 0 stars. Fun, but a clone of a
known thing; at most a line in an "other experiments" list. Not a package.

---

## Checklist for the other tracks

- [ ] Find out why `@fregat/hotkeys` and `@fregat/react-hotkeys` are not on npm while the same
      release publishes Singapore and ghostty-webgpu; fix scope ownership or rename before any page links to npm.
- [ ] Decide hotkeys' public name (keep `@fregat/hotkeys` or give it its own scope) before 0.1.
- [ ] hotkeys README: lead with the `Mod+B` context example, a comparison table (react-hotkeys-hook,
      hotkeys-js, TanStack Hotkeys, tinykeys) with sizes measured by one tool, the terminal adapter,
      and the per-event benchmark; move "forked from TanStack Hotkeys" out of the npm description's first words.
- [ ] hotkeys demo page: nested panes, live context stack, pending chord, "which binding wins" panel.
- [ ] Set the `ShaulLavo/hotkeys` About text, homepage and topics once a URL exists.
- [ ] fast-ulid: rerun the benchmark on current code (Bun, Node, a browser; date, machine), add a
      UUIDv7 row, align the npm description with the README.
- [ ] tree-sitter-x (when the owner adds it to scope): replace the About text and upstream
      homepage, rerun bench in Node and Chromium on a quiet machine, state the differential-test
      result in the README.
- [ ] tree-sitter-md: remove the `/work/cache` default from the README build section, put the size
      trade-off against lezer near the top, cite it from Singapore's Markdown docs as the engine.
- [ ] Fregat site or blog: a performance page that links game-of-life (hosted with COOP/COEP) and
      the tree-sitter-x / tree-sitter-md measurements as evidence for "every layer is ours".
- [ ] Do not create product pages for pty, tree, ui, client-core, contracts, observability, utils,
      push or place.
- [ ] Revisit `packages/markdown` after a recorded flicker comparison with Streamdown, and
      `ghostty-webgpu-line-editor` when Plan 286 attaches it to a terminal.

## Sources

- [TanStack Hotkeys overview](https://tanstack.com/hotkeys/latest/docs/overview)
- [VS Code when clause contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
- [context-keys](https://github.com/fabiospampinato/context-keys)
- [Keybindy](https://github.com/keybindy/core)
- [KeyboardJS](https://github.com/RobertWHurst/KeyboardJS)
- npm registry and `api.npmjs.org/downloads/point/last-week/<package>`, 2026-10-08
