# Repository Guidelines

## Reference Clones

- Upstream code we compare against (vscode, t3code, opencode, codex, …) is cloned under `references/` at the repo root, gitignored. Look there before cloning anything, and add new clones there — not in `/work/projects/references/`.
- CI, the parity scripts and several tests resolve `references/t3code` by relative path, so the directory stays inside the repo.
- When a clone you consult is behind upstream, pull it (`git -C references/<name> pull`). If a plan pins an upstream commit (Plan 126 does), note the new upstream head in that plan and anything relevant that changed. Clones refresh as they are used; there is no scheduled sweep.

## Code Organization

- Features are leaves: import shared code from `@workspace/*`, `@/lib/*`, `@/components/*`, `@/hooks/*`, or `@/keymap/*`; never add a feature-to-feature import. Existing exact modules are frozen in `scripts/lint/web-feature-allow.json` with reasons.
- Domain-free UI patterns live in `packages/ui/src/patterns/`; app-specific header menus and actions stay in the app composition layer.
- Each reading feature owns `utils/query-keys.ts`, and each writing feature owns `utils/mutation-keys.ts`; shared key groups stay in `lib/` only while the two-consumer rule holds.
- Feature roots contain kind directories only. Shared helpers move with their callers, and different path or hostname behavior needs a call-site test before consolidation.

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

## Copy

- Copy says what a thing is and what it does, and stops there. Never write what it is not: no "…, not latency", no "rather than" or "instead of" contrast, no disclaimer clause. When the contrast holds a fact, state the fact ("same latency either way").
- A plain negative fact is fine: "No sessions", "Off", "That path is not a folder", a type error.
- Copy is every string the app shows: labels, setting descriptions, tooltips, toasts, empty states, and an error's `message`, `why` and `fix`.

## React Code

- One component per file. Do not export multiple components from one component file.
- One hook per file. Keep hook files focused on the hook and its React wiring.
- Keep pure helpers out of component and hook files. Move formatters, transforms, constants, models, and other pure reusable logic into `utils/`.
- Stores are stateful, so they never go in `utils/`. Where they do live is flexible: `state/`, or co-located with the provider or feature code that owns them.
- Keep providers and context-object modules in `providers/`, not `components/`.
- Do not prop-drill app-level commands, state setters, or callbacks through layout/presentation components. If a prop is only forwarded, or a command crosses more than two component boundaries, stop and add a narrow feature provider/hook or colocate the command with the state owner.
- Keep leaf callbacks as props only when they are local UI behavior owned by the direct parent. Context/provider APIs should expose small domain actions such as `selectTab` or `requestCloseTab`, not broad state blobs.
- Avoid manual React memoization. Do not add `memo`, `useMemo`, or `useCallback` for ordinary render values or callbacks. Use them only for measured performance issues, required stable identity, or correctness. Add a short reason when you do.

## React Compiler: Read The Output, Do Not Guess

