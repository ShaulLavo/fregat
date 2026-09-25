# Animate UI

Researched 2026-09-25. Source: `references/animate-ui` (shallow clone of github.com/imskyleen/animate-ui @ efeb96f,
2025-12-31), the live registry `https://animate-ui.com/r/registry.json` (580 items, fetched today; the tooltip
source there matches the clone), and ellie's copies in
`references/ellie/apps/web/src/components/animate-ui/`.

## 1. What it is

- shadcn-registry collection of motion-first components. Two layers per piece: `primitives/*` (behaviour +
  motion, unstyled) and `components/*` (shadcn-styled wrappers). Primitives exist in four flavours:
  `animate` (own implementation), `base` (Base UI), `radix`, `headless` (Headless UI).
- License: **MIT + Commons Clause**. Free to use inside an app, commercial included; forbidden to resell or
  redistribute the components themselves. Fine for us. No paid tier.
- Stack: React 19, Tailwind v4, `motion` (framer-motion successor), `lucide-react`, `tw-animate-css`, cva.
- Deps: 103 of 161 non-demo, non-icon registry items list `motion` directly (the styled `components/*` inherit it through their primitives). **Every** `primitives/base/*` depends on
  `motion` and imports **`@base-ui-components/react`** (the pre-1.0 package name; we run `@base-ui/react` 1.8).
  The animate tooltip additionally needs `@floating-ui/react`.
- Registry: 73 components, 81 primitives, 260 animated icons (Lucide paths driven by motion), 5 hooks, 159 demos.

## 2. Catalog

Paths relative to `references/animate-ui/apps/www/registry/`.

| Group            | Items                                                                                                                                                           | Notes                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Animate (own)    | `primitives/animate/tooltip`, `tabs`, `slot`, `spring`, `cursor`, `avatar-group`, `code-block`, `motion-grid`, `pinned-list`, `scroll-progress`, `github-stars` | The "holy" tooltip lives here, not in `base/`.                                                                                        |
| Base UI wrappers | `primitives/base/{accordion,alert-dialog,checkbox,collapsible,dialog,files,menu,popover,preview-card,progress,radio,switch,tabs,toggle,toggle-group,tooltip}`   | Pattern: Base UI part with `render={<motion.div initial animate exit transition/>}`, `AnimatePresence` around a `keepMounted` Portal. |
| Effects          | `primitives/effects/{highlight,auto-height,blur,fade,slide,zoom,shine,tilt,magnetic,particles,click,image-zoom,theme-toggler}`                                  | `highlight` powers tab/menu/toggle-group gliding fills. `theme-toggler` is View Transitions + `clip-path` circle (no motion).         |
| Texts            | `primitives/texts/{counting-number,sliding-number,rolling,rotating,morphing,typing,splitting,shimmering,gradient,highlight,scrolling-number}`                   | `sliding-number` = odometer driven by one spring value.                                                                               |
| Buttons          | `primitives/buttons/{button,flip,liquid,ripple}`, `components/buttons/{copy,icon,theme-toggler,github-stars}`                                                   |                                                                                                                                       |
| Backgrounds      | `components/backgrounds/{bubble,fireworks,gradient,gravity-stars,hexagon,hole,stars}`                                                                           |                                                                                                                                       |
| Community        | `components/community/{radial-menu,radial-nav,notification-list,pin-list,management-bar,share-button,…}`                                                        |                                                                                                                                       |
| Hooks            | `use-auto-height`, `use-controlled-state`, `use-data-state`, `use-is-in-view`, `use-motion-value-state`                                                         |                                                                                                                                       |

## 3. The tooltip: how it works, what it weighs, and a CSS rebuild

### Mechanism (`primitives/animate/tooltip/index.tsx`, 572 lines)

- One `TooltipProvider` owns a single global overlay (same idea as our `TooltipLayer`). Each `TooltipTrigger`
  wraps its child in a `motion.div` (or `Slot`) and on hover/focus pushes `{rect, side, contentProps}` to the
  provider.
