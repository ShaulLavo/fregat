# UI research: what to take from the component libraries

Survey of 14 libraries, 2026-09-25. One file per library; this page groups the findings by where they land
in Platform. Sources are cloned under `references/` (gitignored). Nothing here is implemented yet.

| File                               | Library              | License              | One line                                                                                   |
| ---------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| [neon-ui.md](neon-ui.md)           | Neon UI              | MIT                  | Same stack as ours (Base UI + Tailwind v4); richest source of primitives and chat receipts |
| [extend-ui.md](extend-ui.md)       | Extend UI            | MIT                  | Base UI + Phosphor; File System component shares our tree's `@pierre/trees` lineage        |
| [seamui.md](seamui.md)             | Seam UI              | MIT                  | Synthesized click sounds + press feel; physical-mode sketch                                |
| [animate-ui.md](animate-ui.md)     | Animate UI           | MIT + Commons Clause | Gliding tooltip: too heavy as shipped, rebuildable in CSS on our tooltip layer             |
| [kokonutui.md](kokonutui.md)       | Kokonut UI           | MIT                  | Loaders (already being ported into `spinner.tsx`), progress mask, status text swap         |
| [agentui.md](agentui.md)           | AgentUI              | MIT                  | Plan step marks, approval receipts, live tool tail; built on `motion`                      |
| [ai-elements.md](ai-elements.md)   | Vercel AI Elements   | Apache-2.0           | Reasoning block, context token breakdown, tool detail; built on Radix                      |
| [tinkerers-ui.md](tinkerers-ui.md) | Mischief (Tinkerers) | MIT                  | Stopped-run treatment, context split, subagent tree                                        |
| [scrimui.md](scrimui.md)           | Scrim UI             | MIT                  | Per-component failure modes; approval gate states we lack                                  |
| [manifest-ui.md](manifest-ui.md)   | Manifest UI          | MIT                  | Nothing to copy; MCP Apps hosting is the idea                                              |
| [benday.md](benday.md)             | benday               | MIT                  | Halftone logo "thinking" canvas; brand moments                                             |
| [brainless.md](brainless.md)       | brainless            | MIT                  | Agent CLI screens as HTML; the landing-page demo                                           |
| [cligentic.md](cligentic.md)       | cligentic            | MIT                  | Building blocks for agent-driven CLIs; applies to our own tooling                          |
| [creative-tim.md](creative-tim.md) | Creative Tim         | mixed                | Mostly commercial; usage totals idea only                                                  |

Nothing copies verbatim. Every library uses edge borders, palette colours, `text-[Npx]` or `motion`, so each
item is a port: rewrite classes to our tokens, drop the hairlines, keep the behaviour.

## Base primitives (`packages/ui`)

Strongest signal first. Items several libraries agree on are marked with their sources.

1. **Tooltip glide on the shared layer** (animate-ui). The animate-ui tooltip needs `motion` +
   `@floating-ui/react`, about 50 KB gz net, and has bugs (closes on any scroll, stale text while open).
   The effect is one ease-out, so a CSS glide on Base UI's positioner in `patterns/tooltip-layer.tsx` matches
   it in ~40 lines and fixes our 400 ms linger between adjacent `data-tooltip` targets. Toolbars and the rail
   only glide if their `<Tooltip>` sites move to the layer, which changes the AGENTS.md tooltip rule.
2. **Tabs / segmented control** (neon). Base UI's built-in sliding indicator. We have no primitive; settings
   scope, usage range and view toggles hand-roll button rows.
3. **Scroll edge fades** (neon `scroll-fade`, `scroll-pinned`). Scroll-driven CSS, no JS; hides the scrollbar
   while a log follows. Candidates: `VirtualList`, `ToolPane`, command list, chat timeline.
4. **Hold-to-confirm** (neon; kokonut agrees). Clip-path fill with a duplicated label, so no per-frame render;
   Space/Enter hold works. A `hold` mode on `patterns/delete-dialog-footer.tsx`.
5. **Status dot vocabulary** (neon). Colour only in the dot, in-progress states breathe in CSS. Fits the
   session rail's zero-render contract; covers machines, providers, LSP servers.
6. **Loader extensions** (kokonut). A determinate `value` on the spinner via Kokonut's progress mask;
   `Shimmer` slides old status text out and new in when the text really changes.
7. **Digit roll** (animate-ui). CSS odometer to replace `react-animated-counter` (pulls lodash) in
   `ticker-number.tsx`.
8. **`FileThumbnail`** (extend). Fade that does not replay on remount, clean failed-image fallback. Serves
   the picker, chat attachments and the wallpaper picker.
9. **Typeahead fix** (extend). One line in `patterns/listbox-keys.ts`: extending the query keeps a row that
   still matches instead of jumping past it. Affects every list.

Another session is replacing `OrbitLoader`/`RingLoader` with `spinner.tsx` (uncommitted at time of writing);
items 6 and the loader half of kokonutui.md are written against it.

## Physical mode (seamui)

