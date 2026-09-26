# Repository Guidelines

## Running A Task

- Keep going when a step does not need the owner; put status notes in the same message as the next action. Stop only when blocked, or before something destructive: deleting data the owner keeps (`~/.platform`, `/work/platform-dev/home`, anything not yours in `/work`), force-pushing, taking another session's changes out of the tree, or changing anything outside this checkout except `../Editor` and `/work/projects/ghostty-webgpu`.
- Done means: the narrowest check that could fail passes, a UI change has `look` evidence you read back, your files are committed by path and pushed, and the mesh runs it. Name anything you skipped.
- Long runs keep their checklist in a file (the plan file, or the scratchpad) and tick items as they land.
- End a run with what you need from the owner first, then what changed, then what you found. Mark what you could not confirm and where you looked.

## Reference Clones

- Upstream code we compare against (vscode, t3code, opencode, codex, …) lives in `references/` at the repo root, gitignored. Check there before cloning; add new clones there, not in `/work/projects/references/`. Tests and `scripts/parity` resolve `references/t3code` by relative path; CI does not fetch it, so those checks skip there and run locally.
- Pull a clone that is behind before relying on it. If a plan pins an upstream commit (Plan 126), record the new head and what changed in that plan.

## Code Organization

- Features are leaves: import shared code from `@workspace/*`, `@/lib/*`, `@/components/*`, `@/hooks/*` or `@/keymap/*`, never from another feature. Frozen exceptions are in `scripts/lint/web-feature-allow.json`.
- A feature root holds kind directories only: `components/` (`.tsx` render components), `hooks/` (`use-*`), `providers/` (providers and `*-context.ts`), `state/` (stores; co-locating with the owner is also fine), `utils/` (pure, no React, no module state), `tests/`. No empty folders.
- Import exact files through `@/`. Barrels only at package entry points (`packages/*/src/index.ts`).
- `apps/web/src/lib/` holds a module only while two or more consumers outside `lib/` import it (each feature counts once; also `components/`, `hooks/`, `keymap/`, `main.tsx`), or a qualifying `lib/` module depends on it. Move it down when it drops to one consumer, up when a second feature needs it. `lib/` never imports `@/features/*`; policy that needs feature knowledge lives with its domain (command enablement is in `keymap/`).
- Each reading feature owns `utils/query-keys.ts`, each writing feature `utils/mutation-keys.ts`.
- Domain-free UI patterns live in `packages/ui/src/patterns/`.
- Same-signature helpers are not automatically duplicates: the six `basename` variants differ in empty-path fallback and casing. Merge only with a test per call site.

## Code Style

- Max nesting 3 (the `never-nester` skill): guard clauses, `continue` in loops, no `else` after a return, no nested ternaries.
- Comments are one or two lines and say only what the code cannot: a constraint, the bug prevented, why the obvious simplification is wrong. No plan numbers or history.
- Readonly/mutable mismatches are contract bugs: widen the callee's parameter to readonly; never copy (`[...x]`) just to satisfy TypeScript.
- Do not repeat the folder name in file or symbol names (`workspace/sidebar.tsx`). Rename file, exports and call sites in one pass.
- Greenfield, no users: no compatibility shims, aliases or migrations. Update every call site; delete obsolete tests; when a fix invalidates persisted state, delete the state instead of writing healing code.
- Performance: measure before and after. Before tuning, say whether the data layout or design is the real bottleneck.
- Debugging: confirm the thing you are looking for would be observable on a known-good case first. When a theory needs a second special case, drop it and re-derive from raw evidence.

## Copy

- Every string the app shows (labels, setting descriptions, tooltips, toasts, empty states, error `message`/`why`/`fix`) says what a thing is and does. Never what it is not: no "rather than", "instead of", "…, not X". Plain negative facts ("No sessions", "Off") are fine. Ellipsis is `…`.

## React

