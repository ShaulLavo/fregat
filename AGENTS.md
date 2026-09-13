# Repository Guidelines

## Code Organization

- Group by feature, then by kind:
  - `components/` — React render components only (`.tsx`)
  - `hooks/` — `use-*` hooks
  - `providers/` — context providers and `*-context.ts` modules
  - `state/` — optional home for stores and other stateful modules. Co-locating a store next to its provider is fine too
  - `utils/` — pure, stateless, non-React code only. No stores, no module-level mutable state, no subscriptions, nothing that imports React
  - `tests/` — feature tests
- Do not create empty folders.
- Import exact files through `@/`. Do not add barrel `index.ts` files.
- Barrel files are allowed only at package entry points such as `packages/*/src/index.ts` that back the package's `"."` export. Do not add feature, folder, or utility barrels.
- `apps/web/src/lib/` is the app-level shared layer. It is not a kind directory and it is not a junk drawer. **A module belongs in `lib/` only if two or more consumers outside `lib/` import it** — counting `features/*` (each feature counts once), `components/`, `hooks/`, `keymap/`, and `main.tsx` — **or if it is a dependency of a `lib/` module that qualifies.** A module with a single outside consumer lives inside that consumer instead.
- The rule runs both ways. When a `lib/` module drops to one consumer, move it into that consumer. When a feature-local module gains a second feature consumer, move it up to `lib/` in the same pass — do not import across features to reach it.
- `lib/` sits below `features/`: a `lib/` module should not import from `@/features/*`. Shared policy that genuinely needs feature knowledge belongs in the layer that already owns the domain — command enablement lives in `keymap/`, next to the command registry, not in `lib/` and not in `components/`.
- Two implementations of the same-sounding helper are not automatically duplicates. Before merging them, diff their _behaviour_ — the six `basename` variants in `apps/web/src` have three different empty-path fallbacks (`'Root'`, `''`, and the whole path) and one of them lowercases its result, yet all six share the signature `(string) => string`, so a wrong merge typechecks. Merge only with a test per call site, or leave a comment saying why they differ.

## Control Flow

- The `never-nester` skill is part of every development task: `/Users/shaul/.agents/skills/never-nester/SKILL.md`.
- Keep nesting depth to 3 or less.
- Use guard clauses and early returns. Keep the happy path shallow.
- In loops, use inverted conditions with `continue` instead of wrapping the body in `if`.
- Extract inner logic into named functions when inversion is not enough.
- Do not use `else` after an early return.
- Never use nested ternaries. Split the logic into `if` statements or a named helper.

## Comments

- Keep comments short. One or two lines. Three is already suspicious.
- A comment earns its place by saying what the code cannot: a non-obvious constraint, the bug it prevents, why an obvious simplification is wrong. Everything else is noise.
- No essays, no history lessons, no restating the next line in prose. If the explanation is long, the code or the name is wrong.

## React Code

- One component per file. Do not export multiple components from one component file.
- One hook per file. Keep hook files focused on the hook and its React wiring.
- Keep pure helpers out of component and hook files. Move formatters, transforms, constants, models, and other pure reusable logic into `utils/`.
- Stores are stateful, so they never go in `utils/`. Where they do live is flexible: `state/`, or co-located with the provider or feature code that owns them.
- Keep providers and context-object modules in `providers/`, not `components/`.
- Do not prop-drill app-level commands, state setters, or callbacks through layout/presentation components. If a prop is only forwarded, or a command crosses more than two component boundaries, stop and add a narrow feature provider/hook or colocate the command with the state owner.
- Keep leaf callbacks as props only when they are local UI behavior owned by the direct parent. Context/provider APIs should expose small domain actions such as `selectTab` or `requestCloseTab`, not broad state blobs.
- Avoid manual React memoization. Do not add `memo`, `useMemo`, or `useCallback` for ordinary render values or callbacks. Use them only for measured performance issues, required stable identity, or correctness. Add a short reason when you do.