- The compiler memoizes this app, and what it chose is a fact you can read. Never reason about it from the source. `bun run compiler:explain <file> [--component Name]` prints every component and hook in the file: whether it compiled, and each memo block as `[keys] → value`, with temporaries resolved to named values.
- `bun run compiler:memos [paths…]` audits every `useMemo` and `useCallback`. It recompiles the file with that one memo removed and compares keys. `redundant` means the compiler picks the same keys, so delete the memo. `needed` means the compiler refuses the component or leaves the value unmemoized without it. `differs` means read both key lists: a coarser compiler key justifies the memo, and a manual list missing a key the compiler found is a stale-value bug. `--undecided` hides the `needed` rows.
- **Compiler memoization is a cache, not an identity guarantee.** It may recompute, so anything whose identity something else keys on keeps its manual memo however exactly the inferred keys match. Three shapes, all of which `compiler:memos` reports as `needed` before it compares keys: a value named in a `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback` or `useImperativeHandle` dependency array; a value handed to a hook as an argument, which is how a store selector and a `useSyncExternalStore` subscribe/snapshot pair reach it; and a ref callback, because React calls the old one with `null` whenever its identity changes. The symptom is not a slow render — it is an effect that re-runs forever, a store that resubscribes every frame, or a DOM registration that detaches and re-registers.
- A manual memo that survives carries its verdict as the reason, and a memo kept for the rule above says so at the site: name the hook that depends on it and what a recompute would redo. `history-pane.tsx` keeps one for a different reason — the compiler keys the diff on the whole viewer `state`.
- Run `compiler:memos` on a file before adding a memo to it and after touching one. Run it on the feature when chasing a render or performance problem, before `renders` or `trace`.
- Each row is measured with that one memo removed and the rest still in place, so a file's rows are not independent. Removing several at once can shift a downstream key that each row on its own said was safe. Remove them one at a time and re-read the file's keys after each.
- `exhaustive-deps` and the compiler disagree by design. The rule reads the source, so it calls a compiler-memoized value "changes every render". When the dep is the action rather than the trigger, `useEffectEvent` is the fix; when the effect genuinely keys on the value, the warning is wrong and the memo does not come back. Silence that last case with `// oxlint-disable-next-line react/exhaustive-deps` and a comment naming the keys the compiler chose. Spelling matters: the compiler's suppression detector watches the `react-hooks/…` alias and will refuse the component over it, while `react/…`, the name this repo actually configures, it does not see. That makes the `react/` spelling an unguarded escape — use it only for a claim you have checked against `compiler:explain` output, never to quiet a rule you have not read.
- Removing a memo drops the contextual type its type argument supplied. Carry `useMemo<T>(…)` over as `const value: T = …`, or the parameters inside it silently become `any`.
- `bun run compiler:census` gates refusals in `verify` and CI: any refused component fails unless `scripts/lint/react-compiler-allow.json` excuses it with a reason. Lint cannot stand in for it, because its compiler rules miss components wrapped in `memo()`.
- Refusals have known repairs. A lazily filled ref or an equal-value ref cache becomes lazy `useState`. A `try`/`finally` moves to a module-scope function or returns a result the caller settles. A suppressed `exhaustive-deps` becomes `useEffectEvent`, with the trigger passed in as an argument so the dependency is still read. Handlers are declared after the handlers they call. JSX, not `createElement`, carries a `ref`.

## Retained Panes And Observation

- Content that survives layout changes uses `lib/keep-alive`. Connection notices overlay the retained host, as in `features/terminal/components/panel.tsx`; hiding a pane does not extend a server resource's lifetime.
- Observe rendered children with a Fragment ref and `observeUsing`, as in `editor-tab-bar.tsx` and the work-log groups. Keep wrappers that own layout. A position-only reorder still needs a layout read; `tab-strip-metrics.ts` schedules one when the tab order changes.
- Text inside a height-capped `pre` can change its scroll boundary without resizing its box. `activity-detail-section.tsx` keeps text mutation observation for that case.
- External-store subscriptions update synchronously. Wrapping a store setter in `startTransition` cannot change that priority. `use-transitioned-color-mode.ts` republishes the visual value into React state before transitioning it.

## Styling

- Rows are `ListRow`: token height, square corners, `aria-selected` selection, `data-marked` inset ring, and immediate hover/press paint. Disabled rows keep title recovery and are skipped by navigation.
- Lists focus through `useListbox`: one container tab stop, `aria-activedescendant`, no wrapping, and modifier chords reserved for the keymap. Typeahead is opt-in; the shadow-root file tree retains its own keyboard model.
- Row windowing uses `VirtualList`, which measures `--density-row-height`; variable message and expanded-log bodies use measured flow layout. Editor line windowing keeps its specialized virtualizer.
- Panes compose `ToolPane` and its `ToolPaneHeader`: `PaneBar` headers, pending before error before empty, and a body focus ring. A terminal's host stays mounted while its loading overlay is visible.
- Icons have two density tokens: `size-(--icon-size)` on controls and headings, `size-(--icon-size-sm)` in rows and text. Never choose a numeric icon size at a call site.
- Text has two colors, `text-foreground` and `text-muted-foreground`; use `text-2xs` for a quieter size, never alpha. Disabled controls may use whole-control `opacity-50`.
- Icon-only controls carry a `Tooltip`; `title` recovers truncated values and never duplicates a tooltip. Tooltip delays belong to the shared provider. Controls inside virtualized rows use `data-tooltip` (the shared layer) instead: a `Tooltip` root per recycled row is a scroll cost.

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
- A surface is painted once. Because it is translucent, a second `bg-background` inside a `bg-background` region reads as an extra layer against the wallpaper. `ToolPane` therefore paints nothing; the region that owns the surface does — the sidebar `aside`, the chat-mode tool panel, a dialog. A `ToolPane` that is itself the whole region (a settings or search editor tab, the bottom panel) carries `bg-background` at the call site.
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
- **No dividers.** Surfaces separate by tone, never by a line: a panel is `bg-background` beside a
  `bg-content-well`, a chip is a `bg-muted` fill, a callout is a status tint. Panels take the
  darker neutral, not `bg-card`: it scrims the wallpaper where a lighter surface veils it, and
  an Omarchy palette derives `card` and `muted` from one color, so a chip only steps on
  `bg-background`. `border-border`,
  `border-subtle`, `divide-*` and any edge border are banned (`hairlines` in the census); a bare
  `border` survives only as `border border-transparent`, the sizing base for a state color such as
  `aria-invalid:border-destructive`. Floating surfaces keep their `ring-1 ring-foreground/10`.