Seam has no audio files: `web-haptics` (MIT, ~6 KB) synthesizes a 4 ms band-passed noise click per press,
±15 % pitch jitter, on `pointerdown`. Presets `tap`, `tick`, `error`. Press scales to 0.97 on a stiff spring;
popups enter from 0.95 over 200 ms with overshoot; reduced motion degrades to opacity. Exact values in
[seamui.md](seamui.md#how-the-feel-works-exact-values).

Sketch: `workbench.pressFeel` (flat/physical, a root `data-press` attribute like density, CSS only),
`workbench.interfaceSounds` (off / events / controls and events) + volume; one engine in
`packages/ui/src/patterns/` porting the ~60-line synth, primitives opting in with `data-feedback` the way the
tooltip layer works. Silent in rows, menus, the editor and typing. Events tier: turn finished, approval
requested, commit/push done, error toast.

## Chat and agent surfaces

Several libraries converge here, which is the strongest signal in the survey.

- **Reasoning block** (ai-elements, neon). Own block, muted markdown, "Thought for 12s", open while streaming,
  settles closed; a user toggle always wins.
- **Turn receipts** (neon). Tool groups read "Working…" while live, then "7 steps · 1 failed"; a
  "switched to model · effort" marker above a turn that changed them.
- **Live tail of running tools** (agentui, kokonut). Last few calls or output lines in a fixed-height window
  fading at the top, collapsing to the existing summary. Fixed height suits the virtualized timeline.
- **Approvals** (scrim, agentui). Decisions keyed by request id so double clicks and two tabs collapse to one;
  a "late decision" state; pending survives reconnect; expiry. Resolved approvals keep their decision in the
  timeline ("Allowed once"). Belongs with Plan 145.
- **Stopped runs** (tinkerers). Partial answer faded and marked incomplete, reason-specific wording,
  Carry on / Try again.
- **Context meter breakdown** (ai-elements, tinkerers, creative-tim). We already parse input, output,
  reasoning and cached tokens; the meter drops them. Running totals fit Plan 141.
- **Plan steps** (agentui). Dashed circle → spinning arc → drawn check / cross, CSS only; collapses when done.
- **Tool detail** (ai-elements). Clickable `file:line` frames opening the editor, highlighted JSON input,
  failed-output tint, ANSI colour via `features/git/utils/ansi-spans.ts`.
- **Streaming markdown tail** (scrim). Hold an ambiguous tail (lone `#`, backtick) for one token instead of
  rendering it wrong; our `heal.ts` does not.
- **Minimap previews** (agentui). Prompt and reply start in the tooltip instead of "Jump to turn N".
- **Unverified: code block flash while streaming** (agentui). Reading `use-highlighted-code.ts` suggests each
  chunk repaints plain before colouring. Reproduce before treating it as a bug.

## File picker (extend)

Priority order from [extend-ui.md](extend-ui.md#file-picker-adopt-list-in-priority-order): Finder-style
columns for choosing folders (next column mounts once selection settles; preview becomes the last column);
real content preview in `preview.tsx` (images via `/fs/blob`, first ~40 lines of code, fetched after the
selection settles; quick open can share it); footer counts, ⌘[ ⌘] history, ⌘↓ open; icons grid and filter
chips last.

## Site and brand

- **Landing demo** (brainless). `apps/site` iframes the whole web app (31 MB demo build). Replace the hero
  with a lightweight fake workbench, animate scripted sessions in the agents section, keep the real app
  behind a click. Details in [brainless.md](brainless.md#landing-demo).
- **benday** for brand moments: the six-ring mark animating on the boot screen and while the demo loads.
  Framework-free core, so Astro can use it. Needs a "fifth loader, brand only" exception.

## Tooling and larger features

- **cligentic** for our own CLIs: `--json` + next-step hints on `agent:browser` and `logs`, a gate on
  `deploy --rollback`, possibly a `fregat` command agents inside the app call to drive the IDE.
- **MCP Apps host** (manifest): render tool-provided UI in chat. Plan-sized; first check whether the Claude
  and Codex SDKs surface those resources at all.
- **Document viewers** (extend): only if PDF/DOCX/XLSX become first-class; keep-last-4-mounted viewer cache.

## Decisions for the owner

The ones that unblock the most work. Per-library questions are at the end of each file.

1. ~~**`motion`**~~ — answered 2026-09-25: not a hard rule, but CSS is preferred. Reach for `motion` only
   when CSS genuinely cannot do it, and say why.
2. ~~**Tooltips**~~ — answered 2026-09-25: yes to the glide. Icon-button tooltips move onto the shared
   `data-tooltip` layer, which changes the `AGENTS.md` rule that reserves that layer for virtualized rows.
   The `--duration-move` token is still open.
3. ~~**Physical mode**~~ — [Plan 154](../../plans/154-physical-mode.md). The mp3s are T3 Code's (MIT).
4. **Status dots**: switch the vocabulary to Neon's square dots, or keep round?
5. **Hold-to-confirm**: every destructive confirm, or only irreversible ones (discard all, delete worktree,
   force push)?
6. **Reasoning fold**: auto-collapse when the turn moves on, or stay as the user left it?
7. ~~**Documents**~~ — answered 2026-09-25: yes, eventually. Placeholder
   [Plan 156](../../plans/156-documents-in-the-editor.md).
8. **Brand**: is the six-ring mark the app's brand too (the favicon is VS Code's today), and is a brand-only
   fifth loader acceptable?