## Styling

- Style with Tailwind classes and the `@workspace/ui` primitives. Do not write raw CSS or inline `style` props except for values that must be computed at runtime (dynamic positions, measured sizes).
- Use theme tokens only. Color classes must resolve to a token: `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `bg-card`, `border-border`, etc.
- Never use raw Tailwind palette colors (`bg-blue-600`, `text-red-500`, `text-sky-300`, `amber-*`, `emerald-*`) or hex/`oklch()` literals in components. They bypass theming and dark mode.
- Status and diff colors have tokens — use them instead of picking a palette hue:
  - error / danger → `destructive`
  - info / primary action → `info`
  - success / passed → `success`
  - warning / degraded → `warning`
  - diff added / removed → `diff-added` / `diff-removed`
- These tokens flip automatically between light and dark. Do not hand-roll dark variants like `text-sky-700 dark:text-sky-300`; write `text-info` once.
- A token works with opacity and every utility: `bg-success/10`, `border-warning/30`, `ring-info`.
- Need a color with no token? Add it to `packages/ui/src/styles/globals.css` (light `:root`, `.dark`, and the `@theme inline` map) instead of inlining a palette class.
- Compose the shared primitives; do not restyle them ad-hoc or reach for a raw `<button>`/`<input>` when a primitive exists.
- Pane surfaces (`bg-background`, `bg-card`, `bg-muted`, `bg-accent`) follow `--surface-opacity`. Use `backdrop-material` for panes over wallpaper or content.
- Floating UI is always opaque: dialogs, menus, popovers, toasts, tooltips, and editor hover/completion panels. Use `bg-popover-solid` or another solid theme token. Do not add backdrop blur, wallpaper layers, or transparency derived from pane settings.
- `bg-popover` also resolves to the solid popover token. The `-solid` utilities deliberately ignore the user's transparency setting.

## The Design Language

These six are settled. A call site never re-decides them; if one does not cover your case, the
answer is a missing token, not a local choice. `scripts/lint/web-design-census.mjs` enforces them
and runs in `verify` and CI; `scripts/lint/web-design-allow.json` holds the exceptions, and an
entry without a real reason is itself a violation.

- **Corners belong to the primitives.** Controls (button, input, select, textarea, input group,
  badge) are the `md` step; floating surfaces (dialog, popover, dropdown, context menu, command
  palette, tooltip) are `lg`; chips, tags, thumbnails, inline code, kbd, count badges and skeleton
  placeholder bars are `md`; circles and pills are `rounded-full`. List rows, bars, headers, pane
  surfaces and tabs inside a bar are square. A `@workspace/ui` primitive call site carries no
  radius class at all. Bare `rounded` is off-scale and banned, and a redundant `rounded-none` is
  just noise — no class already means no radius.
- **One bar height.** Every horizontal bar — titlebar, pane headers, tab strips, dialog headers and
  footers — is `h-(--bar-height)` with `px-(--bar-padding-x)`, ideally by composing `PaneBar`.
  Vertical icon rails are `w-(--rail-width)`, which equals the bar height so a rail lines up with
  the header beside it. A skeleton bar uses the same token as the bar it stands in for; a header
  that changes height when data arrives is the bug this rule exists to prevent.
- **One density system.** The `--density-*` custom properties. Never hand-write a
  `compact:`-prefixed pair; the variant no longer exists.
- **Dividers.** `border-border` between regions, `border-subtle` inside content. No opacity
  modifier on either. Note that `[data-workbench]` sets `--border: transparent`, so borders inside
  the workbench are deliberately invisible and separation there comes from surface tone.
- **Four type sizes.** `text-sm`, `text-xs`, `text-2xs` (11px), `text-3xs` (10px). An arbitrary
  `text-[Npx]` is banned. A bar title is `text-xs font-medium`; a pane section heading is
  `text-sm font-semibold`.
- **Fills and elevation.** Elevation is three levels: `shadow-xl` on a modal dialog, `shadow-md` on
  a menu or popover, nothing anywhere else. List rows use `bg-row-hover`, `bg-row-active` and
  `bg-row-selected`, never an opacity modifier on them — the alpha is the design. Toggled controls
  use `bg-accent` with `aria-pressed` or `aria-selected`. A `Button` call site never re-declares
  hover; the primitive owns it.

Interaction treatments are utilities, not strings to copy:

- `focus-ring` for anything you act on (gated on `:focus-visible`, so a clicked control never
  glows), `focus-ring-within` for anything you type into and its wrappers (gated on `:focus-within`,
  because a text surface must show where the caret went however it was reached), and
  `focus-ring-inset` for full-bleed scroll containers whose outset ring would be clipped. Tint one
  by setting `--focus-ring-color`; do not add a `ring-*` class, which cannot work because the
  utility owns the box-shadow.
- `pressable` for press feedback. It deliberately does not nudge a control that opens a menu,
  because the popup would travel with it.
- Motion comes from `--duration-enter`, `--duration-exit` and the `ease-*-strong` curves. Those are
  Tailwind's configured defaults, so a bare `transition-*` already inherits them. Never hand-write
  a duration or an easing curve. When a transition animates a focus ring, name `box-shadow` in the
  property list: `transition-colors` does not include it, so the border would fade while the ring
  snapped in.
- A custom `@utility` is invisible to `tailwind-merge`, so it never conflicts with anything and both
  classes survive a merge. Two focus utilities on one element would therefore both set `box-shadow`
  and the element would draw whichever was emitted last, so they are registered as one class group
  in `packages/ui/src/lib/utils.ts`; anything else you add as a `@utility` needs the same treatment.
  A Tailwind `ring-*` or `shadow-*` class does still win the property at CSS level, because it is
  emitted after the custom utilities at equal specificity — so `focus-visible:ring-0` is how a call
  site opts out of the halo, though not out of the `border-color` half. Inside a wrapper that draws
  the ring for the whole field, suppress the inner control's own ring with `shadow-none!` for the
  utility's raw shadow and `aria-invalid:ring-0` for the primitive's invalid ring; `shadow-none!`
  cannot do the second, because it zeroes `--tw-shadow` while still composing `--tw-ring-shadow`.
- Composite fields — anything with a leading icon, a trailing button or a trailing count — are
  built from `InputGroup` with addons. Never position an icon absolutely over a padded input, and
  never hand-pick a `pl-*`/`pr-*` to clear one.

## Loading And Empty States

- Never hand-roll a loader. There are five, they live in `@workspace/ui`, and every waiting state in the app is one of them. No `animate-spin` on a borrowed icon, no `animate-pulse` dots, no bare "Loading…" paragraph.
- Pick by **where the wait is**, not by which feature you are in:
  - `LoadingState` — a region with no content yet (a pane, a list, a popover menu). Skeleton rows.
  - `OrbitLoader` — a process running with no known end, in a slot beside a label: a header cell, a list row, a status line. This is the default small loader.
  - `RingLoader` — the same, when the wait should stay quiet. Also the one to scale up for a whole-surface wait.
  - `Spinner` — a control mid-action: a button that was clicked and is now working.
  - `Shimmer` — text already on screen, transiently in progress, _inline inside a running sentence_ where a mark would break the flow. Never a substitute for a loader in a slot that can hold one.
- A loading state and an empty state must never look alike. "Loading X" and "No X" set in the same type is a bug — the user cannot tell a slow panel from an empty one. Pending gets a loader; `EmptyState` is only for a verdict the app can actually deliver.
- Check the fall-through. A list that only branches on `error` and `length === 0` will show "Nothing here" while it is still fetching. Branch on pending **before** empty.
- `LoadingState` holds its bars back for 120ms (`delayMs`) so a fast query does not flash a skeleton. The `role="status"` container mounts immediately either way, so assistive tech is told at once. Do not defeat this with your own conditional.
- Reduced motion is handled inside the primitives — they slow down rather than freeze, because a stopped spinner reads as a hung process. Do not add `motion-reduce:` classes at the call site.
- Ellipsis is `…`, never `...`.

## Settings

- Every user-facing knob is a registry entry in `packages/contracts/src/settings/keys.ts`. Never a new `localStorage` key, never a new env var, never a hardcoded constant someone has to recompile to change.
- A key is never registered inert. Register it in the same pass that wires its consumer, or do not register it — a knob that writes a file nothing reads is worse than no knob.
- Scope is a security boundary. A value that reaches **execution** — selects a binary, sets env, becomes a flag name, or binds a key — is `application` or `machine`, never `window`: a workspace file ships inside a cloned repository. A value that reaches only **suppression** may be `window`, and then it must show the cross-scope indicator.
- Settings are read through `useSettingValue` in React, or `readSettingsMirror()` outside it (module scope, async generators). Do not reach into the query cache directly.
- Secrets never enter the settings document. They go to the secret store, which is why the raw JSON view, export and the settings file itself are safe to read.
- Regenerate `docs/settings-reference.md` with `bun run settings:reference` after changing the registry.

## Greenfield, No Backward Compatibility

- This project is greenfield and not live: no releases, no external users, no data anyone needs migrated.
- No backward compatibility shims, no legacy aliases, no deprecation windows. Update every call site in the same pass.
- When a bug fix invalidates state the buggy code already persisted (localStorage, caches, on-disk files), do not write healing or migration code. Delete the bad state, or tell the user what to delete. One corrupted dev machine never justifies permanent code.

## Naming And Refactors

- Do not repeat the folder name in file or symbol names. In `workspace/`, prefer `sidebar.tsx`, not `workspace-sidebar.tsx`.
- Keep qualifiers only when they add meaning: domain types like `WorkspaceCommand`, domain terms like `workspacePath`, or root components like `WorkspaceView`.
- When removing a redundant prefix, rename the file, exports, and all call sites in one pass.
- Delete obsolete tests instead of preserving old behavior.
- Remove duplicate code aggressively.

## Optimization And Performance Work

- Look beyond the local minimum. Before tuning an implementation, ask whether the data layout, algorithm, or overall design is the real bottleneck. Challenging the frame beats polishing it.
- Tweak-level wins (caching a value, hoisting a loop, batching calls) are easy to find and easy to overrate. Treat them as a floor, not the goal.
- Question the expensive work's right to exist: can allocations be eliminated instead of pooled, can the computation be done once instead of cached, can the layer be deleted instead of sped up?
- State the structural alternative even when only asked for a quick optimization. If a redesign would beat every local tweak, say so before spending effort on tweaks.
- Measure before and after. An optimization without a benchmark or profile is a guess.
- Aim for the domain-expert ceiling, not the first improvement that works: zero allocations, no redundant passes, data shaped for how it is actually accessed.

## Debugging

- Calibrate the instrument before trusting its readings. Before debugging "X isn't happening", first confirm X would be observable if it did happen — e.g. before chasing a highlight that "doesn't paint", check what color it is supposed to paint and that the color is distinguishable from the background. Verify the expected observable on a known-good case as a control.
- Treat contradictions as falsification, not as detail to patch around. When a theory needs a new special case after each new observation (per-object, then per-node, then per-row, then global), the theory is wrong — stop patching it, go back to raw ground truth, and re-derive. Two epicycles is the limit.

## Logs

- The app writes structured JSONL logs to `logs/`, one file per day (`logs/2026-06-12.jsonl`). Days that grow too big roll over into numbered continuations (`2026-06-12.1.jsonl`); the highest number is the newest.
- Each line is one JSON object with `timestamp`, `level` (`debug`/`info`/`warn`/`error`), and `source` (`be` = server, `client` = web app, `keyboard`), plus request/operation fields like `requestId` and `area`. Filter with `grep`/`jq` instead of reading raw.
- Looking at the logs is highly encouraged for any task. When debugging, it is a must — check them before forming a theory.
- If the logs do not explain the failure, that is itself the bug to fix first: add the missing log events or fields, then debug with the better logs. Do not debug blind.
- Logging is wide-event style (evlog). Always prefer wide logs: enrich the one event per operation/request with more fields instead of emitting extra narrow log lines.
- Never throw `new Error`. Create errors with `createError` from `evlog` — in practice through the feature's `structured-errors.ts` wrapper (`createStructuredError` or a `defineErrorCatalog` entry) so the error carries `code`, `status`, `why`, and `fix`.

## TypeScript Fixes

- Treat readonly/mutable mismatches as contract bugs first.
- Do not copy containers just to satisfy TypeScript.
- If a callee does not mutate a value, make its parameter or model type accept readonly data.
- Avoid fake fixes like `sizes: [...node.sizes]`. Copy only for a real ownership boundary or real mutation.

## Dev Server

- A dev server is always running. Never spin up your own server to test or verify changes — reuse the running one.

## Deployment: The Mesh

- Every change ships to the mesh once it is done, so a production build is always available to look at. Treat the deploy as the last step of the task, not an extra.
- The mesh is a plain local deployment. Mesh (`mesh serve`) publishes a port on this machine to the owner's Tailscale network, so the production build is reachable from their own devices at `https://omarchy.mesh.shaulavo.dev/platform`. Nothing is public. This is the deployment until a packaged release exists, and it may stay the deployment.
- One route, one `systemd --user` service, one process: `/platform` → port 3301, `platform-prod.service`, running `/work/platform-production/current/server/index.js`, which serves the API and the built web from `current/web`. `current` is a symlink into `/work/platform-production/releases/<UTC stamp>-<commit>-<slug>/`, and every release holds `web/`, `server/`, `build-config.json`, the build logs and the live check output.
- Deploy with `bun run deploy` from the checkout. It builds the web, reuses the running server bundle, verifies the candidate (index.html paths, the wasm artifact, and a boot of the candidate server on a spare port), swaps `current`, and runs the headless live check through the mesh URL. No restart, so live terminal and agent sessions survive.
- Server changes need `bun run deploy --server`, which also builds the server and restarts the unit. A restart drops every live terminal and agent session, so do not pass it for web-only work. `--slug=<name>` names the release (default: the branch), `--reason=<text>` is recorded, `--rollback` moves `current` back to the previous release.
- The page derives its API address from its own URL, so the build carries no server URL. `VITE_SERVER_URL` is a development-only override.
- `GET /platform/release` reports the served release name, commit and dirty-file count, plus the release the running server bundle came from. That is how "did it land" is answered.
- The procedure lives in `scripts/deploy/`: `mesh.ts` (the command), `live-check.mjs` (the browser check, run by the command; a failure the previous release already had is reported but does not fail the deploy), and `systemd/platform-prod.service` (the unit template, rendered and installed by the command). The mesh route itself is set up once by hand: `mesh serve omarchy 3301 --at /platform --isolate`.
- `ghostty-webgpu` is a `link:` to `/work/projects/ghostty-webgpu`. A change there needs `bun run build` in that repo before the web build picks it up.
- A release's `server/node_modules` is a symlink to the checkout's `apps/server/node_modules`: the bundle resolves language servers and its external packages at runtime. Rolling back a release does not roll back a `bun install`.