- **Four type sizes.** `text-sm`, `text-xs`, `text-2xs` (11px), `text-3xs` (10px). An arbitrary
  `text-[Npx]` is banned. A bar title is `text-xs font-medium`; a pane section heading is
  `text-sm font-semibold`.
- **Two type voices.** Words the app writes (titles, labels, prose) are Inter (`--font-ui`). Code
  and short metadata are `font-mono`, the user's coding font: counts, timestamps, hashes, branch
  names, setting ids, key chords, line numbers, diff stats. There is one mono, never a second.
  A small uppercase group label is `section-label`, never a hand-rolled `uppercase tracking-*`
  recipe.
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

- Never hand-roll a loader. There are three, they live in `@workspace/ui`, and every waiting state in the app is one of them. No `animate-spin` on a borrowed icon, no `animate-pulse` dots, no bare "Loading…" paragraph.
- Pick by **where the wait is**, not by which feature you are in:
  - `LoadingState` — a region with no content yet (a pane, a list, a popover menu). Skeleton rows.
  - `Spinner` — everything else: a control mid-action, or a process with no known end in a slot beside a label (a header cell, a list row, a status line), or a whole surface waiting. Pick a `size`, never a size class: `xs` in rows and text, `sm` for a control's icon slot, `md` for a panel, `lg` for a whole surface. Leave `size` off inside a `Button` and the button sizes it like the icon it replaced. The spinner owns its colours, drawn from the theme's primary; never put a `text-*` class on one.
  - `Shimmer` — text already on screen, transiently in progress, _inline inside a running sentence_ where a mark would break the flow. Never a substitute for a loader in a slot that can hold one.
- A loading state and an empty state must never look alike. "Loading X" and "No X" set in the same type is a bug — the user cannot tell a slow panel from an empty one. Pending gets a loader; `EmptyState` is only for a verdict the app can actually deliver.
- A skeleton mounts the same primitive and the same density variables as the loaded view, and draws one placeholder per real element. `LoadingState` never wraps a loader.
- Check the fall-through. A list that only branches on `error` and `length === 0` will show "Nothing here" while it is still fetching. Branch on pending **before** empty.
- `LoadingState` holds its bars back for 120ms (`delayMs`) so a fast query does not flash a skeleton. The `role="status"` container mounts immediately either way, so assistive tech is told at once. Do not defeat this with your own conditional.
- Reduced motion is handled inside the primitives — they slow down rather than freeze, because a stopped spinner reads as a hung process. Do not add `motion-reduce:` classes at the call site.
- Ellipsis is `…`, never `...`.

## Render Errors