- One component per file, one hook per file; pure helpers go to `utils/`.
- No prop-drilling of app commands or setters: a prop that is only forwarded, or a command crossing more than two components, gets a narrow provider/hook. Providers expose small domain actions (`selectTab`), not state blobs.
- The React Compiler memoizes the app. Do not add `memo`, `useMemo` or `useCallback` by hand, except where identity is load-bearing: a value in a dependency array, a value passed to a hook (store selector, `useSyncExternalStore` pair), or a ref callback. The compiler's cache may recompute; those keep their manual memo with a comment naming the dependent hook.
- Read what the compiler did; do not infer it. `bun run compiler:explain <file> [--component Name]` prints memo blocks as `[keys] → value`. `bun run compiler:memos [paths…]` classifies each manual memo: `redundant` (delete), `needed`, or `differs` (a missing key is a stale-value bug). Rows are not independent: remove memos one at a time.
- Removing `useMemo<T>(…)` drops its contextual type; write `const value: T = …`.
- `exhaustive-deps` misreads compiler-memoized values. Use `useEffectEvent` when the dep is the action. When the effect truly keys on the value, suppress with `// oxlint-disable-next-line react/exhaustive-deps` and the compiler's keys; the `react-hooks/…` spelling makes the compiler refuse the component.
- `bun run compiler:census` fails on any refused component not excused in `scripts/lint/react-compiler-allow.json`. Repairs: lazily filled ref → lazy `useState`; `try`/`finally` → module-scope function; suppressed deps → `useEffectEvent` with the trigger as an argument; declare handlers after those they call; pass `ref` through JSX, not `createElement`.

## Design Language

`scripts/lint/web-design-census.mjs` enforces most of this; exceptions live in `scripts/lint/web-design-allow.json` with a reason. A case these rules do not cover needs a new token, not a local choice.

- Tailwind classes and `@workspace/ui` primitives only. No raw CSS or inline `style` except runtime-computed values. No raw `<button>`/`<input>` when a primitive exists, and no restyling primitives at the call site (no radius class, no hover on `Button`).
- Colors are theme tokens only: no palette classes, hex or `oklch()`, no hand-rolled `dark:` pairs. Status: `destructive`, `info`, `success`, `warning`; diffs: `diff-added`, `diff-removed`. Tokens take opacity (`bg-success/10`). A missing color goes into `packages/ui/src/styles/globals.css` (`:root`, `.dark`, `@theme inline`).
- Text: `text-foreground` or `text-muted-foreground`, never alpha; disabled controls may use whole-control `opacity-50`. Sizes `text-sm`, `text-xs`, `text-2xs`, `text-3xs`; no `text-[Npx]`. Bar title `text-xs font-medium`, pane section heading `text-sm font-semibold`, group label `section-label`. App words are Inter; code and short metadata (counts, times, hashes, branches, chords, diff stats) are `font-mono`. Updating numbers carry `tabular-nums`.
- Corners: controls, chips, kbd, inline code and skeleton bars `md`; floating surfaces `lg`; pills `rounded-full`; rows, bars, headers, panes and bar tabs square. Bare `rounded` and redundant `rounded-none` are banned.
- Every horizontal bar is `h-(--bar-height) px-(--bar-padding-x)`, ideally `PaneBar`; rails are `w-(--rail-width)`. Skeleton bars use the same token. Spacing uses `--density-*`; there is no `compact:` variant.
- No dividers: surfaces separate by tone (`bg-background` beside `bg-content-well`, chips `bg-muted`, callouts a status tint). No `border-border`, `border-subtle`, `divide-*` or edge borders; `border border-transparent` only as the base for a state color. Panels take `bg-background`, not `bg-card`.
- Pane surfaces follow `--surface-opacity` and are painted once: `ToolPane` paints nothing, the region owning the surface does (sidebar `aside`, chat tool panel, dialog, or a `ToolPane` that is the whole region). `backdrop-material` over wallpaper.
- Floating UI (dialogs, menus, popovers, toasts, tooltips, editor hovers) is opaque: `bg-popover-solid` or `bg-popover`, no blur. Floating surfaces keep `ring-1 ring-foreground/10`. Elevation: `shadow-xl` modal, `shadow-md` menu/popover, nothing else.
- Rows are `ListRow` with `bg-row-hover`/`-active`/`-selected` (no opacity modifier), `aria-selected`, `data-marked`. Lists focus through `useListbox`. Row windowing is `VirtualList`. Toggled controls: `bg-accent` with `aria-pressed`/`aria-selected`.
- Panes compose `ToolPane` + `ToolPaneHeader`, rendering pending before error before empty.
- Icons: `size-(--icon-size)` on controls and headings, `size-(--icon-size-sm)` in rows and text.
- Icon-only controls get a `Tooltip`; inside virtualized rows use `data-tooltip`. Truncated values get a native `title`, never both on one control.
- Scrollbars are one base-layer rule: thin, invisible at rest, shown on hover or focus-within; a call site never styles one. `no-scrollbar` for horizontal strips (census `scrollIdiom`), `scroll-gutter` on a vertical scroller that crosses the overflow threshold while watched, `scroll-fade` (default in `VirtualList`, `ToolPane` bodies, `CommandList`), `scroll-pinned` while a view follows its tail. A `ToolPane` whose body hosts its own scroller or a terminal passes `scroll={false}`.
- A key is drawn by `Kbd` and nowhere else (census `kbdSpelling`). Menus show a shortcut as a trailing chip; a tooltip on an icon-only trigger for a bound command shows it too, via `useCommandShortcut`.
- Physical motion, reduced motion and pointer sounds belong to the shared primitives; a new interactive primitive defines all three. `--shadow-key`/`--shadow-well` live only in `packages/ui` (`none` under Flat). Rows, bar tabs, editors and terminal input stay still and silent. A raw control, including `role="button"`, needs a design allow-list reason and declares its `data-feedback` policy.
- Focus: `focus-ring` (act on), `focus-ring-within` (type into), `focus-ring-inset` (full-bleed scrollers); tint with `--focus-ring-color`, never a `ring-*` class. Opt out with `focus-visible:ring-0`. Inside a wrapper that draws the field ring, use `shadow-none!` and `aria-invalid:ring-0` on the inner control. A new `@utility` that sets `box-shadow` must join the focus class group in `packages/ui/src/lib/utils.ts` (tailwind-merge cannot see custom utilities).
- `pressable` for press feedback. Motion uses the configured defaults (`--duration-enter`/`-exit`, `ease-*-strong`); never hand-write durations or curves. A transition that animates a focus ring must list `box-shadow`.
- Composite fields (leading icon, trailing button or count) are `InputGroup` with addons, never absolute icons over a padded input.

