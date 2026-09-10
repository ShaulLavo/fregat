# ghostty-webgpu — project brief (Phases 1–6)

Strategy document per `plans/README.md`: this is the architecture and phase brief for the
`ghostty-webgpu` project. It is **not executable**. Phases 0–3 are complete and their results are
recorded below; completed executable plans are archived in Git history. Phase 4 needs a new numbered
plan, with current drift checks, commands, and step gates, before execution. Evidence below retains
the phase-local package and upstream identities against which it was verified.

## Goal and non-goals

**Goal:** a standalone project `ghostty-webgpu` — upstream libghostty-vt compiled to wasm driving
a damage-scheduled WebGPU renderer modeled on Ghostty's native Metal renderer. It lives in **its
own repository** as a sibling of platform (`/Users/shaul/Desktop/D/ghostty-webgpu`), Editor-style:
platform consumes it via root `overrides` + `bun link:`, compiled against its `dist`. Publishable
to npm on its own (unscoped name `ghostty-webgpu`).

**Non-goals (explicit):**

- No WebGL2/Canvas fallback renderer inside the package. The rollout fallback is platform's
  existing `ghostty-web` path behind a setting, kept **through Phase 5 plus a parity soak** —
  Kitty graphics and the protocol audit land in Phase 5, so removal before that would strand
  features. Removal is Phase 6's first gate. _Exception clause:_ if Plan 054's S2 finds WebGPU
  unusable in CI or the shipping CEF desktop build, this non-goal is rewritten as part of the
  go/no-go, not silently violated.
- No tmux-style multiplexing, no search — native Ghostty doesn't own these either.
- Custom user shaders (Ghostty's GLSL cursor/background shaders) are out of scope for all phases
  in this document; WebGPU speaks WGSL and translation is its own project.

## Load-bearing facts from the reference read

Verified at Plan 054's pins; re-verify in each phase plan's drift check:

1. **Upstream libghostty-vt builds to wasm unpatched.** ghostling links it via `zig build -Demit-lib-vt=true`
   (CMake `FetchContent`, no patch step); the wasm target is
   `zig build -Demit-lib-vt=true -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall`
   (Zig 0.16.0+, ~20s).
   coder/ghostty-web still applies a patch that predates the official `ghostty_terminal_*` API.
2. **The C API is callback-shaped, across three ABI shapes** (`references/ghostling/main.c:1324`
   installs `userdata`, `write_pty`, `size`, `device_attributes`, `xtversion`, `title_changed`,
   `color_scheme`; PNG decode is **process-global** via
   `ghostty_sys_set(GHOSTTY_SYS_OPT_DECODE_PNG, …)` at `main.c:1273`, required before any
   terminal exists — a real constraint for a per-tab wasm design):
   - `void (terminal, userdata, ptr, len)` — `write_pty`; JS reads wasm memory. Easiest.
   - `bool` with an out-struct pointer — `size`, `device_attributes`; JS writes versioned
     `GHOSTTY_INIT_SIZED` C structs at the correct wasm32 layout.
   - **struct returned by value** — `effect_xtversion` returns `GhosttyString`
     (`main.c:1154`); under the wasm C ABI this lowers to a hidden sret pointer argument, so a
     JS funcref must match the lowered signature exactly. Most likely to break.
     Whether bell / OSC 52 clipboard callbacks exist must be read from `include/ghostty/vt/
terminal.h`, not inferred from ghostling (it installs neither).
3. **The render API has the damage primitives; the acknowledgement calls have a reference, the
   scheduling does not.** Global dirty and per-row dirty are independent consumer-managed flags
   (`include/ghostty/vt/render.h`). ghostling _does_ run the acknowledgement half — clears row
   dirty via `GHOSTTY_RENDER_STATE_ROW_OPTION_DIRTY` (`main.c:939`) and global dirty via
   `GHOSTTY_RENDER_STATE_OPTION_DIRTY` (`main.c:1015`) — those are the exact call shapes to
   crib. But it never _gates_ on them: its raylib loop updates render state and draws every row
   every frame (`main.c:1542`, `:837`). The damage _scheduler_ below is ours.
4. **Kitty graphics implies layered drawing.** ghostling renders three image layers relative to
   the cell grid: below backgrounds, below text, above text (`main.c:827` area). "Two instanced
   draw calls" is the **text-only** fast path, not a renderer invariant.
5. **ghostling is not a transparency reference either:** it hardcodes window background alpha to
   255 (`main.c:1550`). The transparency contract below is derived from platform's requirements,
   not from either reference.
6. **ghostty-web's TS layer remains prior art** for web-only concerns (fit sizing, link
   providers, selection UX, IME, bench scenarios) and its renderer's dirty-row bookkeeping
   (`renderer.ts:424`) is worth reading before writing ours. Steal designs, not code.

