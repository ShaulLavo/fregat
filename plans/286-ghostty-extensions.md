# Plan 286: ghostty-webgpu extensions, with a line editor first

## Status and authorization

- Status: APPROVED 2026-10-02 by the owner: "we started building features that shouldn't be in the
  base … all we need to do now is to write a plan for an extension model, similar to xterm, and a
  line editor is gonna be one of the first ones."
- Owns: `ghostty-webgpu/` (core and new extension packages), its site, and Platform's terminal
  feature (`apps/web/src/features/terminal/`), the package's only consumer.
- Versions: patch bumps only, including public API changes, under the owner's 2026-10-03
  package-version decision. Update all consumers in the same delivery unit.

## Outcome

ghostty-webgpu's core is the terminal: native VT semantics, input, selection, damage tracking,
scheduling and the WebGPU renderer. Everything a host can do without ships as an extension: a
plain value the host lists, `Terminal.create({ extensions: [fit(), links(), readline()] })`. The
first extension is a
readline-style line editor that turns the site's Shell tab into a shell that edits like bash. The
features that are in core today but do not belong there move out one by one, and Platform loads
the ones it uses explicitly. Native Ghostty features that matter on the web (search, shell
navigation, progress, notifications) arrive as extensions on top of semantics libghostty-vt
already has. A third party can write an extension against the public API alone.

## Research

Clones in `references/` (gitignored): `xterm.js` (c58ea36), `local-echo` (8d0b7f5),
`xterm-readline` (0268a50, the maintained repo is strtok/xterm-readline), `ghostty-web` (1858a59),
`ghostty` (83edd49; the native OSC prerequisite pins official 7b11f3d).

### xterm.js addons

- Contract: `interface ITerminalAddon extends IDisposable { activate(terminal): void }`;
  `terminal.loadAddon(addon)` activates synchronously; disposal is idempotent and the terminal
  unloads addons in reverse order (`typings/xterm.d.ts:1426–1440`,
  `src/common/public/AddonManager.ts:17–51`). No dependency resolver, no duplicate guard, no
  rollback when `activate` throws. Hosts pass addon instances to each other by hand. Keep that
  simplicity; add rollback.
- Addons see the public Terminal: buffers and cells, `write`, selection, scroll, resize, options,
  `onData`/`onKey`/`onRender`/`onWriteParsed`, parser hooks (CSI/OSC/DCS/ESC/APC), link
  providers, character joiners, markers and decorations, Unicode providers.
- Packaging: core `@xterm/xterm`, addons `@xterm/addon-*`, each versioned on its own. No addon
  declares a peer range on core, so compatibility is by convention.
- 13 official addons: attach, clipboard, fit, image, ligatures, progress, search, serialize,
  unicode11, unicode-graphemes, web-fonts, web-links, webgl. Canvas moved out of core in v5 to
  cut the bundle (379 → 265 KB) and was later dropped.
- The pain is private reach-ins: webgl swaps internal renderer services, image monkey-patches
  `open`, serialize reads private attributes, progress builds a private emitter. coder's
  `ghostty-web` copies the addon contract and its fit addon casts to `any` for renderer metrics
  (`lib/addons/fit.ts:140–155`). The rule this plan takes from that: every extension, ours
  included, builds on the public API only, and a hook an extension needs is added to core.

### Line editors

- local-echo: `onData` only, parses escapes itself, repaints prompt and whole line each edit,
  counts UTF-16 units as columns (breaks on colored prompts, CJK, combining marks, surrogate
  pairs), heuristic multi-line, bounded history with a cap bug, synchronous completion,
  `read()`/`abortRead()`, and `printAndRestartPrompt()` to coordinate output.
- xterm-readline: `onData` plus a custom key handler, separates line model, state, keymap and
  geometry, incremental redraw for appends, handles escapes, tabs and wide characters (code
  points, not grapheme clusters), programmable completeness callback, Alt/Shift+Enter newline,
  50-entry history under a shared `localStorage` key, no completion, one `read()` with no
  cancellation, and output printed during an edit corrupts the line.
