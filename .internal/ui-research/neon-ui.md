# Neon UI (ui.neon.com): teardown and steal list

Source: https://ui.neon.com, repo `neondatabase/ui`. MIT, "Copyright 2026 Databricks, Inc." (Databricks owns Neon now).
Cloned at `references/neon-ui` (HEAD 98f9b26, 2026-08-07). The shipped sources are in
`packages/registry/src/`. Tokens are in `src/styles/tokens.css`, and each component keeps a
design note (a "STORYBOARD" comment) at the top of its file. The live registry is
`https://ui.neon.com/r/registry.json`, with one `r/<name>.json` per item.

## 1. What it is

- A shadcn registry of **components for agent platforms built on Neon**. It is not an npm package.
  `npx shadcn add https://ui.neon.com/r/<item>.json` copies the source into your app.
- **Stack:** React 19, Tailwind v4, **Base UI** (`@base-ui/react` ^1.6, the same as ours), cva, tw-animate-css.
  Icons are Hugeicons. Some items depend on other packages: `motion` (elastic slider, model select, agent chat turn
  entrance), `recharts` (charts), `streamdown` (reasoning markdown), `anser` (ANSI), `diff`, CodeMirror 6 (SQL),
  `globe.gl`, `@shadcn/react` (the headless `message-scroller`), and `ai`/`@ai-sdk/react`.
- **Base primitives** (`components/ui/*`): stock shadcn "base" style (button, card, badge, tabs, tooltip, dialog,
  popover, select, input, switch, skeleton, label). They are **not better than ours**. The value is in the composite
  components and in the interaction and design notes.
- **Tokens:** shadcn variables, brand green on near-black (`#00e599` on `#0c0d0d`). Radius is 0.5rem, and the docs
  site runs `radius: none`, so things read square. Type is Inter with Geist Mono, and mono is used heavily for
  values, ids, status words and tab labels. There is one status vocabulary: `--status-active/sleeping/scaling`.
  The chart ramp is **one hue in five lightness steps**. Motion is one `--ease-out-soft` curve plus a set of
  purpose-named keyframes (breathe, stripe-march, submit-pulse, check-draw, hold-shake, spin-once).

## 2. Catalog (61 registry items)

Doc pages are at `https://ui.neon.com/<group>/<name>`. Sources are at `references/neon-ui/packages/registry/src/components/<name>/`.