- Render failures are contained by `RenderErrorBoundary` (`@workspace/ui/patterns/render-error-boundary`, over `react-error-boundary`). Never hand-write a boundary class. `ToolPane` wraps its body in one; the composition layer wraps each seam a `ToolPane` body cannot cover: sidebar panel, editor tab body, each terminal, chat stage, tool pane, timeline row.
- Pass `resetKeys` with the identity of what is shown (tab id, session id, row id) so navigating away heals the region. Retry covers the rest.
- A local boundary does not log. The root's `onCaughtError` reports every caught error once; `onError` is only for fields the root cannot know, such as a fence language.
- Boundaries are for render bugs. Query and mutation failures stay state rendered through `ToolPane`; do not adopt `throwOnError`.
- Keep a boundary below anything that must stay mounted. A terminal unmounted by a sibling's crash detaches its PTY.
- Content that must outlive its layout goes through `lib/keep-alive`: `KeepAliveProvider` above every layout it must survive, a `KeepAliveSlot` where it shows, `useKeptIds` as the only thing that ends it. Terminals use it, so a mode switch, a collapsed panel or another tab parks a terminal instead of unmounting it. Do not re-solve this with `invisible` + `inert` wrappers or collapsed panels. Kept content renders under the provider, so it sees the provider's context, not its slot's; take the `attached` argument to stand down while parked.
- `LoggingErrorBoundary` at the root is the last resort for providers, router and bootstrap.

## Truncation And Recovery

- Truncation is correct in a one-line row, but the cut part must be recoverable. Any element carrying `truncate` or `line-clamp-N` whose content is a value the app did not author (a path, a branch, a session title, a model name, a machine label, a host, a code excerpt) carries a native `title` with the complete value. `scripts/lint/web-design-census.mjs` measures this as `truncationRecovery`.
- The `title` goes on the element that spans the whole row: the row container, or the truncating block when that block is its own full-width row. Never on a `shrink-0` span inside a wider row, and never on the inner text cell of a row whose icon and status columns then recover nothing.
- A title adds, it does not echo. Where the row knows more than it shows (the full path behind a basename, the file and line behind an excerpt, why a tab is read-only), the title says that. A title identical to the visible text is allowed only when the row has nothing to add.
- Static app-authored labels ("Chat", "References", a column header) are exempt, and so is `packages/ui`: a primitive cannot know whether it renders a label or a value, so the consumer sets the title. Every exemption is an entry in `scripts/lint/web-design-allow.json` with a reason.
- `title` and `Tooltip` split by job. `Tooltip` is for icon-only controls and for explanations that need styling and a delay. Native `title` recovers truncated text, where a portalled popup in a virtualized list is the wrong machinery. Do not convert a truncation site to `Tooltip`, and never put both on one control: the browser shows two. A control that already earns a `Tooltip` for an explanation may name its value there too; that is the one direction this runs.
- No middle truncation. A row that must show a path renders the basename first and the directory second, muted, so a right cut eats the directory and leaves the name. `features/git/components/file-row.tsx` is the reference; `basename` and `parentPath` in `lib/path-formatters.ts` are the helpers.

## Settings

- Every user-facing knob is a registry entry in `packages/contracts/src/settings/keys.ts`. Never a new `localStorage` key, never a new env var, never a hardcoded constant someone has to recompile to change.
- A key is never registered inert. Register it in the same pass that wires its consumer, or do not register it — a knob that writes a file nothing reads is worse than no knob.
- Scope is a security boundary. A value that reaches **execution** — selects a binary, sets env, becomes a flag name, or binds a key — is `application` or `machine`, never `window`: a workspace file ships inside a cloned repository. A value that reaches only **suppression** may be `window`, and then it must show the cross-scope indicator.
- Settings are read through `useSettingValue` in React, or `readSettingsMirror()` outside it (module scope, async generators). Do not reach into the query cache directly.
- Secrets never enter the settings document. They go to the secret store, which is why the raw JSON view, export and the settings file itself are safe to read.
- Regenerate `docs/settings-reference.md` with `bun run settings:reference` after changing the registry.

## Async Effects Go Through TanStack

- TanStack owns async operation state, caching, deduplication, and retries, including code imports and local work. Use queries for reads and mutations for effects. Outside React, use QueryClient and MutationObserver APIs; do not build parallel promise caches or pending/error state machines. The streaming and intent-queue exceptions below still apply.

