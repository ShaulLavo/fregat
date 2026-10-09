# Repository Guidelines

## Running A Task

- Continue without the owner when possible; pair status notes with the next action. Stop only when blocked or before deleting user data, force-pushing, or removing another session's changes.
- Done means the narrowest relevant check passes, UI changes have reviewed `look` evidence, and your files are committed by path and pushed. Name skipped steps.
- Keep long-run checklists in the plan or scratchpad; tick completed items.
- End with owner needs, changes, then findings. Name unconfirmed facts and where you checked.

## Task-specific skills

Read the applicable skills before writing or reviewing code, or running their workflows:

- React components, hooks, providers, state, or compiler diagnostics: [react-development](.agents/skills/react-development/SKILL.md).
- Web UI and shared UI primitives, including loading, focus, motion, and truncation: [web-ui](.agents/skills/web-ui/SKILL.md). React UI work requires both skills.
- UI verification and performance/render/cache claims: [verify-fregat](.agents/skills/verify-fregat/SKILL.md).
- Owner-host Mesh, deployment, or heavy-job scheduling: read the local `fregat-local` skill when working on that configured integration. Contributor setup follows the repository docs.

## Contributor portability

- Install, development, and verification use documented prerequisites. Hosting tools and machine services are optional, with explicit setup instructions.
- Keep personal hostnames, account endpoints, absolute install paths, and machine scheduling policies in user config or local operating instructions. Repository commands accept targets through arguments or config.
- Preview and file sharing belong to the chosen hosting tool. No repository scripts or package aliases may require the owner's hosting setup.

## Planning ownership

- Root `PLAN.md` schedules all packages and clients. Plans, backlogs, and wishlists live in root `plans/`; package `PLAN.md`, `ROADMAP.md`, instructions, and READMEs link to Fregat's root roadmap.
- Index plans in `plans/README.md`. Run `bun run plans:check` when editing the Editor inventory.
- `docs/` holds architecture, research, and delivery evidence. Execution checklists and work ordering belong in the owning root plan and roadmap.

## Reference Clones

- Upstream clones (vscode, t3code, opencode, codex, …) belong in gitignored root `references/`. Check there before cloning. Tests and `scripts/parity` resolve `references/t3code` relatively; CI skips these checks because it does not fetch the clone.
- Pull outdated clones before use. For pinned upstream commits (Plan 126), record the new head and changes in the plan.

## Code Organization

- Features are leaves. Import shared code from `@workspace/*`, `@/lib/*`, `@/components/*`, `@/hooks/*`, or `@/keymap/*`, never another feature. Frozen exceptions: `scripts/lint/web-feature-allow.json`.
- Feature roots contain only kind directories: `components/` (`.tsx`), `hooks/` (`use-*`), `providers/` (providers and `*-context.ts`), `state/` (stores, also allowed beside their owner), `utils/` (pure, no React or module state), `tests/`. No empty folders.
- Import exact files through `@/`. Barrels only at package entry points (`packages/*/src/index.ts`).
- `apps/web/src/lib/` requires at least two external consumers or a dependency from a qualifying `lib/` module. Count each feature once, plus `components/`, `hooks/`, `keymap/`, and `main.tsx`. Move single-consumer modules down; move them up when a second feature needs them. `lib/` never imports `@/features/*`. Feature-aware policy belongs to its domain; command enablement lives in `keymap/`.
- Each reading feature owns `utils/query-keys.ts`, each writing feature `utils/mutation-keys.ts`.
- Domain-free UI patterns live in `packages/ui/src/patterns/`.
- Matching signatures do not prove duplication: the six `basename` variants differ in empty-path fallback and casing. Merge only with a test per call site.

## Code Style

