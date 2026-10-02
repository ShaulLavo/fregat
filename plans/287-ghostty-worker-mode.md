# Plan 287: ghostty-webgpu worker mode

## Status and authorization

- Status: APPROVED 2026-10-02 by the owner: "I do like the worker idea. And I do think we should add
  it as a mode … either import the regular one that runs on the main thread or you import the
  offscreen canvas version, which [Fregat] will end up using."
- Owns: `ghostty-webgpu/` (a new worker entry point) and Platform's terminal feature
  (`apps/web/src/features/terminal/`), which switches to it.
- Order: starts after Plan 283's Zig frame full move, so the worker carries the new pipeline and
  nothing is ported twice. Coordinates its public API with Plan 286's extension model.
- Versions: agents bump patch only; the release that adds the entry point waits for the owner's
  approval of a minor bump.

## Outcome

A host picks where the terminal runs by what it imports:

- `ghostty-webgpu`: today's terminal on the main thread.
- `ghostty-webgpu/worker`: the same `Terminal` API, with Ghostty, the Zig frame builder, glyph
  rasterization and WebGPU running in a dedicated worker on an `OffscreenCanvas`. Output never
  runs on the page's main thread.

Fregat uses the worker entry. Both entries pass the same test suite.

## Decisions

- Messages, not shared memory. An earlier Fregat experiment with `SharedArrayBuffer` ended at the
  same speed as ordinary worker messages and was removed; WebAssembly adds nothing here because the
  main thread already reads wasm memory in place. No cross-origin isolation requirement.
- The worker owns the terminal state. The main-thread object is a thin host: the DOM element, input
  events, IME, focus, accessibility, scrollbar and the public API. It keeps a per-frame summary the
  worker posts after each frame (cursor, selection, visible row text, scroll state) for synchronous
  reads such as IME placement and hit-testing.
- Copy: Ctrl/Cmd+C asks the worker for the selected text and writes it with the async clipboard API
  inside the keydown's activation, so large selections are never pushed every frame.
- PTY: the host can hand the worker a transferable port or socket so output bytes go straight to
  the worker; a host that writes through the main-thread API still works.
- Glyphs rasterize in the worker on an `OffscreenCanvas` 2D context; host fonts load through the
  worker's `FontFaceSet`.
- No silent fallback: where `OffscreenCanvas` or WebGPU-in-worker is missing, the worker entry fails
  with a structured error and the host chooses the main-thread entry.

## Phases

1. Worker entry with output, rendering, resize, focus and keyboard input; the main-thread host and
   message protocol; the existing unit and browser suites run against both entries.
2. Selection, copy, links, IME, accessibility and scrollback through the per-frame summary and
   on-demand requests.
3. Plan 286 extensions run in both entries; the extension API states which side each hook runs on.
4. Platform's terminal feature switches to the worker entry; the site offers both.

## Done when

- Both entries pass the same suites, and Platform runs the worker entry.
- Paired `bench:compare` on omarchy, worker vs main-thread entry: input and write latency do not
  regress by more than one renderer frame at p95, and main-thread CPU during output drops to the
  host's own work.
- A long-output scenario shows the page's main thread free while a terminal streams.
