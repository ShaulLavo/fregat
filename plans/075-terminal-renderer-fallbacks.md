# Plan 075: A renderer fallback ladder for the terminal

//TODO i'm pretty sure this is note true and `ghostty-webgpu` has all the fallbacks in the world

> **Executor instructions**: Read this plan completely, then read Platform `AGENTS.md`, root
> `PLAN.md`, and the `ghostty-webgpu` repo's own conventions. This plan spans two repositories and
> the package change is not shippable on its own. Do not commit, push, create a branch, publish, or
> open a PR without explicit operator approval.

## Status

- **State**: Proposed — needs root scheduling **and** a tier decision (see Open questions)
- **Priority**: P2 — no user is broken today on the supported target, but the terminal is the one
  feature with a hard, unguarded GPU dependency
- **Effort**: L — a new renderer backend is real work, and there are up to three of them
- **Risk**: MEDIUM — the WebGPU path must not regress while a second backend is introduced
- **Platform baseline**: `e3fc816b`
- **Package baseline**: `ghostty-webgpu@0.1.0` — repo at `/work/projects/ghostty-webgpu`
  (`github.com/ShaulLavo/ghostty-webgpu`), so both halves are ours

Root `PLAN.md` is authoritative for ordering. This is a cross-repo lane; land both halves or
neither.

## Why

`apps/web/src/features/terminal/components/panel.tsx` imports `GhosttyWebGpuTerminal` and
`GhosttyRuntime` **unconditionally**. There is no capability guard, no `navigator.gpu` check, and no
alternative path anywhere in `apps/web`. If `requestAdapter()` returns null, the terminal does not
degrade — it fails.

That is not hypothetical: plan 070 already records a
`WebGPU requestAdapter returned null` failure in the CEF terminal, filed there as out of scope.

Inspecting the package confirms there is nothing to fall back **to**. `ghostty-webgpu@0.1.0`
exports exactly one renderer:

```
WebGpuTerminalRenderer, WebGpuTextPass, RenderScheduler
```

`dist/dom/` is input, clipboard, accessibility and element plumbing — not a renderer. `dist/xterm/`
is xterm compatibility shims. The only non-WebGPU canvas use in the package is
`getContext('2d')` in `dom/fit.js`, which measures glyph metrics for fitting. **A second backend
does not exist and must be built.**

Cases where a GPU adapter is absent or unusable, none exotic:

- Software rendering and VMs (`libvk_swiftshader` paths), CI, and headless capture
- Remote desktop and forwarded sessions
- Older or blocklisted GPUs and drivers
- Non-Chromium engines — relevant to any future shell decision, and the reason this reopens the
  renderer question closed in plan 073

## Design

Introduce a renderer interface in `ghostty-webgpu` and make `WebGpuTerminalRenderer` its first
implementation rather than the only possible one. The terminal core — grid model, damage tracking,
scrollback, selection, input — is already renderer-agnostic; what is coupled is the paint step and
the glyph atlas.

The ladder, best first:

| Tier | Backend        | Expected use                             |
| ---- | -------------- | ---------------------------------------- |
| 1    | WebGPU (today) | default everywhere it works              |
| 2    | WebGL2         | no WebGPU adapter; still GPU-accelerated |
| 3    | Canvas 2D      | software rendering, VMs, CI              |
| 4    | DOM            | accessibility, tests, last resort        |

Selection is a runtime probe, not a build flag, and must be **observable** — the app has to be able
to report which tier it landed on, or a silent downgrade will be mistaken for a performance
regression.

Tier 2 shares the most with tier 1: both are texture-atlas glyph renderers with an instanced quad
per cell. The atlas and instance-buffer code in `render/atlas/` and `render/instances/` is the part
worth designing for reuse; the shader and pass are not.

## Gate 0 — Decide the tiers — BLOCKING

Do not write a renderer before this is answered. Each tier is real, permanent surface area, and
building all four speculatively is the failure mode this gate exists to prevent. See Open
questions; the operator picks the set.

## Gate 1 — `ghostty-webgpu`: extract the renderer seam