- Max nesting 3 (the `never-nester` skill): guard clauses, `continue` in loops, no `else` after a return, no nested ternaries.
- Comments explain only what code cannot express: constraints, prevented bugs, or unsafe simplifications. One or two lines; no plan numbers or history.
- Fix readonly/mutable contract mismatches by widening the callee's parameter to readonly; never copy (`[...x]`) to satisfy TypeScript.
- Do not repeat folder names in files or symbols (`workspace/sidebar.tsx`). Rename files, exports, and callers together.
- Greenfield, no users: no compatibility shims, aliases, or migrations. Update all callers, delete obsolete tests, and delete invalidated persisted state rather than healing it.
- No version-skew code. Web app, server, desktop launcher, native hosts and remote machines ship together; when versions differ, things may break until a refresh or restart. Write no fallback, timeout, error path or test whose only purpose is one particular mismatch, and treat review findings that only matter across versions as out of scope. Generic handling that also serves future changes and bugs stays: a bridge that answers every request it cannot read with a structured error is fine.
- Measure performance before and after. Identify whether data layout or design is the bottleneck before tuning.
- Before debugging, prove the observation works on a known-good case. A theory needing a second special case must be re-derived from raw evidence.

## Copy

- Every string the app shows (labels, setting descriptions, tooltips, toasts, empty states, error `message`/`why`/`fix`) says what a thing is and does. Never what it is not: no "rather than", "instead of", "…, not X". Plain negative facts ("No sessions", "Off") are fine. Ellipsis is `…`.

## TUI

