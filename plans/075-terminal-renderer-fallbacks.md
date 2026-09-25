# Plan 075: Say which renderer the terminal is using

## Status

- State: PROPOSED — rewritten 2026-09-25 down to one unit (U1).
- Priority: P3. Effort: S. Risk: LOW; it reads a value and shows it.
- Baseline: Platform `eb18c159`, `ghostty-webgpu` `9fc9bde`.

The fallback ladder this plan used to ask for already exists. `ghostty-webgpu` `d9300af`
(2026-09-05) and its follow-ups `4f7801e`, `2dd15af` and `9a75060` added
`createCompatibleTerminalRenderer` in `src/render/selector.ts`: it probes WebGPU, then WebGL2, then
Canvas2D, and every tier is benchmarked. `dist/dom/terminal.js` uses the selector by default, so the
panel already degrades instead of failing. What is missing is Platform knowing which tier it got.

## U1: log the tier and show it

The terminal exposes its tier as `terminal.diagnostics.rendererBackend`
(`'canvas2d' | 'webgl2' | 'webgpu' | undefined`, `ghostty-webgpu` `src/dom/types.ts`). Platform
never reads it; `apps/web/src/features/terminal` has no reference to it.

1. When a terminal mounts (`features/terminal/components/panel.tsx`, through its mount state),
   read `rendererBackend` once the renderer is ready. The web app logs no terminal mount event
   today, so add one: `area: 'terminal'`, `action: 'terminal.mount'`, with `rendererBackend` as a
   field. One event per mount, at info.
2. Show the tier in the terminal menu (`features/terminal/hooks/use-menu.ts`) as a disabled,
   informational row, in mono: "Renderer: WebGPU", "WebGL2" or "Canvas". `undefined` reads
   "Renderer: starting".

## Verification

- A `dom` test for the menu row, one per tier and one for `undefined`.
- `agent:browser look` on the terminal with the menu open; read the screenshot back.
- A Chromium run with WebGPU disabled (`--disable-features=WebGPU`) shows WebGL2 in the menu and in
  `bun run logs`.

## Not in this plan

- A downgrade reason from `ghostty-webgpu` (why it fell back). Small, in that repo, not needed for U1.
- A setting that forces a tier. It would select execution, so it would be `application` scope, and
  nobody has asked for it.
- A performance floor per tier. The measurements live in `ghostty-webgpu` `9a75060`.