- Every effect that reaches the server or writes state another consumer reads is a TanStack mutation: `useMutation` in React, the same `mutationOptions` executed through `runMutation` in `lib/mutations/run.ts` outside it, which is a `MutationObserver` over the same client. Command handlers, services in `state/`, toast buttons and dialogs are not exempt. A bare `await client.x.y.post()` or `await writeFileContent()` behind a `useState` flag is the thing this rule bans.
- Every mutation carries a `mutationKey` from the feature's `mutation-keys.ts`. That key is how the rest of the app sees the effect: in-flight state is `useIsMutating` / `useMutationState`, never a local `pending` or `saving` boolean, and a `Button` shows `Spinner` from that.
- A mutation settles the cache before it resolves. `setQueryData` with the response when the server returned the new state, `invalidateQueries` on the keys it could have changed otherwise. "It will arrive over the socket" is not settlement; taint the query anyway. The cost of a redundant refetch is nothing, the cost of a stale snapshot is a phantom conflict.
- Two calls of the same mutation while one is in flight never throw "busy". Give them a `scope: { id }` so TanStack runs them serially, and let the second observe the first's result before it decides whether it still has work. VS Code's save sequentializer is the model: join an identical request, queue at most one follow-up.
- A read is a query even when the transport is a POST. Session search and root validation are reads; they get `queryOptions`, a `queryKey` and a `staleTime`, not an ad-hoc abort controller.
- Retries live in the mutation's `retry` / `retryDelay`, not in a loop written inside `onSuccess`. A retry the mutation cache cannot see is a retry devtools, `isPending` and the wide event cannot see either.
- Exceptions exist and each one carries a comment saying why: streaming transports (terminal input, orchestration WebSocket frames), and intent queues that already serialize by resource (`runIntent`, `runTreeIntent`, the workspace-edit lifecycle behind `runWorkspaceMutation`). Those still settle the cache when they finish.

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
- `why` and `fix` reach the client. `responseErrorPayload` puts them on the wire, `createRpcError` carries them through, and `clientErrorDescription` renders message + fix in the toast. A catalog entry's `fix` is the sentence the user acts on, so write it for them, not for the person editing the registry.
- Runtime facts go in `internal`, which evlog keeps out of every HTTP response and our logger writes to the wide event. Attach what the message cannot say: the observed value against the expected one, an exit code, a lifecycle state, which of several identical checks failed. `bun run errors:census` gates this — an error whose catalog `message` is a constant string carries nothing but a code, so throwing one bare is a failure. An entry with a templated message is exempt: it already names its own facts.
- Never put a setting value, a file's contents or a secret in a message or in `internal`. Name the type and the constraint instead (`Expected number, received string`). `apps/server/src/observability/tests/runtime.test.ts` pins it, and the sanitizer redacts a known-sensitive key wherever it is nested.
- Every log line carries `version` and `commitHash` from the running release, so a web build newer than the server is visible in the log rather than only in `GET /release`.

## TypeScript Fixes

- Treat readonly/mutable mismatches as contract bugs first.
- Do not copy containers just to satisfy TypeScript.
- If a callee does not mutate a value, make its parameter or model type accept readonly data.
- Avoid fake fixes like `sizes: [...node.sizes]`. Copy only for a real ownership boundary or real mutation.

## Dev Server

- A dev server is always running; never start another by hand. `agent:browser` starts its own throwaway API server per run against the shared Vite and removes it afterwards.
- `/dev` is a gallery page beside the app (`dev.html`, `features/dev`): the dev server and every release serve it, so the mesh has it at `/platform/dev`. Each tab is `/dev/<tab>`; add one for anything worth eyeballing outside the app, such as every loader in every bundled palette.
- State is separated by `PLATFORM_HOME`: production keeps `~/.platform`, the dev server uses `/work/platform-dev/home` (seeded once from production by `scripts/dev.ts`), and each `agent:browser` run gets a temp home. Language-server and font downloads stay in `~/.platform` for all of them.

## Gates

- `bun run gates` is the whole-tree set a commit must not break: `dupes:functions`, `dupes`, `design:census`, `compiler:census`. It runs in `pre-commit` through lefthook, in `verify`, and in CI, and a test pins all three so a gate cannot exist without being run. Under two seconds together.
- A staged-file lint cannot see a clone, a duplicated helper or a refused component, which is why these run over the tree rather than over `{staged_files}`.
- `bun run hooks:pre-commit` is **not** a dry run. Its fix jobs carry `stage_fixed: true`, so invoking it by hand stages every file they touch. Run the individual gate you want instead.
- `packages/ui` and `packages/tree` run their tests through the React Compiler, because the app that ships them compiles them. Without it a test exercises unmemoized source: manual memoization the compiler makes redundant looks load-bearing, and a value the compiler over-caches never shows up.