## Testing

- Do not run tests unless they are necessary. Before running one, identify the specific plausible failure it could catch; if there is none, skip it.
- Prefer the narrowest relevant test. Do not run a package or repository-wide suite when a focused check, typecheck, lint, config inspection, or diff review proves the change.
- Tests run on Vitest.
- Apps run under Bun: `bun --bun vitest`.
- Runtime-neutral `packages/*` run plain `vitest`.
- Use these environments, in this order of preference: real browser, happy-dom, never jsdom.
- Test projects:
  - `node` — pure logic and in-process server tests. Runs under `--bun`.
  - `dom` — hook and component tests in happy-dom. Runs under `--bun`.
  - `browser` — real layout/paint `*.browser.tsx` tests via Playwright. Runs under plain Node because Vitest browser orchestration breaks under `--bun`.
- In `apps/web` the browser world lives in its own `vitest.browser.config.ts`. Vitest merges Vite-level options such as `define` across the projects of one config file, so a `define` written for the browser project silently rewrites the same constant for `node` and `dom`. Keep the two files separate.
- The `--bun` flag is required for app tests. Without it, `bun:sqlite`, `Bun.spawn`, and other Bun APIs do not resolve. Coverage is the only casualty; we do not use it.

### Use Real App Code

- Import `{ test, expect }` from `apps/web/test/fixtures.ts`, not from `vitest`, for app tests.
- Drive the real in-process Elysia server. The `server` fixture builds `createApp` over a temp workspace. The `client` fixture is a real `treaty` client wired to `app.handle`.
- Do not `mock.module` or `vi.mock` our server, client, or feature modules.
- Production code calls `getClient()` from `@/lib/client`. Tests inject the real client with `setClient`, and restore whatever was installed before rather than resetting to a default — the `dom` project installs a real in-process client for every file in `test/env/dom.ts`, so a reset would hand later tests in the file a socket.
- No test may open a socket to our own server. MSW runs with `onUnhandledRequest: 'error'`, so an escape fails the test that caused it instead of printing a bare `ECONNREFUSED` from Bun's http client.
- Build real state. For example, `git init` a temp repo and write real files, then assert through real routes.