- Positioning: its own `@floating-ui/react` `useFloating` (offset/flip/shift/arrow), separate from Base UI.
- **The effect is the shared-layout FLIP:** the content carries `layoutId="tooltip-content-<globalId>"` (the arrow
  has one too) inside a `LayoutGroup`. When the provider swaps from trigger A to trigger B while open, the overlay
  jumps, and motion animates the content from A's box to B's box: position **and** size at once. The inner text
  uses `layout="preserve-aspect"` so glyphs do not stretch during the size morph.
- Spring `stiffness 300, damping 35` (mass 1): damping ratio 35 / (2·√300) ≈ **1.01**, critically damped.
  There is **no overshoot**; it is an ease-out that settles ~95% at 275 ms, ~99% at 385 ms.
- Entry/exit: `opacity 0, scale 0`, offset 15 px toward the trigger (`initialFromSide`).
- Timing: `openDelay 700`, `closeDelay 300`. Hide is **deferred** by `closeDelay`, which bridges the gap between
  adjacent triggers so the overlay stays open and glides instead of close-reopen. Switching while open is
  immediate (`if (currentTooltip !== null) setCurrentTooltip(data)`).

### Weight (measured)

`bun build --minify`, react external, motion 13.4.3, @floating-ui/react 0.27, scratch dir since deleted:

| Import set                                              | min    | gzip                                                                      |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `motion/react` `{motion, AnimatePresence, LayoutGroup}` | 136 KB | **44.4 KB**                                                               |
| + `@floating-ui/react` (the tooltip's full import list) | 171 KB | **57.3 KB**                                                               |
| `@floating-ui/react` alone                              | 35 KB  | 13.3 KB (≈6.8 KB of it is `@floating-ui/dom`, already shipped by Base UI) |
| `LazyMotion` + `m` (no features)                        | 24 KB  | 9.4 KB                                                                    |
| `LazyMotion` + `domAnimation`                           | 87 KB  | 30.4 KB (no `layout`/`layoutId`)                                          |
| `LazyMotion` + `domMax` (needed for `layoutId`)         | 136 KB | 44.5 KB (no saving for this effect)                                       |
| `motion/mini` `animate` (WAAPI)                         | 10 KB  | 4.1 KB (no layout animations)                                             |

Context: the production entry chunk (`/work/platform-production/current/web/assets/index-*.js`) is ~884 KB gz.
Tooltips mount eagerly, so the net cost is **~~50 KB gz on the critical path (~~+6%)** for one effect.

### Runtime and code problems beyond bytes

- `window` scroll listener (capture) hides on **any** scroll anywhere: the editor, terminal and streaming chat
  scroll constantly. Ours only drops the tooltip when its anchor detaches.
- Content is snapshotted at show time and `TooltipContent` mirrors props into parent state through `useEffect`,
  comparing with `shallowEqualWithoutChildren` — a children-only change (`Copy` → `Copied`) never propagates.
- Every trigger gets a context, two `useState`s and (without `asChild`) an extra `motion.div` in the DOM; we
  have 152 `<Tooltip>` call sites plus `data-tooltip` rows in virtualized lists.
- `LayoutGroup` wraps the whole subtree, so every `layout` element beneath it joins one group.
- Manual `useCallback` throughout; effect-synced state is the pattern our React Compiler rules steer away from.
- A second positioning engine beside Base UI's.

### Verdict: heavy — rebuild it with Base UI + CSS

Everything the eye sees is reproducible without motion:

| animate-ui                              | Ours                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One overlay for all triggers            | Already have it: `packages/ui/src/patterns/tooltip-layer.tsx` + `use-tooltip-layer.ts` (one Base UI `Tooltip` root, controlled `open`, `anchor` = hovered element). Base UI keeps the Positioner mounted while `open` stays true.                                                                                                                                                         |
| Glide to the next trigger               | Base UI Positioner writes `top/left`; add `transition-[top,left] duration-(--duration-move) ease-out-strong` on the Positioner, **gated by a `data-glide` attribute the layer sets only when it switched targets while open** (otherwise a fresh open animates from `0,0`, because Base UI parks an unpositioned popup at the origin).                                                    |
| Size morph                              | Popup `interpolate-size: allow-keywords; transition: width, height` (Chromium; WebKit/Firefox snap, acceptable). All-engine alternative: the layer measures the new content with a `ResizeObserver` and sets explicit `width/height`.                                                                                                                                                     |
| Critically damped spring                | `--ease-out-strong` (`cubic-bezier(0.23,1,0.32,1)`) at ~250 ms is visually the same curve (no overshoot to lose). Exact match if wanted: a CSS `linear()` easing sampled from `(1+ωt)e^{-ωt}`, ω = 17.3 rad/s.                                                                                                                                                                            |
| Deferred hide bridging gaps             | In `use-tooltip-layer.ts`: pointer onto a non-target schedules `hide` after ~120 ms instead of hiding at once; a new target inside that window cancels it and glides.                                                                                                                                                                                                                     |
| Immediate switch while open             | Same hook: if a target is showing, `setTarget(next)` directly. Today `open()` re-arms the 400 ms `TOOLTIP_DELAY` unless `closedAt` is recent, so moving **directly** from one `data-tooltip` element to an adjacent one leaves the first tooltip on screen, anchored to the wrong element, for 400 ms before it jumps. That is a current bug, fixed by the same change.                   |
| Scale/offset entry                      | `packages/ui/src/components/tooltip.tsx` popup: add `data-open:zoom-in-95` + `data-[side=*]:slide-in-from-*-1`, as `popover.tsx` and `dropdown-menu.tsx` already do. Today the tooltip only fades.                                                                                                                                                                                        |
| Content cross-fade on switch (optional) | Base UI 1.8 `Tooltip.Viewport` gives `data-current` / `data-previous` / `data-activation-direction` and `--popup-width/height`. It keys on `activeTriggerElement`, so it needs real triggers (`Tooltip.createHandle()` + detached `Tooltip.Trigger handle=… payload=…`); it will not engage with our `anchor`-only layer. Plain approach for the layer: key the text span and fade it in. |

Estimate: ~40 lines across three files, zero dependencies, reduced motion = drop the glide transition.

Scope catch: the glide only happens between tooltips that share one root. The layer serves `data-tooltip`
sites (8 today). The 152 `<Tooltip>` sites (icon buttons in pane bars, the rail) are separate roots; the
toolbar/rail is where the effect shows most. Two ways to get it there:
(a) move icon-button tooltips onto the layer (`data-tooltip`); one mechanism, needs an AGENTS.md rule change
("icon-only controls carry a `Tooltip`" → "carry `data-tooltip`"); or
(b) a shared `Tooltip.createHandle()` per bar (`PaneBar`, rail) plus `Tooltip.Viewport`.
Recommend (a).

## 4. Steal list (ranked)

1. **Gliding tooltip layer** (above). Files: `packages/ui/src/patterns/use-tooltip-layer.ts`,
   `packages/ui/src/patterns/tooltip-layer.tsx`, `packages/ui/src/components/tooltip.tsx`,
   `packages/ui/src/styles/globals.css` (a `--duration-move` token if approved). **Port idea, no dep.**
2. **Tooltip entry pop.** Scale + short side offset from `--transform-origin`, matching our popovers.
   `packages/ui/src/components/tooltip.tsx`. **Port idea, trivial.** Ship with or before 1.
3. **CSS odometer to replace `react-animated-counter`.** `sliding-number` rolls each digit column by
   `translateY(-digit × 1lh)`. Ours (`apps/web/src/components/ticker-number.tsx`) uses `react-animated-counter`,
   which pulls `lodash` and re-renders on its own (the reason the session rail is excluded). A CSS version (a column
   of 0–9 per digit, `transition: transform` with our tokens, `tabular-nums`) removes the dep and the render
   caveat. Skip animate-ui's code (motion `useSpring` + `react-use-measure`). **Port idea, medium.**
4. **Gliding active-tab fill** (`primitives/effects/highlight`, `primitives/animate/tabs`: one absolutely positioned
   fill moved to the selected tab). CSS-only via anchor positioning (`anchor-name` on `[aria-selected=true]`,
   fill with `left: anchor(left); width: anchor-size(width); transition: left, width`) or Base UI `Tabs.Indicator`
   (`--active-tab-left/width`). Surfaces: `apps/web/src/features/settings/components/scope-tabs.tsx`,
   bottom-panel tabs in `apps/web/src/features/workbench/components/bottom-panel.tsx`. Not the editor tab
   strip (scrolls, closes, reorders). **Port idea.**
5. **Switch press-stretch** (`components/base/switch` `pressedAnimation={{ width }}`): thumb widens a few px while
   pressed, anchored to its resting side. `packages/ui/src/components/switch.tsx`, `group-active:` classes.
   **Port idea, tiny.**
6. **Accordion wipe** (`primitives/base/accordion`: `mask-image: linear-gradient(black var(--mask-stop), transparent
var(--mask-stop))` animated 0→100% alongside height): content wipes in rather than being cut by the moving
   edge. `packages/ui/src/components/accordion.tsx` + `app-accordion-down` in `globals.css`, `@property --mask-stop`.
   **Port idea, low.**
7. **Theme-toggle circle reveal** (`primitives/effects/theme-toggler`: View Transitions + `clip-path: circle()` from
   the click point). We already run a color-mode view transition (`globals.css` `active-view-transition-type(color-mode)`);
   this only changes the keyframes. **Port idea, low; owner taste.**

Skip: menu highlight glide (`MenuHighlight`) conflicts with the ListRow rule "immediate hover/press paint";
dialog blur + perspective tilt (`primitives/base/dialog`: filter blur on a large surface costs paint, showy);
checkbox path draw (no checkbox primitive yet; revisit if one lands, CSS `stroke-dashoffset`); the 260 animated
icons (Lucide; we use Phosphor); backgrounds, cursor, github-stars, avatar-group, radial menu/nav, liquid/ripple/flip
buttons, code typing, `files` tree (our tree is its own package); all radix/headless variants.

## 5. Cost / risk

- Copying any animate-ui primitive brings `motion` (44 KB gz minimum for layout features) and a package rename
  (`@base-ui-components/react` → `@base-ui/react`, with API drift since pre-1.0).
- Their defaults break our language: `bg-primary` tooltips with arrows, `rounded-md` on floating surfaces
  (ours: `lg`), `shadow-sm`, `border`, `text-sm` tabs, hand-written springs/durations. Tooltips in our app are
  `bg-popover-solid`, `ring-1 ring-foreground/10`, `shadow-md`, no arrow.
- The CSS rebuild's risks: first-open glide from `0,0` (gate it), glide during exit animation (clear `data-glide`
  on close), `interpolate-size` is Chromium-only (size snaps elsewhere). Verify with `agent:browser` on a pane bar
  and a virtualized list (glide must not fire when a recycled row swaps under a still pointer).

## 6. Open questions for the owner

1. Move icon-button tooltips onto the shared layer (`data-tooltip`) so the glide works across toolbars and the
   rail? It changes the AGENTS.md tooltip rule.
2. A new motion token for travel (`--duration-move`, ~220–260 ms)? `--duration-enter` (140 ms) reads as a snap
   for a glide of 30–200 px.
3. Entry: keep our 400 ms open delay (animate-ui ships 700 ms in the primitive and 0 in the styled wrapper)?
4. Replace `react-animated-counter` with a CSS odometer (item 3)?