## Verification

- The `verify-fregat` skill (`.agents/skills/verify-fregat/`) is how a change is proven in the running app. Its CLI is `bun run agent:browser` with the verbs `look`, `scenario`, `trace`, `renders` and `caches`, and `bun run logs` reads the structured log. Evidence lands in `/work/tmp/fregat-evidence/<run>/` with a `summary.md` short enough to read whole.
- A UI change is not done until you have run `look` (or a scenario) on the changed surface, read the screenshot back, and named the evidence directory in your report. "It typechecks" and "the test passes" do not stand in for looking.
- A performance claim cites `trace <scenario>` before and after, with `--compare`. A "fewer renders" claim cites `renders <scenario>` before and after. A claim about a query or mutation not settling cites `caches`.
- Reproduce a reported bug on the same surface before fixing it, and re-run the same drive after. Hand the reproduction to the user only when the CLI cannot reach the surface, and say why.
- When you touch a surface with no scenario, add one under `scripts/agent/scenarios/` and a line in the feature map. Selectors go in `scripts/agent/selectors.ts`, never inline.
- The dev server is the target. The CLI never starts one; if it is down, say so.

## Deployment: The Mesh

- Every change ships to the mesh once it is done, so a production build is always available to look at. Treat the deploy as the last step of the task, not an extra.
- The mesh is a plain local deployment. Mesh (`mesh serve`) publishes a port on this machine to the owner's Tailscale network, so the production build is reachable from their own devices at `https://omarchy.mesh.shaulavo.dev/platform`. Nothing is public. This is the deployment until a packaged release exists, and it may stay the deployment.
- One route, one `systemd --user` service, one process: `/platform` → port 3301, `platform-prod.service`, running `/work/platform-production/current/server/index.js`, which serves the API and the built web from `current/web`. `current` is a symlink into `/work/platform-production/releases/<UTC stamp>-<commit>-<slug>/`, and every release holds `web/`, `server/`, `build-config.json`, the build logs and the live check output.
- Deploy with `bun run deploy` from the checkout. It builds the web, reuses the running server bundle, verifies the candidate (index.html paths, the wasm artifact, and a boot of the candidate server on a spare port), swaps `current`, and runs the headless live check through the mesh URL.
- Server changes need `bun run deploy --server`, which also builds the server and restarts the unit. `--slug=<name>` names the release (default: the branch), `--reason=<text>` is recorded, `--rollback` moves `current` back to the previous release.
- The page derives its API address from its own URL, so the build carries no server URL. `VITE_SERVER_URL` is a development-only override.
- `GET /platform/release` reports the served release name, commit and dirty-file count, plus the release the running server bundle came from. That is how "did it land" is answered.
- The procedure lives in `scripts/deploy/`: `mesh.ts` (the command), `live-check.mjs` (the browser check, run by the command; a failure the previous release already had is reported but does not fail the deploy), and `systemd/platform-prod.service` (the unit template, rendered and installed by the command). The mesh route itself is set up once by hand: `mesh serve omarchy 3301 --at /platform --isolate`.
- `ghostty-webgpu` is a `link:` to `/work/projects/ghostty-webgpu`. A change there needs `bun run build` in that repo before the web build picks it up.
- A release's `server/node_modules` is a symlink to the checkout's `apps/server/node_modules`: the bundle resolves language servers and its external packages at runtime. Rolling back a release does not roll back a `bun install`.

## Testing

- Do not run tests unless they are necessary. Before running one, identify the specific plausible failure it could catch; if there is none, skip it.
- Prefer the narrowest relevant test. Do not run a package or repository-wide suite when a focused check, typecheck, lint, config inspection, or diff review proves the change.
- Tests run on Vitest.
- PR CI runs Vitest with `retry` at 0; the nightly `flake-watch.yml` runs the web, server, TUI and browser suites five times and posts per-test failure counts as its job summary. Fix a flake it reports at the cause.
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