- Take xterm-readline's separated model and incremental rendering and local-echo's completion and
  output coordination. Fix what both get wrong: grapheme clusters, cancellation, Ctrl+C, and
  output arriving while a line is being edited.

### Extension models compared

The owner asked for a model better and simpler than xterm's. Surveyed: CodeMirror 6, ProseMirror,
Lexical, VS Code, Vite/Rollup, kitty kittens, WezTerm, xterm.js, and our own Singapore Editor.

- **Singapore's model is the one to avoid.** It runs two lifecycle systems side by side
  (`install/activate/update/deactivate/dispose` in `editor/packages/editor/src/plugins.ts` and
  scoped setup in `createPlugin.ts`), asks authors to learn about ten concepts (dependencies,
  providers, registrations, scopes, state, channels, derived values, watchers, phases, render
  ownership), dedupes by object identity while documenting names, keys typed channels by strings
  with no runtime check, and real plugins keep state per factory so one plugin cannot safely serve
  two editors (`editor/packages/diff/src/editorDiffPlugin.ts`). Its one good idea is scoped
  cleanup.
- **xterm.js** is small but weak on ownership: mutable addon instances, a manager that overwrites
  the addon's `dispose`, no rollback when `activate` throws, no guard against reusing an instance.
- **CodeMirror 6** composes best: extensions are values and arrays, and each facet declares how
  contributions combine. Its full machinery (facets, fields, effects, compartments, five
  precedence buckets) is more than a terminal needs.
- **Vite/Rollup**: a factory returns named hooks and keeps state in its closure. Easy to read.
- **VS Code** and **Lexical**'s newer extension layer add manifests, activation events and
  dependency graphs: built for app ecosystems, too heavy here.
- **kitty kittens** and **WezTerm**: good for standalone commands and config, weak for resident
  extensions (no deregistration, reload loses state).

The chosen model takes CodeMirror's values and arrays, Rollup's named hooks with closure state,
and scoped cleanup; it leaves out dependency injection, registries, string channels, reactive
graphs, manifests and priority layers. The Editor's [Plan 122](122-composable-plugins.md) uses the same
model.

### What native Ghostty brings

From the macOS app, apprt and VT layer (`references/ghostty`):

- libghostty-vt already parses and stores OSC 133 semantic prompts, OSC 7 cwd, title, OSC 9/777
  notifications, OSC 9;4 progress, OSC 52 clipboard (reads too) and the kitty keyboard protocol.
  Our bridge (`src/core/bridge.ts`, `src/core/types.ts:101–109`) exposes title, bell and clipboard
  writes, but not prompt marks, cwd, notifications or progress.
- Research against the original c8554f2 pin found newer semantic-prompt callbacks and a C search
  API with cell ranges. Extension integration of these native APIs remains later work.
- Kitty graphics is disabled for `wasm32-freestanding`, our target (`src/terminal/build_options.zig:155–165`);
  Sixel is not implemented. Images are not available without upstream work.
- App-level, not for a library: quick terminal, splits and tabs, the command palette UI, secure
  keyboard entry, closed-surface undo, the `+` CLI actions.
- Lessons: one parser owns the state and extensions read it, never reparse output; operations are
  typed commands separate from the keys or menus that trigger them; config is data; search,
  output selection and links need ranges that survive scrolling and reflow.

## What exists today

Production lines: core ~4,700, term ~2,500, DOM ~6,200, render ~5,300, config resolver ~2,000.
`src/dom/terminal.ts` (1,357 lines) owns every controller. Host events: appearance, bell, data,
error, frame, resize, scroll, selection, title.