## Architecture

Five layers, one package. Only `dom/` and `render/` may touch browser APIs; `core/` and `term/`
run under plain `vitest` in Node.

```
ghostty-webgpu/            (own repo, sibling of platform and Editor)
  src/
    core/     wasm loading + typed bindings over the libghostty-vt C ABI,
              including the callback/effects bridge proven in Plan 054 S1
              and the process-global sys interface (PNG decode). Zero DOM.
    term/     Terminal orchestrator: write() → vt_write, resize, viewport
              scroll, selection model, render-state ownership, OSC 8 links,
              title/color-scheme/size effects surfaced as events.
    render/   WebGPU renderer (spec below).
    dom/      host wiring: keyboard/IME → key encoder, mouse → mouse encoder,
              clipboard, ResizeObserver fit, scrollbar UI from
              GHOSTTY_TERMINAL_DATA_SCROLLBAR, accessibility mirror.
  ghostty-vt.wasm          committed artifact (consumers never need Zig)
  scripts/build-wasm.ts    pinned upstream rev; unpatched `zig build -Demit-lib-vt=true`
  AGENTS.md                own instructions — the repo does NOT inherit
                           platform's CLAUDE.md; must carry the never-nester
                           control-flow rules and the comments policy.
```

### Render scheduling (the actual algorithm)

State: `framePending: boolean`, `blinkTimer` (armed only when cursor-blink is on AND focused AND
document visible), `needsFullRebuild` (resize, theme, scroll-position change, atlas generation
bump, device restore).

1. Wake sources — vt bytes written, blink tick, selection change, scroll, resize, focus/theme
   change, atlas/device invalidation — call `schedule()`. If `framePending`, they return (damage
   coalescing: at most one pending frame); else set it and `requestAnimationFrame(frame)`.
2. `frame()`: clear `framePending`; call `ghostty_render_state_update`; read global dirty. If
   nothing is dirty and no overlay (cursor/selection/scrollbar fade) changed, submit nothing.
3. Rebuild instance data only for rows whose dirty flag is set (or all rows when
   `needsFullRebuild`); after painting, clear each row's dirty flag
   (`ROW_OPTION_DIRTY` ← false) and reset the global dirty flag (`OPTION_DIRTY` ← false) — the
   acknowledgement protocol, same call shapes as ghostling `main.c:939`/`:1015`.
4. No standing loop exists anywhere: an idle, unfocused terminal has zero armed timers and zero
   rAF callbacks. Asserted by test, with blink-aware gates (Phase 2 gates below).

### Renderer spec

- **Text fast path: two instanced draws** (bg-cell rects, then glyph quads from the atlas),
  per-cell instances in a storage buffer, `writeBuffer` deltas per dirty row. Kitty graphics
  (Phase 5) inserts its three textured-quad layers around these; the pass count is whatever
  z-order requires that frame.
- **Glyph atlas with generation tracking.** Shelf-packed pages (grayscale + color), rasterized
  via OffscreenCanvas 2D scratch. Every atlas page carries a generation; instance records carry
  the generation they were built against. **Eviction bumps the generation and marks every row
  whose instances reference the evicted page for rebuild — LRU eviction without invalidation
  corrupts clean rows.** GPU device loss reuses the same path: bump all generations,
  `needsFullRebuild`, re-upload. The CJK/emoji eviction stress test belongs to the phase that
  introduces eviction (Phase 2), not later.