## Loading, Empty And Error States

- Three loaders from `@workspace/ui`, nothing hand-rolled: `LoadingState` (skeleton for a region with no content yet, mirroring the loaded view's primitives, one placeholder per element), `Spinner` (anything else; `size` `xs` rows, `sm` control icon, `md` panel, `lg` surface; none inside `Button`; no `text-*` class), `Shimmer` (inline in a running sentence only).
- Branch on pending before empty; loading and empty must never look alike. Do not defeat `LoadingState`'s 120ms delay or add `motion-reduce:` at call sites.
- A view that switches subjects (selection, commit, session, tab, theme) keeps the old subject whole, header and body, until the new one can paint, then swaps in one frame; the wait is a `Spinner` in the header. Skeletons are for a region's first load. Hold with `useHeldUntilReady` (`hooks/use-held-until-ready.ts`) or `placeholderData` that carries its subject, never with a header from the new subject over the old body; no `key={subject}` on a view whose data loads.
- Render failures: `RenderErrorBoundary` (`@workspace/ui/patterns/render-error-boundary`) at each seam `ToolPane` does not cover, with `resetKeys` set to the shown identity. Local boundaries do not log (the root's `onCaughtError` does). Query and mutation failures stay state; no `throwOnError`. Keep boundaries below anything that must stay mounted (terminals).
- Content that must outlive its layout (terminals) goes through `lib/keep-alive` (`KeepAliveProvider`, `KeepAliveSlot`, `useKeptIds`); kept content sees the provider's context, and stands down via `attached`. Connection notices overlay the retained host (`features/terminal/components/panel.tsx`).
- Observe rendered children with a Fragment ref and `observeUsing` (`editor-tab-bar.tsx`); keep wrappers that own layout. Text in a height-capped `pre` changes its scroll boundary without resizing, so `activity-detail-section.tsx` keeps a mutation observer.

## Truncation

- `truncate`/`line-clamp` on a value the app did not author (path, branch, title, model, host, excerpt) needs a native `title` on the element spanning the row, adding what the row cannot show (full path behind a basename). The census gates this as `truncationRecovery`; `packages/ui` and static labels are exempt.
- No middle truncation: basename first, muted directory second (`components/file-label.tsx`, `basename`/`parentPath` in `lib/path-formatters.ts`).

## Settings

- Every knob is a registry entry in `packages/contracts/src/settings/keys.ts`, registered in the same pass as its consumer. No new env vars or hardcoded tunables. Browser storage may hold per-browser view state, such as pane sizes.
- A value that reaches execution (binary, env, flag, keybinding) is `application` or `machine` scope, never `window`: workspace files ship in cloned repos. Suppression-only values may be `window` and show the cross-scope indicator.
- Read with `useSettingValue`, or `readSettingsMirror()` outside React. Secrets go to the secret store. Run `bun run settings:reference` after changing the registry.

## Async Effects Go Through TanStack

- Reads are queries (even over POST), effects are mutations, including local work and code imports. Outside React, run the same `mutationOptions` through `runMutation` (`lib/mutations/run.ts`). No bare `await client.x.post()` behind a `useState` flag, no promise caches, no local `pending` booleans: in-flight state comes from `useIsMutating`/`useMutationState` via the feature's `mutation-keys.ts`.
- A mutation settles the cache before it resolves (`setQueryData` with the response, else `invalidateQueries`), even when the socket will also deliver it.
- Concurrent calls of one mutation serialize with `scope: { id }`; the second checks the first's result before acting. Retries live in `retry`/`retryDelay`.
- Imperative reads use `client.query` / `client.infiniteQuery`; `bun run query:check` fails on the deprecated `fetchQuery`, `prefetchQuery` and `ensureQueryData` families.
- Exceptions carry a comment: streaming transports (terminal input, orchestration frames) and intent queues (`runIntent`, `runTreeIntent`, `runWorkspaceMutation`). They still settle the cache.

## Logs And Errors

- Structured JSONL in `logs/<date>.jsonl` (`.N.jsonl` continuations, highest newest); fields `timestamp`, `level`, `source` (`be`, `client`, `keyboard`), `requestId`, `area`, `version`, `commitHash`. Read them before forming a theory; if they cannot explain a failure, add the missing fields first. `bun run logs --since 5m` filters.
- One wide event per operation (evlog): add fields, not extra lines.
- Never `new Error`: use the feature's `structured-errors.ts` (`createStructuredError`, `defineErrorCatalog`) so errors carry `code`, `status`, `why`, `fix`. `why` and `fix` reach the user's toast, so write `fix` for them. Runtime facts (observed vs expected, exit code, state) go in `internal`; `bun run errors:census` fails a constant-message error without them.
- Never put a setting value, file content or secret in a message or `internal`; name the type and constraint.
- Levels: `error` means someone must act; `warn` means degraded and recovered or gave up; a missing file the caller asked about is `info`, no stack. A recovering failure series logs `warn` once at its start and `info` with a count at its end, never per attempt. Every retry loop, reaper and sweep has a give-up. `bun run logs:census` fails on noise (a group over 50 lines, or one repeating for over an hour); `scripts/lint/log-noise-allow.json` excuses a group only with a reason.

## Git: One Shared Checkout

- Several sessions work on `main` in this checkout at once; any uncommitted change may be someone else's live work.
- Never `git stash`, `reset --hard`, `checkout -- <path>`, `restore`, `clean`, or switch branches here.
- Stage your own files by path, commit and push. If a file you changed holds another session's edits too, commit the whole file and say so. A rejected push: `git pull --rebase`, push again.

## Dev, Gates, Verification

- The dev server is a mesh route: the first connection to 5173 (Vite) or 3001 (API) starts it, and it stops after the idle window (`developer.devServerIdleMinutes`). Never start one by hand. `mesh serve ls` shows the `:5173` route, `mesh serve stop :5173` restarts it on the next connection, and `bun run dev:serve` registers it on a machine that lacks it. State homes: production `~/.platform`, dev `/work/platform-dev/home`, each `agent:browser` run a temp home. `/dev` (and `/platform/dev` on the mesh) is a component gallery; add a tab for anything worth eyeballing.
- `bun run gates` (`dupes:functions`, `dupes`, `design:census`, `compiler:census`, `errors:census`, `query:check`, `unused:check`) runs in pre-commit, `verify` and CI. `bun run hooks:pre-commit` is not a dry run: it stages what it fixes.
- Prove changes with the `verify-fregat` skill (`bun run agent:browser look|scenario|trace|renders|caches`); evidence lands in `/work/tmp/fregat-evidence/<run>/`. Read the screenshot back and name the directory. Performance claims cite `trace --compare`, render claims `renders` before and after, settlement claims `caches`. Reproduce a bug on its surface before fixing it. A surface with no scenario gets one in `scripts/agent/scenarios/`, selectors in `scripts/agent/selectors.ts`.

## Deployment: The Mesh

- Every finished change ships: `bun run deploy` (web only, reuses the server bundle) or, for server code, verify on the dev server first and then `bun run deploy --server --restart`. `--server` alone stages the build as `/work/platform-production/pending` and the app shows "Update available" until someone clicks Restart; `--restart` sends that button's request itself, waits for busy sessions (`developer.deployRestartWaitMinutes`), promotes, and awaits the live check. `bun run deploy --restart` alone restarts into what is already staged. Inside a Platform chat your own turn counts as busy: add `--interrupt`, which ends it with the restart. `--rollback` drops a staged release and moves `current` back; if the app does not return after Restart, run it from a terminal outside Platform. It serves `https://omarchy.mesh.shaulavo.dev/platform` from `platform-prod.service` on port 3301, private to the owner's Tailscale. The route was set up once by hand: `mesh serve omarchy 3301 --at /platform --isolate`.
- `GET /platform/release` reports the served release, commit and dirty count, plus `pending`, `phase` and `liveCheck` for a staged update.
- `ghostty-webgpu` is a `link:`; run `bun run build` there first. CI builds the Editor at `editor-ref` in `.github/actions/setup/action.yml`; bump it in the same commit when Platform needs newer Editor code.
- A release's `server/node_modules` symlinks to the checkout's, so rollback does not undo a `bun install`.

## Testing

- Run only a test that could catch a specific plausible failure, and the narrowest one.
- Vitest. Apps run `bun --bun vitest` (Bun APIs need `--bun`); runtime-neutral `packages/*` run plain `vitest`. Projects: `node`, `dom` (happy-dom, never jsdom), `browser` (`*.browser.tsx`, Playwright, plain Node, own `vitest.browser.config.ts` because `define` leaks across projects in one config).
- Firefox and WebKit runs on this Arch machine need `scripts/playwright-webkit-arch.sh` after any `playwright install` that downloads a new WebKit (Editor and ghostty-webgpu too).
- App tests import `{ test, expect }` from `apps/web/test/fixtures.ts` and drive the real in-process Elysia server (`server`, `client` fixtures) over real state (temp git repos, real files). Never mock our own modules. `setClient` in tests restores the previous client, not a default. No test opens a socket to our server; MSW uses `onUnhandledRequest: 'error'`.
- Mock only the outside world: MSW or injected fetchers for third-party HTTP, injectable factories for PTY and LSP processes, Eden `Date` normalization. Prefer `MockProviderAdapter` over the real Codex adapter. Browser tests spawn the real server via `apps/web/test/env/browser-file-server.ts`.
- Shared helpers: `test/fixtures.ts`, `test/render.tsx` (`renderWithProviders`), `test/factories/`, `test/env/`, `test/msw/`. No per-file factories or provider trees, no module-scope randomness.
- `packages/ui` and `packages/tree` tests run through the React Compiler.
- `import.meta.path`/`dir` are undefined under Vitest; use `import.meta.dirname`. Cold process-spawning tests may need a higher `testTimeout`.
- The nightly `flake-watch.yml` reports flakes; fix them at the cause.