- Design `apps/tui` for the terminal, using herdr (https://herdr.dev/) as the reference. Do not port web toasts, notices, dialogs, or layouts merely for parity. Web-plan TUI parity items wait for the upcoming redesign.

## Settings

- Register every knob in `packages/contracts/src/settings/keys.ts` with its consumer. No new env vars or hardcoded tunables. Browser storage may hold view state, such as pane sizes.
- Execution values (binary, env, flag, keybinding) use `application` or `machine` scope, never `window`, because workspace files ship in clones. Suppression-only values may use `window` with the cross-scope indicator.
- Read with `useSettingValue`, or `readSettingsMirror()` outside React. Secrets go to the secret store. Run `bun run settings:reference` after changing the registry.

## Async Effects Go Through TanStack

- Reads use queries, including POST; effects, local work, and code imports use mutations. Outside React, pass the same `mutationOptions` to `runMutation` (`lib/mutations/run.ts`). No bare `await client.x.post()` behind `useState`, promise caches, or local `pending` flags. Read in-flight state through `useIsMutating`/`useMutationState` and the feature's `mutation-keys.ts`.
- Before resolving, mutations settle the cache with response `setQueryData` or `invalidateQueries`, even with socket delivery.
- Serialize concurrent mutation calls with `scope: { id }`; later calls check the earlier result. Configure retries in `retry`/`retryDelay`.
- Imperative reads use `client.query` / `client.infiniteQuery`; `bun run query:check` fails on the deprecated `fetchQuery`, `prefetchQuery` and `ensureQueryData` families.
- Exceptions carry a comment: streaming transports (terminal input, orchestration frames) and intent queues (`runIntent`, `runTreeIntent`, `runWorkspaceMutation`). They still settle the cache.

## Changesets

- Public package behavior and API changes need a patch changeset until launch, including breaking changes. Docs, tests, benchmarks, CI, and internal refactors alone need none.
- Write one to three sentences for someone upgrading the package. Start with Added, Fixed, Improved, Changed, Deprecated, or Removed. Name public APIs in backticks and describe the observed behavior. Keep implementation details and review evidence in the PR. For a breaking change, start with `Breaking:` and say how to update calling code.
- Good: "Added the `DEFAULT_OVERSCAN` export, the default number of rows the editor renders beyond the visible area."
- Bad: "Expose the default row overscan so benchmark tooling can bound retained rows against the editor's viewport policy."
- Good: "Added `scrollbackByteLimit` to limit terminal scrollback by allocated page bytes, including the active screen. `0` clears history and disables further scrollback."
- Bad: "Document scrollback as native page-granular retention and expose its byte budget through core, session, and appearance APIs."
- Follow [Releasing packages](docs/releasing.md) for package selection, version PRs, and local checks.

## Logs And Errors

- Read structured `logs/<date>.jsonl` before forming a theory (`.N.jsonl` continuations, highest newest). Fields: `timestamp`, `level`, `source` (`be`, `client`, `keyboard`), `requestId`, `area`, `version`, `commitHash`. If a failure is unexplained, add missing fields first. Filter with `bun run logs --since 5m`.
- One wide evlog event per operation. Add fields, not lines.
- Never `new Error`. Use feature `structured-errors.ts` (`createStructuredError`, `defineErrorCatalog`) with `code`, `status`, `why`, `fix`. Write `why` and `fix` for user toasts. Put runtime facts (observed vs expected, exit code, state) in `internal`; `bun run errors:census` rejects constant-message errors without them.
- Never put a setting value, file content or secret in a message or `internal`; name the type and constraint.
- Levels: `error` requires action; `warn` means degraded and recovered or abandoned; requested missing files use `info`, no stack. Recovery logs one starting `warn` and one ending `info` with a count, never each attempt. Retry loops, reapers, and sweeps must give up. `bun run logs:census` rejects groups over 50 lines or repeating over an hour; exceptions need a reason in `scripts/lint/log-noise-allow.json`.

## Git

- Preserve pre-existing changes. Use a separate worktree when another session is writing to the checkout.
- Stage your own files by path, commit and push. Never overwrite another session's work or force-push a shared branch. On a rejected push, `git pull --rebase` and push again.

- In a shared checkout, never `git stash`, `reset --hard`, `checkout -- <path>`, `restore`, `clean`, or switch branches. If your file includes another session's edits, commit the whole file and say so.

## Desktop app

- `apps/desktop/src/launcher/index.ts` is the desktop entry point. On machines with registered Mesh dev routes, `bun run desktop:dev` opens those routes; `bun run app:mac` builds the self-contained macOS bundle. Automatic selection uses the native WebKit host on macOS and prefers the installed Chrome app on Linux. Transparent-window mode selects the native system-webview host; an explicit browser executable overrides automatic selection. Native hosts are C on Linux and Objective-C on macOS.
- Installed-browser features work from OS shortcuts without a running launcher or injected globals. Native window transport belongs to the retained host. Production clients share one server per machine/state home; installation reuses its service or registers OS activation. Closing a client leaves shared services and terminals running. [Plan 114](plans/114-installed-app.md) owns these contracts.

## Dev, Gates, Verification

- Follow `README.md` and `docs/development.md` for development setup; Mesh is an optional integration. Browser verification uses an isolated state home. `/dev` is the component gallery; add a tab for anything worth eyeballing.
- A private dev server takes an explicit free `--port` on a known loopback address, and stops after verification.
- Run the narrowest checks that can catch the change's plausible failures. Heavy-job scheduling and resource limits belong to the execution host's local instructions (on the owner's machine, the `fregat-local` skill).
- `bun run gates` (`dupes:functions`, `dupes`, `design:census`, `compiler:census`, `errors:census`, `query:check`, `unused:check`) runs in pre-commit, `verify` and CI. `bun run hooks:pre-commit` is not a dry run: it stages what it fixes.
- Prove changes with the `verify-fregat` skill (`bun run agent:browser look|scenario|trace|renders|caches`); use the evidence directory the command reports. Read the screenshot back and name the directory. Performance claims cite `trace --compare`, render claims `renders` before and after, settlement claims `caches`. Reproduce a bug on its surface before fixing it. A surface with no scenario gets one in `scripts/agent/scenarios/`, selectors in `scripts/agent/selectors.ts`.

## Deployment

- `bun run build-release` builds a portable release anyone can make. Installing one is an optional local integration that needs explicit authorization: `bun run install-release` installs onto the machine target set in `developer.deployTarget` (see `docs/development.md`) and refuses without it. When authorized, verify server changes before installing them and confirm the served release afterwards.
- Desktop windows, browser tabs and remote clients share the machine server. The launcher reuses the recorded service and release; closing or uninstalling a client leaves shared services and terminals running. Packaged service activation and updates follow [Plan 114](plans/114-installed-app.md).
- The release endpoint under the configured base path (`GET <base>/release`) reports the served release, commit and dirty count, plus `pending`, `phase` and `liveCheck` for a staged update.
- Editor packages live in `editor/packages/`; the terminal library lives in `ghostty-webgpu/`. Both are root Bun workspaces mirrored to their standalone repositories. Change their source here, follow each folder's `AGENTS.md`, and run `bun run build:workspaces` before checking consumers. CI builds those workspaces from this checkout.
- A source-checkout release's `server/node_modules` can link to the checkout's installed packages, so rollback does not undo a `bun install`.

## Testing

- Committed tests and verification scripts must run from fresh clones on any machine and in CI. No hardcoded homes, users, hosts, absolute `/work` or `/Users` paths, or machine-only tools. Resolve paths from the checkout, OS temp dir, or settings.
- A test that needs a platform or tool CI lacks skips itself with a stated reason when it's absent, and still passes where it's present. A check tied to a specific host or live account is a one-off proof: run it from a scratch directory, keep the evidence in the evidence directory, and don't commit the script.
- Existing non-portable code keeps `NOT-PORTABLE: <what breaks on another machine>` until fixed; find it with `rg 'NOT-PORTABLE:'`. New code must be portable, without markers.
- Live-provider verification needs explicit authorization (the owner's standing grant is in their local instructions) and stays out of loops, CI and deploy checks.
- Run the narrowest test that catches a specific plausible failure.
- Apps use `bun --bun vitest` (`--bun` for Bun APIs); runtime-neutral `packages/*` use plain `vitest`. Projects: `node`; `dom` (happy-dom, never jsdom); `browser` (`*.browser.tsx`, Playwright, plain Node, separate `vitest.browser.config.ts` to prevent `define` leakage).
- On Arch Linux, run `scripts/playwright-webkit-arch.sh` after any `playwright install` that downloads a new WebKit, before Firefox or WebKit verification (Editor and ghostty-webgpu too).
- App tests import `{ test, expect }` from `apps/web/test/fixtures.ts`, using real in-process Elysia `server`/`client` fixtures and real state (temp repos/files). Never mock our modules. `setClient` restores the previous client. No server sockets; MSW `onUnhandledRequest` records all unhandled frames and fails in `afterEach`, including swallowed requests.
- Mock only external systems: MSW/injected fetchers for third-party HTTP, injectable PTY/LSP factories, Eden `Date` normalization. Prefer `MockProviderAdapter` to real Codex. Browser tests spawn real servers through `apps/web/test/env/browser-file-server.ts`.
- Use shared `test/fixtures.ts`, `test/render.tsx` (`renderWithProviders`), `test/factories/`, `test/env/`, `test/msw/`. No per-file factories/provider trees or module-scope randomness.
- `packages/ui` and `packages/tree` tests run through the React Compiler.
- `import.meta.path`/`dir` are undefined under Vitest; use `import.meta.dirname`. Cold process-spawning tests may need a higher `testTimeout`.
- The nightly `flake-watch.yml` reports flakes; fix them at the cause.

## Content isolation

Sanitized Markdown renders in light DOM with prefixed ids, names and fragment links. Library output that brings its own stylesheets or document ids renders in a shadow root; Mermaid passes source text unchanged and namespaces parsed custom-class identities for light-DOM measurement before displaying its SVG inside the root. Content that can run script renders in a sandboxed iframe with an opaque origin, using `srcdoc` or a blob with `sandbox="allow-scripts"` and no `allow-same-origin`. Images and SVG files render through `<img>`. PDF viewers disable scripting and evaluation. The editor stays in light DOM.