| Group                | Items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent                | [agent-chat](https://ui.neon.com/agent/agent-chat), [chain-of-thought](https://ui.neon.com/agent/chain-of-thought), [inline-citation](https://ui.neon.com/agent/inline-citation), [model-select](https://ui.neon.com/agent/model-select), [reasoning](https://ui.neon.com/agent/reasoning), [thinking-model-select](https://ui.neon.com/agent/thinking-model-select), [thinking-select](https://ui.neon.com/agent/thinking-select), [tool-call-chip](https://ui.neon.com/agent/tool-call-chip); ui: message, bubble, marker, message-scroller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Platform             | [activity-feed](https://ui.neon.com/platform/activity-feed), [api-key-list](https://ui.neon.com/platform/api-key-list), [branch-picker](https://ui.neon.com/platform/branch-picker), [branch-tree](https://ui.neon.com/platform/branch-tree), [checkpoint-timeline](https://ui.neon.com/platform/checkpoint-timeline), [db-connection-card](https://ui.neon.com/platform/db-connection-card)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Database             | [branch-diff](https://ui.neon.com/database/branch-diff), [logs-viewer](https://ui.neon.com/database/logs-viewer), [query-history](https://ui.neon.com/database/query-history), [schema-explorer](https://ui.neon.com/database/schema-explorer), [sql-runner](https://ui.neon.com/database/sql-runner)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Infrastructure       | [autoscale-chart](https://ui.neon.com/infrastructure/autoscale-chart), [compute-status](https://ui.neon.com/infrastructure/compute-status), [region-card](https://ui.neon.com/infrastructure/region-card), [region-globe](https://ui.neon.com/infrastructure/region-globe), [region-select](https://ui.neon.com/infrastructure/region-select)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Consumption          | [branch-usage-table](https://ui.neon.com/consumption/branch-usage-table), [consumption-chart](https://ui.neon.com/consumption/consumption-chart), [cost-estimate-card](https://ui.neon.com/consumption/cost-estimate-card), [storage-breakdown](https://ui.neon.com/consumption/storage-breakdown)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Base components      | [app-card](https://ui.neon.com/base-components/app-card), [app-creator](https://ui.neon.com/base-components/app-creator), [auth-form](https://ui.neon.com/base-components/auth-form), [color-picker](https://ui.neon.com/base-components/color-picker), [confirm-dialog](https://ui.neon.com/base-components/confirm-dialog), [date-range-picker](https://ui.neon.com/base-components/date-range-picker), [empty-state](https://ui.neon.com/base-components/empty-state), [health-card](https://ui.neon.com/base-components/health-card), [metric-card](https://ui.neon.com/base-components/metric-card), [preview-frame](https://ui.neon.com/base-components/preview-frame), [provisioning-status](https://ui.neon.com/base-components/provisioning-status), [status-badge](https://ui.neon.com/base-components/status-badge), [upgrade-dialog](https://ui.neon.com/base-components/upgrade-dialog), [usage-card](https://ui.neon.com/base-components/usage-card), [usage-panel](https://ui.neon.com/base-components/usage-panel), [workspace-tabs](https://ui.neon.com/base-components/workspace-tabs) |
| Brand (WebGL)        | animated-wash, banner-pattern, dot-matrix-wave, halftone-bloom, mesh-gradient, neon-aurora, neon-loader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Blocks / lib / hooks | create-project; consumption (cost math), neon-client; use-gateway-models, use-region-ping, use-consumption-history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Docs                 | [theming](https://ui.neon.com/theming) (a live "paste your variables" re-skinner, `apps/docs/demos/theme-paster.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 3. Ranked steal list

Legend: **copy** means lift the code and restyle it to our tokens. **port** means rebuild the idea on our primitives. **skip** means not worth taking.

1. **`scroll-fade` + `scroll-pinned` utilities** (copy). Source: `tokens.css`, `.neon-scroll-fade` / `.neon-scroll-pinned`.
   A scroll-driven animation (`animation-timeline: scroll(self y)`) animates two registered `@property`
   lengths into a `mask-image`. Edges are crisp at rest and fade in mid-scroll, and there is no JS. The fallback is
   crisp edges. The pinned variant hides the scrollbar while a log tail is following, because the thumb then
   reports a position the reader does not control.
   Destination: `@utility scroll-fade` / `scroll-pinned` in `packages/ui/src/styles/globals.css`.
   Apply to the `VirtualList` viewport (`patterns/virtual-list.tsx`), `ToolPane` bodies, the `command.tsx` list,
   the model picker list, and the chat timeline viewport (`features/chat/components/timeline-viewport.tsx`, which
   today has a hand-written mask only in `user-message-body.tsx`). Their thumb uses `--border`. Ours should use a
   foreground alpha, not a hairline token.
2. **Hold-to-confirm destructive** (copy the mechanism). Source: `confirm-dialog/confirm-dialog.tsx` plus `neon-hold-shake` in tokens.css.
   There is no rAF or per-frame setState. One `clip-path: inset(0 X 0 0)` CSS transition runs `linear` over `holdMs`,
   with a second copy of the label inside the fill, so the sweep edge crosses the letters instead of flipping
   them. Letting go early springs it back in 180ms ease-out. A shake amplitude rides an `@property --neon-shake-amp`
   that transitions from 0 to 0.75px over the hold with an ease-in. A held Space or Enter works the same way,
   and key repeat is ignored.
   Destination: a `hold` mode on `packages/ui/src/patterns/delete-dialog-footer.tsx`, or a `HoldButton` pattern,
   used by git "discard all", worktree delete, `features/chat/components/checkpoint-revert-dialog.tsx` and force push.
   This is better than today's one-click `variant='destructive'` Delete. Compare mischief's hold-button
   (`tinkerers-ui.md`): it animates with rAF plus setState, and a keyboard click completes instantly. Neon's
   version is cheaper, and it treats the keyboard honestly.
3. **One status vocabulary: `StatusDot` / `StatusBadge` with "breathe"** (port). Source: `status-badge`, `compute-status`, `neon-status-breathe`.
   Colour lives only in a 6px dot and the word stays muted. States that are alive (provisioning, scaling) breathe:
   opacity 0.45 to 1 plus a `currentColor` glow over 2.6s ease-in-out, held steady under reduced motion. A
   suspended thing dims the whole line.
   Destination: a `packages/ui` primitive that replaces the ad-hoc dots in
   `features/chat-mode/components/session-attention-indicator.tsx`, `features/settings/components/machine-row.tsx`,
   provider rows, LSP server status and terminal tabs. The breathe is pure CSS, so it keeps the session rail's
   zero-render contract. That is a reason to prefer it over mounting a `Spinner` per row for "working".
   The keyframe duration needs a token.
4. **Agent turn receipts** (port). Sources: `reasoning/reasoning.tsx`, `agent-chat.tsx` (`ToolGroup`, `switchLabel`).
   - The reasoning fold auto-opens while streaming. When streaming ends it waits 1s, then folds to a
     "Thought for 12s" receipt. **The reader's toggle always beats the automation** (`userToggledRef`), and a
     static `defaultOpen` block never closes itself.
   - The tool run header shimmers "Working…" for the **whole live turn**, not only while a call is running,
     because folding in the gaps between calls reads as a glitch. At rest it becomes "7 steps · 1 failed".
   - A quiet "switched to GPT-5.2 · high thinking" marker appears above a user turn whose model or effort changed.
     Destination: `features/chat/components/activity-group-row.tsx`, `utils/activity-visibility.ts`
     (`activityGroupSummary`), and the timeline items that render user turns (`utils/timeline-items.ts`). We have no
     "Thought for Ns" or "switched to" today.
5. **Log tail behaviour** (port). Source: `logs-viewer/logs-viewer.tsx`.
   While the reader is scrolled away, the jump button counts arrivals ("23 new lines"), otherwise it says "Follow
   output". Scrolling back to the bottom re-arms following. The header reads "x of y lines (capped at 5000)", and
   level toggles sit in a segmented group. Following is state, not a checkbox.
   Destination: `features/logs/components/event-list.tsx` / `toolbar.tsx`. The same new-count pill fits the chat
   timeline jump-to-latest and terminal scrollback. Their fixed-height windowing is naive, and our `VirtualList`
   is better, so take only the behaviour.
6. **Tabs / segmented control with a gliding indicator** (copy `TabsIndicator`). Source: `components/ui/tabs.tsx`.
   Base UI's `Tabs.Indicator` exposes `--active-tab-left/width/top/height`. One absolutely positioned span
   transitions `translate`/`width`, with no ResizeObserver. (Neon's own `workspace-tabs` hand-rolls one with a
   ResizeObserver, so take the primitive.) Also: a per-tab action slot that crossfades on switch while the bar
   height never changes, and a count chip inside the trigger.
   Destination: `packages/ui` has **no tabs or toggle-group primitive**. The hand-rolled `aria-pressed` Button rows
   in `features/settings/components/usage-range-tabs.tsx`, `scope-tabs.tsx` and `view-toggle.tsx` would use it,
   with `bg-accent` fill and no border.
7. **Connection and secret display** (port). Source: `db-connection-card/db-connection-card.tsx`, `api-key-list`.
   - Mask **only the secret part** of a URI (head `user:`, masked password, tail `@host/db`), and copy always
     carries the real string.
   - A `dl` params grid of `dt` key, `dd` mono value and a per-row copy button.
   - One reveal toggle shared by all views, which include an "Agent" view: a paste-ready prompt that names the env
     var instead of the secret.
   - `widestOption()`: a select trigger reserves the width of its longest option (an invisible overlaid grid cell),
     so changing the selection never reshapes the row.
   - `AnimatedHeight` when switching between views of different heights.
   - Reveal-once plus hold-to-revoke for keys.
     Destination: machines (`features/settings/components/machines-section.tsx`, `components/machine-form.tsx`), the
     remote server URL/token in `features/environments/components/*`, and `provider-sign-in-dialog.tsx`. The
     `widestOption` trick also fits `model-picker-trigger.tsx` and the draft branch/workspace menus in
     `draft-context-strip.tsx`.
8. **Usage honesty rules** (port the ideas, **skip recharts**). Sources: `usage-panel`, `cost-estimate-card`,
   `branch-usage-table`, `storage-breakdown`, `consumption-chart`.
   - A metering-lag footer ("data trails real time by ~1h").
   - Cost lines read as quantity × rate, with allowances shown instead of silently netted. The estimate calls
     itself an estimate.
   - Magnitude is a **hairline rule under the sorted column's cell**, not a filled block.
   - Rows past top N collapse into one "12 more" row below the ranking, and a muted totals row closes the table.
   - A single stacked bar where hovering a row **dims the other segments** instead of growing anything.
   - The legend is the filter, and the last visible series cannot be turned off.
   - Header totals never add across units.
   - Single-hue chart ramp, separated by value plus a `--card` gap.
     Destination: `features/settings/components/usage-section.tsx`, `usage-day-chart.tsx`, `usage-model-row.tsx`,
     `usage-price-row.tsx`, and `features/chat/components/usage-limits-meter.tsx`. Our div-bar chart stays. A
     scrubbable readout can be hand-written.
9. **Checkpoint timeline rail** (port). Source: `checkpoint-timeline`.
   - The restore action slides out from behind the row on hover or focus into **space that is always reserved**,
     so the row never moves.
   - While one row restores, its marker breathes and "Restoring…" shimmers, and the rest of history recedes to
     half voice.
     Destination: chat checkpoints (`checkpoint-revert-dialog.tsx`, `lib/checkpoint-availability.ts`) and the undo
     History tab.
10. **Branch graph in a picker** (port). Source: `branch-picker`, `branch-tree` (the `GEOMETRY` block).
    A branch sits in the lane of its depth. The edge is `M px py V cy-8 Q px cy px+8 cy H cx` (a quarter turn
    into the child), and the default or selected node wears a ring. The graph flattens to one lane while
    searching. Destination: `features/chat/components/draft-branch-list.tsx` and worktree pickers. Lane colours
    come from `lib/history-lane-colors.ts`.
11. **Fixed-frame lifecycle panel** (port). Source: `provisioning-status`, `preview-frame`.
    One frame, and only the voice changes. The detail line crossfades in place, with the old step rolling out
    the top as the new one rises (300ms, zero shift). Error keeps the frame and shows a retry where the shimmer
    was, and "sleeping" is a scrim, not a removal. Destination: `features/environments/components/connection-gate.tsx`
    and the boot and remote-connect states.
12. **Theme paster** (port). Source: `apps/docs/demos/theme-paster.tsx`.
    It parses a pasted `:root{--x:…}` block or tweakcn JSON into variables and re-skins live. Destination: a
    theme import in the appearance settings, feeding the palettes-as-data bundles.
13. **Small interaction rules worth adopting everywhere:**
    - validate on blur only for filled fields, and never while typing (`auth-form`)
    - a "press ⏎" hint that appears once input is valid (`app-creator`)
    - a copy flash ("Copied" slides in over a gradient mask) plus a polite live region (`db-connection-card`)
    - stagger history rows 60ms newest-first on first mount only
14. **Skip:**
    - brand WebGL (aurora, mesh, halftone, NeonLoader) and the globe/region map
    - auth/upgrade dialogs
    - the `elastic-slider`/`thinking-select` sparkle, which needs the `motion` dependency; our effort picker was
      just redesigned
    - `model-select`'s spring-gliding row highlight, which conflicts with "immediate hover/press paint" on rows
    - SQL runner and query history, since CodeMirror duplicates our editor. Idea only: a guarded run on
      `Mod-Enter`, and an Ln/Col/selection readout
    - EmptyState's dashed frame and `stripe-march`, since dividers are banned and a barber-pole would be a fifth
      loader

## 4. Cost and risk against our design language

- **Hairlines everywhere.** Nearly every Neon surface is `border border-border/60`, `border-b` headers or
  `border-l-2` rails. Every port has to convert these to tone (`bg-content-well` wells, `bg-muted` chips), or the
  `hairlines` census fails. The reasoning and tool rails need a tone replacement (for example a `bg-muted` 2px
  bar, which is still a line, or an indent only).
- **Type.** Neon uses `text-[10px]`/`text-[11px]`/`text-[9px]`, which map to `text-3xs`/`text-2xs`. Arbitrary sizes
  are banned.
- **Motion.** They hand-write durations (240ms, 2.6s, 700ms) and some curves. Ours must come from
  `--duration-*`/`--ease-*`. We need new tokens for the semantic durations: `--duration-hold`,
  `--duration-breathe`.
- **Icons** are Hugeicons, so swap to Phosphor at `size-(--icon-size[-sm])`.
- **Loaders.** `animate-spin` on a borrowed icon (tool chip, send button) and `animate-pulse` skeletons are
  banned here. Use `OrbitLoader`/`LoadingState`.
- **React Compiler.** Their code uses manual `useMemo`/`useCallback` freely. Ports should drop them and check with
  `compiler:memos`.
- **Licence.** MIT needs the copyright notice kept for copied "substantial portions". Items 1, 2 and 6 are the
  copy candidates, so add a third-party notice (Databricks, Inc.) where they land.
- **Risk is low.** The same Base UI version family and Tailwind v4 mean ports are mostly class rewrites.

## 5. Open questions for the owner

1. Hold-to-confirm: should every destructive confirm move to hold, or only the irreversible ones (discard all,
   delete worktree, force push)? Should the shake ship, or only the fill?
2. Status dot shape: Neon uses **square** dots and markers ("flush with the token radius system"). Ours are round.
   Do we switch the whole vocabulary to square?
3. Which tone replaces Neon's `border-l-2` rail for reasoning and tool folds: indent only, or a muted 2px bar?
4. `scroll-fade` on by default in `VirtualList` and `ToolPane`, or opt-in per surface?
5. Should a "switched to model · effort" marker show on every change, or only when the change happened
   mid-session?
6. Is a theme paste/import in scope for the appearance settings?