| Feature                                                                                     | Where                                                                     | Verdict                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| WASM runtime, ABI, bridge, terminal ops, input encoding, damage, packed rows, history reads | `src/core/`, `src/term/session.ts`                                        | Core                                                                                   |
| Native selection, pointer and mouse arbitration, keyboard/IME/paste                         | `core/selection.ts`, `dom/pointer.ts`, `dom/selection.ts`, `dom/input.ts` | Core: one owner arbitrates gestures and keys                                           |
| Scheduler, row renderer, atlas, WebGPU backend                                              | `src/render/`                                                             | Core                                                                                   |
| Renderer fallback coordinator                                                               | `render/selector.ts`, `render/fallback.ts`                                | Core, loading backends lazily                                                          |
| WebGL, Canvas2D, DOM backends                                                               | `render/webgl`, `render/canvas`, `render/dom`                             | Lazy backend modules (Phase 4)                                                         |
| Links (URL, OSC 8, providers)                                                               | `dom/links.ts` (546), `term/links.ts` (469)                               | Extension                                                                              |
| Automatic fit                                                                               | `dom/fit.ts` (563)                                                        | Split: measurement and atomic geometry commit stay; observers and auto-sizing move out |
| Scrollbar                                                                                   | `dom/scrollbar.ts` (540)                                                  | Extension                                                                              |
| Accessibility mirror and announcements                                                      | `dom/accessibility.ts` (466)                                              | Extension, in the default preset                                                       |
| Clipboard policy and copy commands                                                          | `dom/clipboard.ts` (87)                                                   | Extension; core keeps paste encoding and the OSC 52 request contract                   |
| Hotkey matching (TanStack)                                                                  | `dom/hotkeys.ts` (135)                                                    | Extension; core keeps a claim/pass key hook (Plan 205 retargets it)                    |
| Saved viewport painting                                                                     | `dom/viewport.ts` (341)                                                   | Extension                                                                              |
| HTML frame export                                                                           | `render/dom/html.ts`                                                      | Extension entry point (the site's first-frame build uses it)                           |
| Native config resolver                                                                      | `src/config-resolver/`                                                    | Already a separate entry point                                                         |
| Line editor                                                                                 | `site/src/demos/shell.ts` (~250, site only)                               | First extension                                                                        |

Platform (`apps/web/src/features/terminal/`) is the only consumer. It relies by default on fit,
pointer selection, the scrollbar and the fallback chain, and explicitly on links
(`hooks/use-links.ts`), saved viewport (`components/saved-viewport.tsx`), selection commands and
appearance updates.

House style to match: the Editor's plugins attach through a small typed context and return
disposables (`editor/packages/editor/src/plugins.ts`, `createPlugin.ts`); capabilities are either
single-owner or multi-provider (`editor/src/editor/Editor.ts`). The terminal takes that shape
without the Editor's composition machinery.

## Native custom OSC pin prerequisite

Status: **Approved. Native prerequisite integrated with the landed lifecycle contracts.**

The prerequisite preserves the actual main package and lockfile versions and carries its own
`ghostty-webgpu` patch changeset. Integration includes the landed #494 squash
`fffe237f9fdbf020647e3bb64e19fad8c1bffc16`, preserving its attachment lifetime and typed API
contracts. Native build inputs and WASM bytes match the approved native checkpoint; resolver
records use the current input closure. Public X6 remains failed/held, and full Phase 0 is pending.

- [x] Build the official introducing revision
      `7b11f3dca034d8d24369ad3856afe57946d7902a`, parent
      `ed350cbb4be3523e66016ceecd3be92b61334755`, after the merged Zig-only frame change
      `81b09d4b0dff5f5f39a54df0320a9bdf770572df`. No upstream patch or fork is used.
      The smallest proven candidate builds with Zig 0.16.0 without production ABI adaptation.
- [x] Regenerate the checked-in WASM with `bun run build:wasm`. Its generated
      `ghostty-webgpu/ghostty-vt.provenance.json` records the official source tree, Git archive and
      codeload archive digests, compiler executable, build-input hashes and artifact hashes.
      Rebuilding preserves the bridge byte-for-byte and keeps the frame ABI unchanged.
- [x] Observe native unknown OSC callbacks through real writes. Portable tests install a
      test-only native function-table callback, copy borrowed content before returning, and cover
      split chunks, BEL, split ST, truncation, CAN and SUB cancellation. Native ST notification
      occurs at ESC; the following backslash completes the escape without a second callback.
      Callback code never reenters `vt_write` on the same terminal.
- [x] Count native allocations through a test allocator. Capture defaults to zero. A callback
      with the default limit captures nothing and allocates nothing; the 2048-byte OSC path also
      allocates nothing. A larger capture provides the allocating positive control.
- [x] Preserve recognized OSC title, hyperlink and color behavior, including malformed
      core-owned numbers. OSC 52 stays denied by default and write-only when accepted; read queries
      produce no clipboard reply and no browser read callback or grant is added.
- [x] Preserve paired native mode 2027 widths, enabled/disabled: woman-technologist 2/4,
      CJK 4/4, combining accent 1/1, heart plus variation selector 2/1. Cell content, damage and
      cursor tests use the real checked-in native artifacts. The old pin reports zero custom OSC
      callbacks and the new pin reports both BEL and ST; the APC positive control works on both.
- [x] Add portable unit/provenance gates to `test:unit`, which runs in the Libraries CI job and
      the standalone package verification. The test callback and allocator remain internal tests.
- [x] Reconcile with landed predecessors #475, #477 and #494, preserve actual main release
      metadata, add a patch changeset and regenerate resolver records for the changed VT pin input.
      The native resolver keeps its own upstream pin and excludes package version metadata.
- [ ] Merge the native prerequisite after independent integration review.
- [ ] Activate host extensions and deliver subscriptions across both execution entries.
- [ ] Complete X1–X7 and the full Phase 0 done-when. This prerequisite claims native correctness
      only, with no hardware timing, worker synchronous interception or worker query-reply claim.

## Phase 0: the extension contract and core hooks

An extension is a value with a name and a `setup` function. `setup` runs once per terminal it
attaches to, keeps its state in its closure, and returns what it plugs into plus an optional API
for the host.

```ts
interface Extension<Api = void> {
  readonly name: string
  setup(scope: ExtensionScope): Contributions<Api>
}

interface HookContributions {
  readonly input?: (event: TerminalInputEvent) => 'claim' | 'pass'
  readonly events?: Partial<TerminalEventHandlers> // resize, frame, title, bell, prompt, cwd, …
  readonly osc?: Readonly<Record<number, OscObserver>>
  readonly links?: LinkProvider
  readonly commands?: Readonly<Record<string, TerminalCommand>>
}

type Contributions<Api = void> = HookContributions &
  ([Api] extends [void] ? { readonly api?: Api } : { readonly api: Api })

// A host lists extensions up front; arrays are presets and flatten in order.
const terminal = await Terminal.create({ extensions: [browserPreset(), links(fileLinks)] })

// Or attaches one later and gets back its typed API.
const line = terminal.use(readline({ history }))
const text = await line.api.read({ prompt: '$ ', signal })
line.dispose()
```

A minimal extension:

```ts
const bellLog: Extension = {
  name: 'bell-log',
  setup: () => ({ events: { bell: () => console.log('bell') } }),
}
```

Rules, all of them:

1. One lifecycle: `setup` once per attachment, disposal once. Disposing the terminal disposes its
   extensions in reverse order.
2. Arrays are presets. Order is the order listed, then the order of later `use` calls. For input,
   the first extension that claims an event wins.
3. Core sets the combine rule per contribution: `input` is first-claim-wins, `events` broadcast,
   `osc` is one handler per number (a second claim is rejected at attach time), `links` are ordered
   providers with core resolving the hit, a renderer is single-owner.
4. No dependency injection. An extension that needs another receives its API from the host.
   `name` is for diagnostics only.
5. Cleanup is automatic. Contributions are removed when the extension detaches, and
   `scope.signal` aborts on dispose, so `addEventListener(..., { signal })`, `fetch` and observers
   built on it clean up by themselves; `scope.own(cleanup)` covers the rest (native handles). If
   `setup` throws, everything it registered is undone and the error reaches the host's `error` event.
6. `terminal.use` returns `{ api, dispose }`. Disposing aborts the extension's pending work;
   attaching again starts fresh state.
7. One extension value may attach to many terminals, never twice to the same one.

Handler lists are compiled when the set of extensions changes, so a keystroke with no `input`
contribution costs nothing extra and `frame` handlers run only when something subscribed.

**Cost budget (owner, 2026-10-02).** Hosts may run a hundred extensions or more, so cost must not
scale with how many are installed: an extension that does not take part in an operation costs
nothing on it, and attaching many extensions stays cheap. A small cost per _interested_ extension
is acceptable; any cost per _installed_ extension on the keystroke, write or frame path is a design
bug, not a tuning task. Gates, with counters exact and timings against a same-machine control:

| Gate | Measure                                                                                             | Required                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| X1   | Calls into 1,000 extensions that contribute no `input`, per keystroke, paste and IME commit         | 0                                                                                                        |
| X2   | Calls into 1,000 extensions with no `frame` or output subscription, per write and per painted frame | 0                                                                                                        |
| X3   | Keystroke-to-PTY and write-to-paint latency with 100 and 1,000 inert extensions against none        | inside the control envelope                                                                              |
| X4   | Marginal cost per extra `input` handler that passes, 10 → 1,000 handlers                            | small and flat (linear, no per-call allocation)                                                          |
| X5   | Payload objects built for an event no extension subscribes to (frame rows, OSC payloads, geometry)  | 0                                                                                                        |
| X6   | Input/write/frame/use/dispose at 0/100/1,000; `Terminal.create` also at 1 inert attachment          | Exact steady-state independence; fixed activation plus affine attachment counts; registered timing bound |
| X7   | Memory retained per inert extension after attach                                                    | a few hundred bytes, measured                                                                            |

**X6 registration (2026-10-03).** Complete the exact primary matrix before freezing a new unified
operation driver: separately reset public use and single-handle disposal, count fresh identities
and setup calls, and inventory host/session/native-adapter extension-payload factories with
observable interested controls. One steady-state input, write, frame, attachment or handle disposal
has identical counts at 0/100/1,000 other inert attachments. Source-categorized creation counts
follow `core + I[N > 0] * K + B * N`: the N=1 activation control identifies fixed manager
activation K, while per-attachment factory/setup work B stays constant for N>=1. Lazy activation
is retained. Cold first public use is reported separately; a warmed zero-inert control may activate
and dispose one seed before resetting counters, leaving zero installed inert attachments. The
cold cost remains visible. Fresh handles and independent disposal closures remain required.
Source-expression counters do not measure realized VM/native allocations or implicit iterators.

Custom OSC native/public positive controls are a **pending separate subgate** until the #573
native prerequisite and public routing/capability land and qualify. The current public checkpoint
cannot observe that positive; other operations proceed without claiming OSC coverage. Owned
tool-only AST instrumentation may cover host/session/native-adapter sources; shared production
paths stay unchanged.

The earlier strict observed-minimum/maximum lifecycle windows remain **FAILED**, with every
upper and lower outlier retained. Their criterion and artifacts stay unchanged. Future timing
acceptance measures the installed-count contrast directly: membership of every arm in a
control-extrema range is a different quantity and can reject a faster treatment. This criterion
revision does not establish a cause for any old outlier or convert an old result to a pass.

Approved prospective protocol order: exact counters first, then a frozen unified driver and one
registered quiet-turn window. Final registration awaits the completed primary evidence and all
source/driver/launcher/native pins; the owner may tighten the 1.10 bound before that registration.

- For each steady-state non-creation operation separately, compute per-process paired median
  log ratios for 100/0 and 1,000/0. The one-sided 95% upper bootstrap ratio bound is at most 1.10
  at both counts. This bounds installed-count overhead; cold first-use activation stays separate.
- Run 40 independent Node process blocks in one quiet-turn window. Use 20,000 whole paired-vector
  bootstrap resamples and seed 286006, keeping each process's count arms together. Retain every
  block and failed operation. No optional stopping, block drops, outlier filtering or GC correction.
- The unchanged #533 driver covers combined warmed same-value attach/dispose and passing input
  at 0/1,000 only. Do not repeat it as the new qualification: the new unified driver must cover
  the required public operation matrix with its own frozen proof identity.
- Creation includes N=0/1/100/1,000 and reports
  `(T1000 - T1 - (999 / 99) * (T100 - T1)) / T0`, with a one-sided 95% upper bound at most 0.10.
  Also report `K_time = T1 - T0` with its confidence interval so activation remains visible.
  Non-positive base measurements, missing arms and harness failures stay failed or inconclusive.
- Public original-input/write/frame, separate use/dispose, fresh-identity attachment and public
  creation must be covered before the non-OSC matrix can qualify. Existing native-byte/visible-row
  diagnostics establish state correctness. No frame notification substitutes for the Plan 287
  paint oracle; compositor/hardware latency and the pending OSC subgate remain unqualified.

No new statistical window starts before final registration of the completed counter matrix,
source pins, driver/launcher, sample count and thresholds. Older accepted tooling, proof sources
and failed windows remain frozen; the prospective criterion does not reinterpret them.

Harness: a counter test in the package's browser suite and `bun run bench:renderer` workloads with
0, 100 and 1,000 inert extensions on the hardware adapter. If indexing bookkeeping grows with the
number installed, the design is revised before the phase lands.

Core hooks this phase adds, each with a test extension that uses it without private access:

- **Input.** User keys, pastes and IME commits pass through `input` contributions before encoding.
  `onData` today mixes user input with protocol replies (`term/session.ts:1562–1617`); split them
  so replies never reach an input handler.
- **Live geometry.** Authoritative grid size, cursor position and cell metrics from the terminal
  owner. The main-thread entry returns values; the worker entry returns Promises. Rendering and
  input placement use the explicit last-submitted frame summary.
- **Cell width.** `terminal.measure(text)` returns libghostty-vt's cell width for plain text,
  honoring live mode 2027. Extensions await its value or Promise. Cluster segmentation and widths
  come from the native Unicode exports. Measurement batching must let a line editor compute
  wrapping in one owner request.
- **Output.** `terminal.write` stays the only output path; extensions coordinate output through
  their own API (the line editor's `printAbove`), never by wrapping `write`.

Done when: test extensions claim input, read geometry, measure `👩‍💻` and CJK text, register an
OSC handler and a duplicate (rejected), and dispose cleanly on terminal dispose and on their own;
a throwing `setup` leaves nothing behind; gates X1–X7 pass.

### Shared API agreement with Plan 287

Authoritative method families stay synchronous in the main-thread entry; the worker entry
returns Promises under the same method names. Extensions await terminal operations so their code
handles either result. Extension `setup`, `use`, input claims and closures stay synchronous on the
host/main thread. Presets accept nested readonly arrays. A non-void extension API is required in its
contributions, so `handle.api` preserves its declared type. Plan 287 owns the shared
`TerminalApi<Mode>` contract; the internal scope and manager use its default `sync | async`
convention. This is a type contract for the actual entries, with no execution facade.

Authoritative `measure`, geometry, `lineCount`, `readLines`, `getSelection`,
`selectionCoordinates`, `frameSnapshot`, `captureViewport` and mutations follow the entry's
sync/async contract. The explicit last-submitted `FrameSummary` supplies synchronous renderer and
input-placement geometry. Host elements, subscriptions, focus, blur and local DOM registrations
stay synchronous, including `visibleLines`, a paint-version-guarded displayed-frame read.
Inherently asynchronous host methods such as `open` retain their Promise results in both entries.
Appearance snapshots update on execution acknowledgement. Disposal invalidates the host immediately;
the worker Promise resolves after owner cleanup. Common create options remove borrowed native
runtimes, while low-level native APIs stay local.

Custom OSC contributions are **observers returning void** for native-parsed unsupported/custom
numbers. Duplicate and core-owned numbers are rejected. Subscription changes and output use an
ordered owner channel; closures stay on the host. Built-in protocols retain native ownership.
OSC 52 keeps the current denied-by-default, write-only bridge. Immutable execution policy controls
immediate acceptance; browser completion reports errors separately. Browser clipboard reads or
grants remain outside this work. Plan 287 verifies native read-query behavior before and after its
conversion.

At the pinned `c8554f28e0efe2f5595f32020371c34b25ec628f`, the unknown-sequence callback reports
APC only. Native custom OSC delivery needs an upstream-pin prerequisite after PR #470's final
recovery change merges. Plan 286 owns that prerequisite; output is never reparsed in TypeScript.
The shipped native Unicode exports already measure graphemes and codepoints. Live mode 2027
selects their interpretation: `👩‍💻` is two cells when enabled and four when disabled. The current
native default is disabled.

### Phase 0 implementation checklist

- [x] Internal lifecycle/index scaffold in `ghostty-webgpu/src/extensions/`: typed contributions,
      identity-based attachment, nested presets, transactional rollback, lazy scoped resources,
      interested-only indexes, reentrant dispatch and reverse disposal. Node tests exercise the
      manager with the real main terminal; type assertions also accept the async shared contract.
      Core supplies the reserved OSC-number set at integration.
- [ ] Public export and host activation after Plan 287's sync/async entry contracts land.
- [ ] Original key/paste/IME hooks before encoding, with protocol replies bypassing arbitration.
- [ ] Authoritative geometry and mode-aware native measurement with a batched wrapping contract.
- [ ] Native custom OSC prerequisite, subscription delivery and observer tests in both entries.
- [ ] X1–X7 full gates. Scaffold tests count 100/1,000 inert attachments and 10/100/1,000 interested
      handlers, but these are internal structural tests. Browser input/output/frame counters,
      hardware control envelopes, native payload-allocation counters and retained-memory proof remain
      pending. No browser, hardware timing or memory gate is claimed by the scaffold.
- [ ] Phase 0 done-when. The internal scaffold bumps the package patch version and regenerates
      native resolver provenance; it adds no root export, consumer activation or deployment.

## Phase 1: the line editor

A separate package beside the core (name decided with the owner; working name
`ghostty-webgpu-line-editor`) that turns a terminal into a local prompt for a host that has no PTY,
like the site's just-bash Shell.

```ts
const editor = terminal.use(readline({ history, complete, isComplete }))
const line = await editor.api.read({ prompt: 'ghost:~$ ', signal }) // resolves on Enter
editor.api.printAbove('output that arrived while the user typed\n')
```

- Model, keymap and rendering are separate modules. The model is the line as grapheme clusters;
  rendering computes cells with `terminal.measure`, handles prompts with escape sequences, wraps
  across rows and redraws only from the first changed cell.
- Editing: printable input and paste, Backspace/Delete, Left/Right, Home/End, Ctrl+A/E/B/F,
  Alt+B/F and Ctrl+Left/Right by word, Ctrl+W/U/K/Y (kill and yank), Ctrl+L clear, Ctrl+D on an
  empty line ends input, Up/Down history, Ctrl+R reverse search.
- Ctrl+C prints `^C`, clears the line and resolves `read()` with an interrupt result, so the shell
  decides what it means. `read({ signal })` aborts cleanly; a second `read()` while one is
  pending rejects.
- History: bounded, in memory by default; persistence is the host's choice through a small store
  interface, never a shared `localStorage` key.
- Completion: `complete(line, cursor) → Promise<candidates>`; one candidate inserts it, several
  insert their common prefix, a second Tab lists them below the line. Stale results from an
  earlier keystroke are dropped.
- Multi-line: `isComplete(text)` decides whether Enter submits or continues on a secondary prompt.
- Output: `printAbove(text)` clears the edit line, writes the text, and repaints prompt and line
  where they were; while no `read()` is pending it just writes.
- The site's Shell tab replaces its hand-written editor (`site/src/demos/shell.ts`) with this
  extension, completion from just-bash's command list and the in-memory filesystem, and `bench`
  output through `printAbove`.
- Done when: unit tests cover the model and keymap; browser tests type, edit mid-line, complete,
  search history, paste multi-line text, press Ctrl+C and resize while editing, with CJK, emoji
  ZWJ sequences and a colored prompt; the site's Shell does all of it on a phone and a desktop.

## Phase 2: move the misplaced features out

One extension per step, each its own PR. Each step updates Platform's terminal mount to load the
extension and deletes the core code and options it replaces (no shims; greenfield rule).

1. Links: web links, OSC 8 and host link providers.
2. Fit: automatic sizing to the host element. Core keeps font measurement and the atomic geometry
   commit (font, grid, padding, insets, DPR); the extension owns observers and policy.
3. Scrollbar, contributing its width to geometry through a core inset hook.
4. Accessibility: frame mirror, cursor status and announcements.
5. Clipboard and hotkeys: browser copy policy and the TanStack matcher leave core; core keeps the
   claim/pass key hook and the OSC 52 request contract.
6. Saved viewport and HTML export become extension entry points; the site's first-frame build
   imports HTML export from there.

For each step: the extension uses only public hooks (a hook it needs lands in core first), the
package's browser tests and Platform's terminal scenarios pass, `bun run bench:renderer` shows no
regression on the hardware adapter for anything near the frame path, and gates X1–X7 still pass.

Ship a `defaultExtensions()` preset (fit, scrollbar, links, accessibility, clipboard) for hosts
that want today's behavior in one call; Platform and the site load what they use explicitly.

## Phase 3: native Ghostty features as extensions

Each needs a core hook that exposes semantics libghostty-vt already has; the extension adds the
behavior on top. In order of value to web users:

1. **Find.** Search the screen and scrollback, highlight matches, step through them. Needs
   cell-range results and decorations in core: port the upstream search API forward from our pin
   (or bump the pin) rather than searching text in TypeScript.
2. **Shell navigation.** Jump to the previous or next prompt, select or copy a command's output,
   mark failed commands, using OSC 133 marks. Needs prompt-mark events and the
   select-output operation exposed by core.
3. **Paste protection.** Confirm multi-line or unsafe pastes before they reach the shell.
4. **Progress.** OSC 9;4 states as events a host can show as a bar or spinner.
5. **Notifications and bell.** OSC 9/777 and BEL as browser notifications or a visual bell, with
   the host deciding permission and rate.
6. **Inspector.** A diagnostics panel for cells, modes and a bounded recording of input and output,
   for playgrounds and bug reports.
7. **Themes.** Load Ghostty theme files and follow the system light/dark setting.

Core also gains typed terminal commands (scroll, select, copy, clear, jump to prompt) that hotkeys,
menus and palettes call, separate from any key binding. Kitty graphics waits on upstream support
for our wasm target; it is out of scope here.

## Phase 4: lazy renderer backends

WebGL, Canvas2D and DOM backends become modules the core fallback coordinator imports only when
the chain reaches them. Core keeps the coordinator, abort handling, state replay and canvas
replacement; WebGPU stays in core. Done when a WebGPU visitor downloads none of the fallback
code (measured bundle size before and after in this plan) and the fallback, context-loss and
no-Canvas tests still pass.

## Phase 5: an ecosystem others can join

- `docs/extensions.md`: the contract, the hooks, lifecycle rules, and a minimal example.
- An extension template folder with its own tests.
- The site lists the extensions with one line each.
- Candidate next extensions, not scheduled: serialize, attach (WebSocket PTY), ligatures, a
  resize overlay, a damage recorder, images once upstream supports our target.

## Order and gates

0 → 1 → 2 (steps in order, each its own PR) → 3 → 4 → 5. Phase 1 can merge before Phase 2
starts; Phase 3 items can start once Phase 0 lands.
Every PR gets an independent review before merge. Phases 0–2 ship with patch bumps and
matching site/Platform consumers. Standalone package publication keeps the applicable
[Plan 207](207-one-repo-with-mirrors.md) installation and publication gates.

## Owner questions

- Package names: scoped (`@ghostty-webgpu/line-editor`, needs the npm scope) or flat
  (`ghostty-webgpu-line-editor`).

## Done when

- `Terminal.create({ extensions })`, `terminal.use` and the Phase 0 hooks are public and
  documented.
- The site's Shell runs on the line editor extension and edits like bash on phone and desktop.
- Links, fit, scrollbar, accessibility, clipboard, hotkeys, saved viewport and HTML export live
  outside core, Platform loads them explicitly, and core no longer contains them.
- Find and shell navigation ship as extensions on core semantics.
- Fallback renderers load only when needed.