### Mock Boundaries Only

- Mock only the outside world and unspawnable processes.
- Use MSW or injected `fetcher`s for third-party HTTP. Set `onUnhandledRequest: 'error'`.
- Use injectable factories for PTY and LSP child processes.
- Mock serialization edges a real server cannot reproduce, such as Eden `Date` normalization.
- `MockProviderAdapter` is a production adapter, not a test stub. Prefer it over the real Codex adapter, which spawns an external binary.
- Browser tests cannot import the Bun-native server into Node. Spawn the real server as a child `bun` process behind the Vite proxy in `apps/web/test/env/browser-file-server.ts`.
- Node and dom tests import the server in-process.

### Test Hygiene

- Shared test code lives under `test/`.
- Use `fixtures.ts` for `test.extend`.
- Use `render.tsx`; `renderWithProviders` mirrors the app's `main.tsx` provider stack.
- Put shared builders in `test/factories/`.
- Put environment and MSW setup in `test/env/` and `test/msw/`.
- Do not redefine per-file factories.
- Do not hand-roll provider trees.
- Avoid import-time nondeterminism, such as `Math.random()` at module scope. Use deterministic or seedable ids.

### Bun/Vitest Gotchas

- Under Vitest transforms, `import.meta.path` and `import.meta.dir` are `undefined`. `import.meta.dirname` works. Avoid Bun-only `import.meta` fields in code that tests must drive.
- Cold process-spawning tests can exceed Vitest's 5s default timeout. If CI flakes cold, raise `testTimeout` for that project.
- Terminal processes use `@workspace/pty` directly. Run their tests under Bun; terminal input and output are binary WebSocket frames, with JSON reserved for controls.

`tabular-nums` should be the default for any number that updates ( timers, counters, prices, percentages, scores, live data etc ).

you can enable this tnum OpenType feature using the CSS property `font-variant-numeric`.

.tabular-nums {
font-variant-numeric: tabular-nums;
}