- **Transparency contract — two color systems, kept apart.** `GhosttyColorRgb` has no alpha; the
  render-state background RGB is kept for _terminal color semantics_ (inverse video, minimum
  contrast, palette defaults). _Canvas compositing_ is separate: default (unset-background) cells
  are cleared to alpha 0; only cells with an explicit background paint opaquely; canvas context
  `alphaMode: 'premultiplied'` (which governs blending semantics only — it does not make an
  opaque clear transparent). Platform's pane already paints the ground and the terminal section
  deliberately paints none (`packages/ui/src/styles/globals.css:256`, a parse contract for
  ghostty's color reader — plain colors only, no `color-mix()`). Gates: a GPU readback assertion
  that empty-cell alpha is 0, plus a real workbench compositing test over a translucent pane
  (memory `terminal-ghostty-transparency` is the bug this prevents).
- **Parity with platform's shipped patch.** Platform patches the vendored dep
  (`patches/ghostty-web@0.4.0.patch`): transparent-background `clearRect` behavior and the
  `outline` cursor style. Both are product requirements ghostty-webgpu must reproduce, and
  Phase 6's deletion must remove `patchedDependencies` and the patch file, not just the import.
- **Decorations in-shader:** cursor styles (incl. `outline`), underline styles incl. undercurl,
  strikethrough, minimum-contrast — per-instance flags in the fragment shader.
- **Main thread first;** `render/` stays free of direct DOM event access so it can move behind
  `transferControlToOffscreen` later without redesign.

### Font pipeline (two stages, deliberate)

- Phase 1–4: per-cell grapheme clusters via `fillText` into the atlas — today's fidelity, no
  cross-cell ligatures. Atlas keys on (font, size, cluster/glyph-id) so the upgrade is additive.
- Phase 6 (parity): HarfBuzz-wasm shaping; glyph outlines via HarfBuzz draw API → `Path2D` →
  same atlas keyed by glyph id. Needs font _bytes_: bundled default (JetBrains Mono, as
  ghostling), user font URLs, `queryLocalFonts()` where granted; browser-shaped `fillText`
  remains the fallback for CSS-name-only fonts.

## The platform seam (it is NOT import-level)

Platform consumes ghostty-web across the terminal feature, not just `panel.tsx`. Known surface at
platform `2b503172` — but the Phase 4 plan must **generate the contract from a grep of the
feature**, not from this prose:

- `panel.tsx` — `new Terminal({allowTransparency, cursorBlink, cursorStyle, fontFamily,
fontSize, scrollback, smoothScrollDuration, theme})`, mutable `options` writes (cursor style
  patching incl. the patched `outline` style, focus handover), `loadAddon(FitAddon)` + `fit()` +
  `observeResize()`, `open()`, `write`/`writeln`, `onData`, `onResize`, dispose lifecycle.
- `hooks/use-links.ts` — `ILink`, `registerLinkProvider`, `buffer.active.getLine()` reads.
- `utils/commands.ts` + `utils/capture.ts` — `getSelection()`, `getSelectionPosition()`,
  `selectAll()`, `getScrollbackLength()`, `clear()`, `reset()`, `scrollToTop()`,
  `scrollToBottom()`, `cols`/`rows`, paste/input, scrollback capture.
- `utils/theme.ts` — `ITheme` type.
- Build config: `optimizeDeps.exclude: ['ghostty-web']` in `apps/web/vite.config.ts:27`; the new
  package needs the same exclusion (memory: without it, dep edits look like no-ops until a Vite
  restart).

Consequence: define a **platform-local structural terminal contract** (a type in the terminal
feature covering exactly the grep-generated surface) with **two adapters** — one over ghostty-web,
one over ghostty-webgpu. The contract is also the checklist for what `term/`+`dom/` must
implement.

**Renderer switching semantics (decided):** flipping the setting recreates the terminal view and
reconnects to the same server-side PTY session (sessions already survive socket reconnects); no
live in-place swap, no app restart. Settings key `terminal.integrated.renderer` (matching the
existing `terminal.integrated.*` namespace, `packages/contracts/src/settings/keys.ts:143`),
**application scope** — the honest justification: a workspace file ships inside a cloned
repository, and a cloned repo must not be able to force an experimental GPU path onto the host.
Registered and wired in the same pass.

## Phases

1. **Repo + core bindings — COMPLETE at `ghostty-webgpu` `29fd3d4`.** Sibling repo bootstrap (contracts-style tooling, own AGENTS.md with
   never-nester + comments rules, MIT, dist-first build since platform compiles against `dist` —
   memories `editor-perf-and-linking`, `editor-dist-stale-after-pull`); committed wasm; `core/`
   bindings incl. the S1 callback bridge and sys interface; node tests: VT corpora in,
   render-state cells asserted, dirty acknowledgement protocol correct. Platform CI provisioning
   gains the sibling repo (memory `ci-pipeline-environment`) when Phase 4 lands, not before.
2. **Damage-scheduled WebGPU renderer — COMPLETE (2026-08-22).** The scheduler + text fast path + atlas with
   generations/eviction (stress test included) + transparency contract + patch-parity items
   (`outline` cursor, transparent clear) + device-loss recovery.
   Gates: unfocused or blink-off idle → **zero** submitted frames over 10s (counter test);
   focused blinking idle → exactly one frame per blink transition, no standing rAF; damage
   coalescing → at most one pending frame under write storms; empty-cell alpha readback = 0;
   scroll throughput ≥ the Plan 054 S4 damage-scheduled-canvas baseline.
3. **DOM/input — COMPLETE (2026-08-28).** Native keyboard and mouse encoding, IME composition,
   clipboard and bracketed paste, focus reporting, fit/resize, selection, links, scrollbar, and the
   accessibility mirror are complete. The headed macOS hardware/operator gate passed for held-key
   lifecycle, modifiers, OS-owned shortcuts, CJK/emoji/dead-key input, exact clipboard insertion,
   idle rendering, and VoiceOver.
4. **Platform adapter + dual-renderer rollout.** Grep-generated structural contract + two
   adapters + `terminal.integrated.renderer` + recreate-and-reconnect switching + Vite
   `optimizeDeps` exclusion. Gate: daily-drivable; before/after GPU numbers recorded against
   S4/S5 baselines, including the CEF desktop build.
5. **Full-Ghostty surface.** Kitty graphics (three image layers, deferred texture destruction
   after `onSubmittedWorkDone`, process-global PNG decode decision from S1), scrollbar polish,
   protocol audit vs upstream docs. Gate: icat works; audit checklist complete. Then the parity
   soak starts.
6. **Shaping parity + release.** HarfBuzz shaping/ligatures/emoji pages/fallback chain; delete
   the ghostty-web path — dependency, `patchedDependencies` entry, and
   `patches/ghostty-web@0.4.0.patch` — after the soak; README + demo, CI, npm publish,
   upstream-rev bump script. Gate: fresh Vite app outside the monorepo runs the published
   package.

## Risks

- ~~The callback bridge (Plan 054 S1) is the load-bearing unknown~~ **Resolved — see Phase 0
  results.** All three ABI shapes work via Zig trampolines in the exported funcref table.
- **WebGPU availability:** verified working in Playwright headless CI (SwiftShader software
  adapter — fine for correctness tests, not perf) and in the shipping Electrobun CEF desktop on
  a **hardware Metal 3 adapter** (opaque window). `WINDOW_TRANSPARENT: true` OSR mode remains
  **untested** — GPU canvas + OSR readback is exactly where WebGPU gets shaky (memory
  `wallpaper-video-idle-gpu`); must be measured before any transparent-desktop work. WKWebView
  needs Safari 26+. The dual-renderer rollout keeps canvas until we choose.
- **Upstream API churn:** libghostty-vt is young; bump pins only when ghostling's moves.
- **Ligatures across cells** are known-hard; deferred to Phase 6 with the atlas keyed to survive.
- **Accessibility:** the `dom/` mirror ships with Phase 3 input work, not as polish.

## Phase 0 results (2026-08-22) — decision: GO

Plan 054 executed; spike workspace: `/Users/shaul/Desktop/D/ghostty-webgpu-spike` (disposable).
S1/S2 probe results were re-run and verified independently of the original spike session; S4/S5
numbers below were measured fresh with the spike's harness after a runner fix (the bench page is
now route-fulfilled on the dev-server origin instead of `setContent` over the live app, whose
router navigated the main frame mid-run and wiped the harness).