1. Define a `TerminalRenderer` interface from what `GhosttyWebGpuTerminal` actually calls today —
   derive it from the existing call sites, do not design it speculatively.
2. Make `WebGpuTerminalRenderer` implement it, with **no behaviour change**. This gate must be a
   pure refactor: same frames, same scheduling, same `RenderScheduler`.
3. Add a `createRenderer(canvas, options)` factory that probes and selects. It must expose the
   selected tier and the reason for any downgrade.
4. Prove the refactor is inert before adding a backend — the WebGPU path's own tests must pass
   unchanged.

## Gate 2 — Implement the chosen backend(s)

Per Gate 0. For each tier:

1. Implement against the Gate 1 interface, reusing the glyph atlas where the tier allows.
2. Correctness first, on the same fixtures the WebGPU path uses: wide/CJK glyphs, combining marks,
   emoji, box drawing, bold/italic, underline and strikethrough, reverse video, cursor shapes,
   selection highlight.
3. Then a performance floor. A tier that is correct but unusably slow is a worse outcome than a
   clear failure message, because it will be reported as "the app is broken" — set and enforce a
   minimum frames-per-second under a full-screen redraw.

## Gate 3 — Platform: wire selection and report it

`apps/web/src/features/terminal/`

1. `panel.tsx` stops importing `GhosttyWebGpuTerminal` directly and goes through the factory.
2. Emit an observability event carrying the selected tier and the downgrade reason — this is how a
   silent downgrade becomes visible in `logs/`.
3. Surface the tier in the terminal's own UI where a user can find it (the existing terminal menu
   is the obvious home) so a support conversation can start from fact.
4. Decide whether the tier is overridable via settings. A forced tier is invaluable for debugging
   and for reproducing a user's report; it is also a new setting to maintain. Operator call.

## Gate 4 — Verification

1. Force each tier and run the fixture suite from Gate 2 against every one.
2. Prove the fallback actually triggers rather than trusting the probe: run with WebGPU disabled
   (`--disable-features=WebGPU` or a swiftshader-only adapter) and confirm the terminal renders and
   the downgrade is logged.
3. Confirm the WebGPU path is byte-identical in behaviour to before Gate 1.
4. Full `bun run verify` in both repos; per-workspace baseline deltas per `plans/README.md`.

## Risks and rejected alternatives

- **Scope.** Four tiers is a renderer per tier, forever. Gate 0 exists to bound this, and the
  honest default is to build **one** fallback, not three.
- **Silent downgrade.** A machine that quietly drops to Canvas 2D will be reported as "the terminal
  got slow". Gate 3's reporting is not optional polish.
- **Refactor risk to the working path.** Gate 1 is a pure refactor with its own exit criteria for
  exactly this reason.
- **Rejected — swap in xterm.js when WebGPU is absent.** The package already ships xterm
  compatibility shims, so it looks cheap. It means two terminal implementations with divergent
  selection, link handling, scrollback and theming — two feature sets to keep in sync, which is
  worse than one renderer interface with two backends.
- **Rejected — require WebGPU and show an error.** Defensible while the only target is bundled
  Chromium, and it is effectively today's behaviour. It fails the VM, remote-desktop and CI cases,
  and it is what plan 070 already tripped over.

## Out of scope

- The PTY layer, documented in [the terminal reference](../docs/terminal.md).
- Any renderer work motivated by supporting a non-Chromium shell. Plan 073 settled the shell
  question; this plan is justified by GPU-absent environments on the supported target, and must not
  be used to relitigate that.

## Open questions for the operator

1. **Which tiers?** Recommended minimum is **WebGL2 only** — it covers most GPU-absent-but-not-
   compute-absent cases while sharing the atlas design with WebGPU. Canvas 2D adds VM/CI coverage
   at meaningfully worse performance. DOM is really an accessibility and test-harness play, and may
   be better justified on those grounds than as a fallback.
2. What is the performance floor per tier, and what happens when a tier cannot meet it — degrade
   again, or fail loudly?
3. Is the tier user-overridable in settings, or diagnostic-only?