**S1 — callback bridge: PASS (all three ABI shapes).** Unpatched
`zig build -Demit-lib-vt=true -Dtarget=wasm32-freestanding` at the ghostling pin (Zig 0.16.0); bridge
mechanism: **standalone Zig wasm trampolines inserted into the exported funcref table**
(`bridge.zig`/`bridge.wasm` in the spike). Verified in Node AND browser (zero errors):
DA1 reply `\x1b[?62;1;6;22c` received by JS (ptr+len `write_pty` + out-struct
`device_attributes`), size report `\x1b[8;24;80t` (out-struct), xtversion round-trip (the
sret-lowered struct-by-value shape — the risky one), title-changed fires, PNG decode returns
1×1 RGBA via the process-global sys hook (Kitty file/shared-mem media are compiled out for
wasm32-freestanding — image transfer is direct-medium only). Damage acknowledgement protocol
verified (dirty 2 → ack 0 → targeted write re-dirties 1 row). Symbol diff: 62/62 consumed
symbols exported (198 total); the two "missing" names were grep artifacts (`…set_utf8`
truncated by the `[a-z_]+` pattern; `ghostty_mods` is ghostling's own helper + a type name).
**Bell and OSC 52 exist as `GHOSTTY_TERMINAL_OPT_BELL` / `OPT_CLIPBOARD_WRITE`** (39 OPT
constants total — also progress reports, desktop notifications, PWD, terminfo name).

**S2 — WebGPU environments: PASS with one recorded risk.** Playwright headless Chromium 148:
device + frame submit OK with `--enable-unsafe-webgpu` (`--enable-features=Vulkan` on Linux);
adapter is **SwiftShader** (software) headless on macOS — CI is for correctness, perf needs
headed/hardware. Shipping desktop (Electrobun CEF, Chrome 147, via CDP :9222): device + frame
submit OK on **hardware `metal-3`**, opaque window. Transparent/OSR mode: untested, recorded
risk above.

**S3 — upstream packaging: none exists (2026-08-22).** npm `ghostty-web` is coder's package
(the one platform ships); it plans to consume a native Ghostty wasm distribution "once
available". We build our own pinned artifact.
Sources: [npm ghostty-web](https://www.npmjs.com/package/ghostty-web),
[Libghostty Is Coming](https://mitchellh.com/writing/libghostty-is-coming),
[Bytes #427](https://bytes.dev/archives/427).

**S4/S5 — benchmarks.** Playwright headed Chrome-for-Testing 148, 1600×900 @ dpr 2, terminal
200×50, GPU-process CPU, 5s warmup + 30×1s samples (means; renders = calls in 30s). Canvas =
platform's installed patched `ghostty-web@0.4.0` bundle; "scheduled" = temporary dirty-gated
`startRenderLoop` (render only when dirty rows / cursor / viewport / scrollbar change; standing
rAF kept, paints skipped), restored after measurement. WebGPU floor = two instanced draws,
pre-filled atlas, hardware Metal 3.

| Scenario              | stock canvas | scheduled canvas | WebGPU floor |
| --------------------- | -----------: | ---------------: | -----------: |
| focused-blinking idle | 11.1% (1819) |         1.5% (0) |    1.2% (58) |
| unfocused idle        | 12.1% (1816) |         1.1% (0) |     0.0% (0) |
| burst output          | 24.9% (1808) |      17.8% (616) | 15.7% (1895) |
| sustained scroll      | 54.0% (1616) |     40.0% (1542) | 17.4% (1890) |

Caveats: cursor blink never armed in the canvas benches (automation window lacks OS focus), so
"focused-blinking" ≈ blink-off idle there; the WebGPU floor page armed its own blink (58
frames ≈ 2/s). Absolute numbers are not comparable to the production ~63% observation
(different browser, viewport, workload); comparisons within the table are same-machine,
same-methodology.

**K1/K2 evaluation (pre-registered in Plan 054):** K1 focused ≤5% → 1.5% PASS; K1 unfocused
≤1% → 1.1% marginal (within sampling noise of the threshold). K2 burst within 1.25× of floor →
17.8% vs 19.6% ceiling PASS; **K2 scroll → 40.0% vs 21.8% ceiling FAIL (2.3× the floor)**.
Descope required BOTH kill conditions to hold; K2 fails decisively on scroll → **the rewrite
proceeds (GO)**. Reading: damage scheduling alone recovers the idle burn (the production
complaint), but Canvas 2D remains ~2.3× the WebGPU floor under sustained scroll and ~13% worse
under burst — plus the protocol/fidelity surface (Kitty graphics, kitty keyboard, bell/OSC 52
effects) that only the rewrite reaches.

**Recommended interim mitigation (independent of the rewrite):** the dirty-gate is a ~15-line
patch to `startRenderLoop` and takes idle from ~12% to ~1% — worth upstreaming to
coder/ghostty-web (or carrying in `patches/`) so platform stops burning GPU while Phases 1–3
land. Not a substitute: scroll/burst and the protocol gaps remain.

## Phase 1 results (2026-08-22) — complete

The standalone sibling repository `/Users/shaul/Desktop/D/ghostty-webgpu` is bootstrapped and
committed at `29fd3d4`. It contains the pinned, unpatched libghostty-vt wasm artifact and Zig build
script, the standalone Zig callback bridge, typed browser-independent `core/` bindings, terminal
and render-state ownership, the process-global PNG decoder boundary, package-root wasm exports,
dist-first TypeScript output, MIT licensing, repository instructions, and CI.

`bun run verify` passes typecheck, lint, formatting, seven Node/Vitest tests, and the dist build.
The tests cover the pointer+length, out-struct, and sret callback shapes; DA1, xtversion, size, and
title round-trips; process-global PNG setup ordering; a VT corpus spanning controls, combining and
wide graphemes, cursor positioning, color, and decoration state; and global/per-row damage
acknowledgement with targeted re-damage. A direct `dist/index.js` runtime smoke test and
`npm pack --dry-run` also pass. Both committed wasm artifacts are byte-identical to the independently
verified Phase 0 artifacts.

## Phase 2 results (2026-08-22) — complete

The standalone package now exports `WebGpuTerminalRenderer`: a damage-driven, no-standing-loop
renderer over the Phase 1 `GhosttyRenderState`. It owns stable per-row instance ranges, separate
grayscale/color shelf-packed atlases with generation-safe LRU recycling, Canvas 2D glyph bitmap
caching, two instanced text draws, premultiplied-alpha compositing, shader decorations and
minimum-contrast adjustment, overlay wake sources, diagnostic counters, and tokenized GPU-device
replacement. Failed replacement acquisition remains retryable; late replacements cannot resurrect
a disposed renderer.

Focused fake-clock and real-Chromium gates prove write-storm coalescing, zero pending work when
blink is ineligible, exactly one frame per blink transition, partial dirty-row rebuilding before
damage acknowledgement, clean-frame elision, transparent empty cells, opaque explicit
backgrounds, glyph coverage, outline cursor, underline/undercurl/strikethrough/overline, inverse,
selection, invisible text, shader minimum contrast, exactly two draws, grayscale/color uploads,
CJK/emoji eviction safety, and pixel recovery on a replacement device.

**Headed hardware benchmark:** Playwright Chrome-for-Testing 148.0.7778.96 on macOS arm64, Apple
Metal 3 adapter (`vendor=apple`, `architecture=metal-3`), 1600×900 at DPR 2, terminal 200×50,
5-second warmup plus 30 one-second GPU-process CPU samples. Atlas evictions and device restores
were zero in every scenario.

| Scenario              | GPU CPU mean | GPU CPU max | frames | draws | rows rebuilt | bytes uploaded |
| --------------------- | -----------: | ----------: | -----: | ----: | -----------: | -------------: |
| focused-blinking idle |        0.56% |        0.8% |     61 |   122 |           61 |      1,561,600 |
| unfocused idle        |        0.01% |        0.3% |      0 |     0 |            0 |              0 |
| burst output          |        5.79% |        6.0% |  1,810 | 3,620 |       90,500 |  2,316,800,000 |
| sustained scroll      |        6.07% |        6.4% |  1,810 | 3,620 |       90,500 |  2,316,800,000 |

The registered sustained-scroll gate passes: production WebGPU delivered 1,810 frames versus the
scheduled-Canvas baseline's 1,542 (+17.4%), while GPU-process CPU fell from 40.0% to 6.07%. Against
the Phase 0 WebGPU floor, CPU is 65.1% lower (6.07% versus 17.4%) and the timer-cadenced frame count
is 4.2% lower (1,810 versus 1,890). The renderer therefore clears the Phase 2 correctness,
no-standing-work, throughput, and ≤40% CPU gates.

The closing `bun run verify` passes typecheck, lint, formatting, 22 Node tests, 10 real-Chromium
tests, and the dist build. `npm pack --dry-run --json` also passes and includes compiled JS/types,
`ghostty-vt.wasm`, `bridge.wasm`, README, and LICENSE. These results form the renderer baseline for
the completed Phase 3 evidence below.

## Phase 3 results (2026-08-28) — complete

The DOM/input host closeout is recorded in `ghostty-webgpu@0.1.1` commit
`50788b2c6ed4bac7dcf1578bd529f74ebc98f36b`, using Ghostty source
`c8554f28e0efe2f5595f32020371c34b25ec628f` and ABI-manifest schema `1`.
`ghostty-vt.wasm` retained SHA-256
`dfb171587bc11b6610fb95d3b583926d51287f5d6e528c45ff2aa05218608a97`; `bridge.wasm` retained
`47fae389c94f2545b2026d756256272b65f978d97feabae21b9171ad4b54b63f`.

Platform remains on registry `ghostty-webgpu@0.1.0`: its installed terminal and bridge wasm files
are byte-identical to the verified package, so Phase 3 closeout does not change Platform's
dependency pin.

The complete automated and headed-hardware operator evidence, including exact input bytes,
clipboard packet, idle counters, and VoiceOver result, is recorded in
`ghostty-webgpu/docs/phase-3-acceptance.md`. Phase 4 remains a separate planning boundary.

## Config resolver feasibility results (2026-08-29) — complete

The separate host-only config-resolver feasibility proof is complete at `ghostty-webgpu` evidence
HEAD `e9c198e073067d5415ac4224176db1eb076f5dbf`. Workflow run `33212162580`, attempt `1`, used
proof-recipe SHA-256 `40083f27ad5f925808cc48e0fdd428b4ab0515eb38dedb42b0ca2065a16e44f0`
and recorded native `PASS` rows for `darwin-arm64`, `darwin-x64`, `linux-arm64`, and `linux-x64`.
The operator accepted exact per-target package ceilings of `2097152`, `2097152`, `8388608`, and
`9437184` bytes, with total ceiling `22020096` bytes.

The stable human-readable and strict machine-readable records are
`ghostty-webgpu/docs/config-resolver-feasibility.md` and
`ghostty-webgpu/docs/config-resolver-feasibility.json`; the maintained verifier is
`ghostty-webgpu/scripts/config-resolver-proof/verify-evidence.ts`. The proof preserves
`ghostty-webgpu@0.1.1`, upstream Ghostty
`c8554f28e0efe2f5595f32020371c34b25ec628f`, ABI-manifest schema `1`, `ghostty-vt.wasm` SHA-256
`dfb171587bc11b6610fb95d3b583926d51287f5d6e528c45ff2aa05218608a97`, `bridge.wasm` SHA-256
`47fae389c94f2545b2026d756256272b65f978d97feabae21b9171ad4b54b63f`, and
`scripts/build-wasm.ts` SHA-256
`c3132eb6cf210aa841713972225a39e45658154199572df6a237d65206c85d99`. Platform therefore remains
on registry `ghostty-webgpu@0.1.0`.

Plans 066 and 067 were dropped on 2026-09-09 despite the successful proof. `ghostty-webgpu` must
never read disk. Any future file loading would belong to Platform, which would pass data to the
package. No replacement is planned. See the [decision](../PLAN.md#ghostty-appearance-integration-dropped).
