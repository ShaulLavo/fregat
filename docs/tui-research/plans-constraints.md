> Historical research from before Plan 068. The implemented domain and current contracts are
> documented in [Session domain](../session-domain.md) and [Federated environments](../federated-environments.md).
> References to the deleted federation plan below are historical; its final text is available with
> `git show ade95c26:plans/078-federated-environments.md`.

# plans-constraints — what the plans and docs impose on a new (TUI) front end

Read on 2026-09-05 at HEAD `e9cfba70` with a large uncommitted working tree (Plan 077 mostly
implemented but not closed; Plan 056 implemented; an operator-owned "application runtime"
refactor). Every claim below is cited to a file and line in `/work/projects/platform`.

---

## (a) Constraints and invariants a NEW front end must honour

### A1. Authority chain — a TUI plan cannot authorise itself

- `PLAN.md:8-11`: "This file is the sole source of cross-project execution order. `plans/README.md`
  is the Platform executable-plan inventory. Strategy documents under `docs/` describe product scope
  but do not authorize implementation. A completed executable plan is deleted after its checks pass."
- `plans/README.md:3-9`: "Only unfinished implementation plans live in this directory … This index
  lists executable plans only; it does not define a second roadmap."
- Every executable plan carries the STOP condition "Root `PLAN.md` has not scheduled this plan"
  (`plans/077:429`, `plans/068:1003`, `plans/078:588`, `plans/069:975`). A `plans/079-tui-*.md`
  is inert until a `PLAN.md` lane entry names it.

### A2. Product shape: agent view is the root, IDE is pushed, no toggle, no "current project"

- `docs/product-vision.md:12-13`: "A chat-first agent app is the face of the product. The full IDE
  workbench … becomes a **pushed navigation state** behind it."
- `docs/product-vision.md:26-35` — the navigation stack: root = agent view (sidebar of chats,
  terminal sessions, projects, cross-project); pushed = IDE mode entered from a project/worktree
  row with a back button; "There is **no toggle and no "current project" setting.** IDE mode
  inherits its project from the row it was entered through."; "Layout persists per project."
- `docs/product-vision.md:119-124` non-goals: "A "current project" global or an IDE/agent toggle,
  in any form." Also no unified cross-harness history, no simultaneous dual-frontend driving, no
  Orca compare view ("data model must permit, nothing may build it yet").
- Consequence for a TUI: the TUI root screen is the cross-project rail; an "IDE" screen (tree /
  editor / diff) is a pushed state keyed by the row it came from; the TUI may not persist a global
  active project and may not add a mode toggle.

### A3. Session model and ids (product vision + Plan 068)

- `docs/product-vision.md:42-47`: "A **session** is one agent conversation. Some wear a chat face
  …, some wear a terminal face (a CLI agent in a PTY). Both appear in the sidebar." "**One id, two
  doors.** … a session started in the GUI can be reopened in a raw terminal and vice versa."
- `docs/product-vision.md:92-93` invariant 4: "**Cross-frontend session ids.** Where a harness
  supports it, the session id is the shared key between GUI and terminal; never fork per-frontend
  session identity."
- `docs/product-vision.md:51-54`: "Simultaneous dual-drive of one session is out of scope
  permanently. Handoff-by-resume is the bridge." JSONL tailing is "an opportunistic garnish … never
  load-bearing."
- Plan 068 locks the ids (`docs/session-domain.md`): "`ProjectId`, `WorktreeId`,
  and `SessionId` are branded RFC 4122 UUIDs … `SessionId` replaces `ThreadId` everywhere. No domain
  ID accepts separators, dot segments, `thread-`, or provider prefixes. Do not add
  `type ThreadId = SessionId`, deprecated exports, old event decoders, redirect routes, or dual
  table reads." "A GUI bootstrap client-mints one `SessionId`; the server validates and adopts it."
  "A CLI argv builder returns `['claude', '--resume', sessionId]` with no prefix."
- `plans/068:220-229` name table: `SessionId` (raw UUID) vs `ProviderBindingHandle`
  (`claude:<uuid>`) vs `ProviderConversationMarker` vs `ProviderResumeCursor`. "Never pass a
  binding handle or conversation marker to Claude resume."
- Today (pre-068) the id is `thread-<uuid>` and the address layer rejects anything else
  (`apps/web/src/features/address/utils/session-token.ts:8-9,63-70`). A TUI written now would be
  written against `ThreadId`, and 068 deletes that vocabulary with no alias.

### A4. Topology: Project 1-N Worktree 1-N Session, branch/path live on the worktree

- `docs/product-vision.md:58-64`: "`project (repo) 1 ─── N worktree 1 ─── N session`"; "The
  **worktree is a property of the session**, chosen at creation ('send to current branch' vs 'new
  worktree') and shown as a chip."
- `plans/068:242-283` domain records (`Project`, `Worktree`, `Session`): "every session has a
  non-null `worktreeId`" (`:151-153`); "Branch and path live only on `Worktree`. Do not copy them
  back onto `Session`. Add one server-side session → worktree → project resolver and one equivalent
  web selector; provider cwd, terminal cwd, checkpoints, diffs, file tools, Git tools, and address
  restoration use those owners." (`:334-337`).
- `plans/068:1008-1010` STOP: "Any proposed design keeps nullable `worktreeId`, keeps branch/path on
  session, aliases ThreadId, writes projections directly, or adds a parallel session database."
- `plans/069:187-201` creation target: `SessionWorktreeTarget = {kind:'current', worktreeId} |
{kind:'new', worktreeId, baseWorktreeId}`; "The client sends IDs and intent only. It never
  predicts a filesystem path or trusts a branch name." (`:214-215`). "Terminal-open contracts carry
  `worktreeId`, never a browser-supplied path" (`plans/068:806-808`).
- Repository identity is machine-independent (`plans/068:284-295`): `Project.repositoryKey` from
  normalized `origin` remote → root commit → canonical path; `ProjectId` = UUIDv5 of it; "the browser
  never treats a bare `ProjectId` as unique."

### A5. Environment identity and scoped refs — every client map is keyed by `(environmentId, id)`

- `docs/environments-and-remote-plan.md:34-38`: "An environment is one running backend server
  process, reachable at one origin, owning one SQLite database and one filesystem view of one
  machine." "User-facing copy says **machine**; code says `environmentId`."
- `docs/environments-and-remote-plan.md:55-63` (and landed in the tree, see D1): singleton
  `environment_identity` row; `environmentId` in the WS handshake and `/health`; "the client refuses
  a handshake whose `environmentId` differs from the one it recorded for that origin (identity
  drift)." `/health` = `{ ok, environmentId, label, protocolVersion, serverVersion, platform:{os,arch},
...fs.info() }`; "No unauthenticated descriptor exists."
- `plans/068:358-366` Environments: "The server knows nothing about other machines … `environmentId`
  never enters a domain record or a command." "Add to `packages/contracts/src/chat-ids.ts`:
  `ScopedProjectRef`, `ScopedWorktreeRef`, `ScopedSessionRef`, with `scopedProjectKey(ref)` and
  friends returning `${environmentId}:${id}`. These are browser routing keys, not identities."
- `plans/068:371-386`: the projection store becomes `{ slices: Record<EnvironmentId,
ChatProjectionSlice> }`; "Writers take the `environmentId` of the transport that produced the
  item"; the rail model folds every slice, emits `environmentId`, `machineLabel`, `projectGroupKey`.
- `plans/068:996-998` STOP: "Any proposed web store, rail model, selector, or address token assumes a
  single implicit environment, or keys a cross-environment map by a bare `ProjectId`/`WorktreeId`."
- A TUI must therefore key its own in-memory state by scoped refs from day one, even if it connects
  to one server.

### A6. Transport ownership — one closable `ChatTransport` per origin, no import-time singletons

- `plans/077:96-106` Outcome: "no module captures an origin at import time"; "Chat has one
  `ChatTransport` per environment, created by a factory, closable, and holding its own RPC client,
  detail-subscription cache, and earlier-page loader"; "Query cache is one `QueryClient` per
  environment"; "Auth refusal on the WS upgrade is an explicit `1008`."
- `docs/environments-and-remote-plan.md:139-148`: "**Chat is federated.** One `ChatTransport` per
  connected environment … **The workbench is single-homed** … **A running turn never migrates.**"
- The transport interface (landed, untracked): `apps/web/src/features/chat/transport/chat-transport.ts:16-33`
  — `closed`, `close()`, `retainThreadDetail`, `loadEarlierPage`, `dispatchCommand`,
  `replayEvents`, `shellStream`, `threadDetailPage`, `threadDetailSnapshot`, `threadDetailStream`.
- `PLAN.md:88-89`: "Plan 077 overlaps the global client, query, and chat transport seams; serialize it
  with any other work on `apps/web/src/lib/client.ts` or the chat transport."
- Settings reads stay on the primary environment (`plans/078:131-134`;
  `docs/environments-and-remote-plan.md:171-177`).

### A7. Wire protocol a TUI must speak (server is truth; commands → events → projections)

- Architecture spine is authoritative even where product shape changed:
  `docs/product-vision.md:111-114` "Its architecture spine (events, projections, receipts, recovery)
  remains authoritative." `docs/t3code-reference.md:10-14` "the backend the source of truth …
  React Query is used for side reads, not as the chat transcript cache."
- Non-negotiable shape (`docs/t3code-reference.md:566-574`): "backend is source of truth; chat
  transcript is not React Query state; sidebar receives shell state, not full detail; active/prewarmed
  threads receive detail state; pending approvals/user input are backend-owned facts; provider
  instance ID is distinct from provider driver kind; all large caches have bounds."
- `docs/t3code-parity-implementation-plan.md:1966-1972`: "Do not parallelize these before the
  contracts settle: decider command/event names, projection table schema, shell/detail snapshot
  shapes, provider session runtime shape." Plan 068 is exactly that contract cutover.
- Concrete protocol (`packages/contracts/src/orchestration-ws.ts`): `ORCHESTRATION_WS_PROTOCOL_VERSION = 4`
  (`:32`, bumped in the working tree); requests `dispatchCommand | threadDetailPage | replayEvents |
serverConfig` (`:129-153`); subscriptions `subscribeShell | subscribeThread` with `afterSequence`
  resume cursor (`:155-176`: "`0` means 'no cursor' and always yields a snapshot … the server emits a
  `synchronized` frame once the client is caught up to live"); `unsubscribe`, `ping`; server
  messages `connected | response | subscription.next | subscription.error | subscription.complete |
pong` (`:241-320`). Replay is capped at `ORCHESTRATION_REPLAY_MAX_EVENTS = 1_000` and resume gap at
  `ORCHESTRATION_RESUME_MAX_GAP = 1_000` (`:40,48`). The handshake is pushed by the server
  (`apps/server/src/orchestration/ws-rpc.ts:108-116`).
- HTTP side-reads exist for the big one-shot bodies: `/orchestration/shell-snapshot` and detail
  snapshot (`apps/server/src/orchestration/routes.ts:80-91`), plus `/git/*`, `/fs/*`, `/settings*`,
  `/terminal` (WS), `/lsp` (WS), `/health` (`apps/server/src/app.ts:196-229`).
- Receipt semantics (`plans/068:439-467`): receipt aggregate follows the initiating command family
  (`project.* → projectId`, `worktree.* → worktreeId`, `session.* → sessionId`); "A duplicate
  `commandId` must parse and return the identical full payload after engine/process restart";
  accepted receipts carry a non-null `resultSequence`, rejected carry null. A TUI must mint
  `commandId`s deterministically for retries and treat `deduped` results as success, exactly as the
  web does (`apps/web/src/features/chat/utils/command-builders.ts` is the pure builder to reuse).
- Sidebar state is server-projected (`plans/068:339-356`): `needs-input | working | settled` with
  `attentionReason` and `hasError`; "Delete the browser-only competing reducer" — i.e. the current
  `apps/web/src/features/chat/utils/thread-status.ts:12-33` (`waiting|working|failed|idle`) is
  slated for deletion. A TUI must not re-derive status client-side.

### A8. Settings scopes and persistence ownership

- `AGENTS.md:86-91`: "Every user-facing knob is a registry entry in
  `packages/contracts/src/settings/keys.ts`. Never a new `localStorage` key, never a new env var,
  never a hardcoded constant." "Scope is a security boundary. A value that reaches **execution** …
  is `application` or `machine`, never `window`." "Settings are read through `useSettingValue` in
  React, or `readSettingsMirror()` outside it."
- The server owns the settings document (`apps/server/src/settings/routes.ts:37-58`: `GET /settings`,
  `POST`, `GET /settings/events` stream, `/settings/raw`). Web reads via
  `apps/web/src/features/settings/hooks/use-setting-value.ts:11` and
  `apps/web/src/features/settings/utils/boot-mirror.ts:69`. A TUI has no `localStorage`; it must
  read the same server document and must not invent a dotfile knob.
- Keybindings are a settings key with chord grammar landed in the tree:
  `packages/contracts/src/settings.ts:108-122` (`MAX_KEYBINDING_CHORD_STROKES = 2`,
  `keybindingChordSchema`), registry entry `keybindings.overrides` at
  `packages/contracts/src/settings/keys.ts:~600-608` (`merge: 'record'`). A keyboard-centric TUI
  should bind through this key rather than a second binding store.
- Per-environment client persistence is scoped by a namespace, not by key rewriting
  (`docs/environments-and-remote-plan.md:116-126`; `plans/078:207-224`): `environmentScopedStorage
(environmentId)` prefix `env:${environmentId}|`; global chrome stays unscoped; "No migration: the
  developer clears site data once." Plan 078 adds exactly one new localStorage key
  (`platform.environments.connected.v1`, `plans/078:151-155`). The full list of localStorage owners
  is `rg -l localStorage apps/web/src` (26 files, e.g. `lib/workspace-cache-storage.ts`,
  `features/chat/state/chat-projection-cache.ts`, `features/address/state/storage.ts`). A TUI needs
  an equivalent namespaced store on disk and must follow the same "no healing" rule
  (`AGENTS.md:93-97`).

### A9. Addressable state and one diff component

- `docs/product-vision.md:85-89` invariants 1-2: "**One diff component.** Inline, side-pane, and IDE
  renderings are one component (`editor-diff`-based) in three containers." "**Addressable IDE
  state.** IDE mode is reachable by link — project + worktree + panel + target (file/line) — not just
  'open'. Every escalation button is a link, not a mode switch."
- The address grammar is `/~<workspace-slug>/<mode>/<document-token>?<view params>#<position>`
  (`apps/web/src/features/address/utils/grammar.ts:3-16`), modes `chat | workbench` (`:19`), closed
  `Address` record (`:36-59`). Plan 068 adds an optional leading `@<environmentId>` segment
  (`plans/068:392-396`): "`parseAddress` rejects an unknown environment as a rejected token, never a
  fallback to primary."
- A TUI cannot render `editor-diff` (a DOM component), so "one diff component" is a constraint the
  TUI plan must explicitly reconcile (see open questions); addressability, however, is directly
  portable: the TUI should accept and emit the same address string.

### A10. Auth and network boundary — the server is browser-only today

- `apps/server/src/auth.ts:43-86`: the guard is an exact `Origin` allowlist; `localBrowserOriginError`
  returns `UNAUTHORIZED` when there is **no** `Origin` header (`:75-76`) and `FORBIDDEN_ORIGIN` when it
  is not listed. WS upgrades use the same check on `data.headers.origin` (`:67-69,88-94`). Comment at
  `:96-103`: "This guard is the origin allowlist and nothing else … There is no token mode."
- `apps/server/src/index.ts:25,29,133-137`: `SERVER_ALLOWED_ORIGINS` env and `assertLoopbackHost`
  refusing anything but `localhost|127.0.0.1|::1`. `PLAN.md:91-92`: "Nothing in this lane binds a
  server off loopback."
- Pairing/sessions/tokens are explicitly deferred "until a client that cannot SSH exists"
  (`PLAN.md:84-87`; `docs/environments-and-remote-plan.md:185-188`; refused reference behaviours
  `:274-287`).
- A TUI process (Bun `fetch`/`WebSocket`) sends no browser `Origin`. It must either present an
  allow-listed origin header deliberately or the plan must add a non-browser principal. The
  web tests already do the former: `apps/web/test/server.ts:16-17` "Origin the in-process client
  presents; the app's auth guard requires a trusted origin".
- Every request should carry `x-client-instance` (`apps/web/src/lib/instance-id.ts:8`) so server
  logs attribute the TUI (`apps/server/src/app.ts:192-194` `recordClientInstance`).

### A11. Code and quality rules the plan's phases will be judged by

- `AGENTS.md:5-18` feature/kind layout, `@/` imports, no barrels except package entry points.
- `AGENTS.md:22-28` never-nester (depth ≤ 3, guard clauses, no `else` after return, no nested ternaries).
- `AGENTS.md:93-97` greenfield: no shims, no aliases, no migrations of persisted state.
- `AGENTS.md:121-128` wide-event evlog logging; "Never throw `new Error`"; feature `structured-errors.ts`.
- `AGENTS.md:137-139`: "A dev server is always running. Never spin up your own server."
- `AGENTS.md:141-192` testing: Vitest; `bun --bun vitest` for apps; real in-process Elysia server via
  `createApp` (`server/testing` entry, `apps/server/src/testing.ts:1-19`); "No test may open a socket
  to our own server"; mock only outside world and unspawnable processes; injectable PTY factories.
- `AGENTS.md:71-82` loading primitives and `AGENTS.md:47-67` styling are web-specific but the
  _policy_ (loading ≠ empty; pending before empty; `…` not `...`; `tabular-nums`) transfers.
- `lefthook.yml` pre-commit runs `oxfmt`, `oxlint`, and a repo-wide `bun run typecheck`
  (`package.json:33` runs `--sequential --filter '*' typecheck`), so a new `apps/tui` workspace must
  typecheck clean or block every commit.
- Workspace membership: `package.json:5-12` lists `apps/*`, so `apps/tui` is picked up automatically;
  `turbo.json` `globalEnv` includes `VITE_SERVER_URL`.

---

## (b) Where a TUI plan must sequence relative to 077 / 068 / 078 / 069, and why

**Ordered lane today** (`PLAN.md:66-92`, `plans/README.md:16-31`): 077 (READY, mostly landed in the
dirty tree) → 068 (BLOCKED ON 077, environment-aware rewrite) → 078 (BLOCKED ON 077 AND 068) → 069
(BLOCKED ON 068 AND ROOT SCHEDULING, single-machine).

### Hard dependency: after 068 for anything session-shaped

- 068 renames the entire product vocabulary and wire shape with no compatibility layer:
  `plans/068:96-111` Outcome 2-5 ("No `ThreadId`, `thread.*` command/event, thread projection table,
  or compatibility alias remains"; shell snapshots gain `worktrees`); `:601-605` "Bump the
  orchestration WS protocol version because snapshot, command, event, and delta shapes are
  intentionally incompatible"; `:870-876` a vocabulary test that fails on any handwritten
  `ThreadId`/`thread.*` residue in "contract, orchestration, provider, chat/chat-mode, and address
  source" — an `apps/tui` written against today's contracts would be a second consumer to rewrite,
  and the plan explicitly forbids "temporary aliases to make those consumers compile early"
  (`:596-598`).
- 068 also moves status to the server (`:339-356`) and makes discovery/`origin: 'discovered'` the
  source of terminal-born rows (`:403-437`) — the exact rows a TUI rail wants. Building rail state
  before 068 means re-deriving what 068 deletes.
- Therefore: **a TUI plan that renders sessions, projects, or the rail must be scheduled strictly
  after 068 is deleted from `plans/`**, and its drift preamble should include
  `test ! -e plans/068-session-domain-model.md` exactly as 069 does (`plans/069:35`).

### Soft dependency on 077: reuse, do not re-implement

- 077 is where "the word 'environment' is free for machines" and `ChatTransport` gets `close()`
  (`plans/077:101-103,203-226`). The TUI's connection layer should consume `createChatTransport
(origin, { createSocket })` (`apps/web/src/features/chat/transport/create-chat-transport.ts:42-45`,
  socket injectable at `orchestration-rpc-client.ts:54-60`) or a package extracted from it, not a
  third RPC client. `PLAN.md:88-89` requires serializing anything touching `lib/client.ts` or the
  transport with 077 — so the TUI plan must not edit those files while 077 is open.
- If the TUI plan needs a shared, DOM-free client package (RPC client + projection writers + command
  builders), that extraction is itself a change to 077's seams and to 068's Phase 5 targets
  (`plans/068:744-760` renames `chat-projection-*`, `thread-detail-subscriptions`, etc.). Extracting
  before 068 creates a second place 068 must rewrite; extracting after 068 is one move.

### Relationship to 078 (federation) — parallel-safe if the TUI stays single-environment

- 078 owns Machines settings, SSH launcher (desktop-only, `plans/078:170-173`), N transports, scoped
  persistence, rail chips/filter. The TUI plan should declare "one environment, shapes for many"
  exactly as 068 does (`plans/068:20-23`) and leave machine chips/filters/reconnect coordinator to a
  later TUI slice after 078. 078's `EnvironmentTransportsProvider` replaces the current
  `active-transports.ts` reset-the-world behaviour (`plans/078:362-366`), so a TUI must not depend on
  `closeChatTransportsForEnvironmentSwitch()` semantics.
- Note 078 assumes SSH is desktop-only ("web (non-desktop) SSH" is out of scope, `:96-97`). A TUI
  runs in a shell and could own its own `ssh -L`; that is a new decision for root `PLAN.md`, not
  something the TUI plan may assume.

### Relationship to 069 (worktree lifecycle)

- 069 adds `SessionWorktreeTarget`, `WorktreeChip`, cleanup commands, and the "Send to current
  branch / New worktree" picker (`plans/069:187-236,466-483`). Until 069 lands the TUI can only
  create sessions on the protected current worktree; its composer should be shaped so the picker is
  an additive phase. 069 is "P0 after Plan 068" but "Root `PLAN.md` has not scheduled it yet"
  (`plans/README.md:53-56`).

### Recommended sequencing statement for the TUI plan's Status block

"Dependency: Plan 077 complete and deleted (transport/identity seams), Plan 068 complete and deleted
(session vocabulary, scoped refs, server-projected attention). Single environment; shaped for many.
Plan 078 and Plan 069 are not prerequisites; their TUI surfaces are later slices. Requires root
`PLAN.md` scheduling." Numbering: highest existing is 078, so the next id is **079** (070/072 were
consumed and deleted; numbers are never reused, `plans/README.md:3-4`).

---

## (c) Executable-plan format conventions a `plans/079-tui-*.md` must follow

Derived from 077/068/078/069 (all four share the same skeleton) and `plans/README.md`.

1. **H1 title**: `# Plan 0NN: <imperative outcome sentence>` (`plans/077:1`, `plans/068:1`).
2. **Executor blockquote** immediately after the title (`plans/077:3-8`): "Read this plan completely,
   then read `AGENTS.md`, root `PLAN.md`, `<strategy doc>`, and the never-nester skill. Execute the
   phases in order. Keep the current worktree; do not create a branch, worktree, commit, push, or PR
   unless the operator asks. Preserve all user-owned dirty files. Reuse the running dev server; a
   second local server started for verification must use a distinct `PORT` and `FS_METADATA_DB`."
3. **`## Status` bullet block** with exactly these keys (`plans/077:10-23`, `plans/068:9-29`):
   `State`, `Priority`, `Effort` (S/M/L/XL), `Risk` (LOW/MEDIUM/HIGH + why), `Category`
   (077 only; optional), `Platform baseline` (a commit hash), `Prepared` (date), `Dependency`,
   optionally `Adjacent landed contract`, `Environment-aware since`, `Known dirty baseline`
   ("Re-run `git status --short`; do not add, rewrite, delete, stash, or absorb any unrelated path").
   Followed by the sentence "Root `PLAN.md` is the sole execution-order authority." (`plans/077:25`).
   State vocabulary used in `plans/README.md:16-31`: `READY — …`, `BLOCKED ON 0NN — …`,
   `PROPOSED — ROOT GO/NO-GO SCHEDULING`, `NEXT — …`, `IMPLEMENTED — BROWSER VERIFIED`.
4. **`## Drift-check preamble — this is the audit`** (`plans/077:27-44`): a `sh` block starting
   with `git rev-parse HEAD` and `git status --short`, then `rg -n` anchors, then an
   "Expected before work:" sentence with counts, and "If any anchor below has moved, fix the anchor
   first; do not implement from a stale line." 068/069 add `test ! -e plans/<prereq>.md` and
   `if rg …; then exit 1; fi` proofs that the prerequisite landed (`plans/068:35-50`, `plans/069:32-46`).
5. **`### Product and architecture locks`** citing `docs/*.md:line-line` (`plans/068:56-75`).
6. **`### Verified current source`** — bullets of `path:line` facts (`plans/077:46-90`), ending with
   "If these claims no longer hold, revise the phases … Do not trust the implementation-status prose
   in either strategy document." (`plans/068:146-148`).
7. **`## Outcome`** — "After this plan:" numbered list, then "Not in this plan: …" (`plans/077:92-111`).
8. **`## Locked design`** with `###` sub-sections, `ts` type blocks, exact names, exact copy strings
   (`plans/069:225-227` quotes the user-facing labels).
9. **`## Scope`** → `### In scope` / `### Out of scope` (`plans/077:245-262`); 069 adds
   `### Post-068 owner map` (`plans/069:490-508`).
10. **`## Git and state policy`** (`plans/077:264-270`): worktree preservation; "No migration of
    browser state … ship nothing that does it"; errors via `defineErrorCatalog`/`createStructuredError`;
    "Never `new Error`."
11. **`## Phase N — <name>`** each with `### Work` (numbered) and `### Verify` (a `sh` block of the
    narrowest `bun --bun vitest run --project node --project dom <files>` + `bun run typecheck` +
    grep tripwires `if rg -n "…" src; then exit 1; fi`) and an "Expected:" paragraph
    (`plans/077:272-303`). Lockstep intermediate phases say "do not commit or deploy this
    intermediate subphase" (`plans/068:602-604`).
12. **Final vertical gate phase** creating one integration test on `apps/web/test/fixtures.ts` with
    two `makeTestServer()` instances where environments matter (`plans/077:381-410`, `plans/068:911-941`),
    plus a by-hand check against the running dev server, ending with `git diff --check && git status --short`.
13. **`## Done when`** — checklist of observable end states, last item "All phase verification
    commands pass and baseline-delta review shows only intended changes." (`plans/068:979-1000`).
14. **`## STOP conditions`** — "Stop and ask the operator if:" first item "Root `PLAN.md` has not
    scheduled this plan." (`plans/077:425-436`); include settings-without-consumer, loopback, and
    architecture-violation stops.
15. **`## Maintenance`** — "If anchors move before execution, update the drift preamble and phase
    paths first. When complete, delete this plan, update `<strategy doc>` §N, and replace the
    `PLAN.md` lane entry …; git history is the archive." (`plans/077:438-442`).
16. **Verification rules** (`plans/README.md:11-13`, `PLAN.md:94-104`): "Verification uses
    per-workspace baseline deltas; never gate completion on an absolute test count or a bare root
    `bun run verify`." Environments verification: "two isolated in-process or loopback servers and
    distinct databases … No test or demo binds non-loopback."
17. **Registration**: add a row to the `plans/README.md` inventory table and a bullet under
    "Dependency notes"; add a `PLAN.md` lane entry (or an explicit "not yet scheduled" note) — the
    README says it "does not define a second roadmap" (`plans/README.md:8-9`).
18. **Style**: sentence-case bold keys, `—` dashes, `…` ellipsis, backticked paths with line ranges,
    no emoji, tables only for locked name/meaning maps (`plans/068:220-227`, `:443-449`).

---

## (d) What is mid-flight in the working tree that a TUI plan must not collide with

`git status --short` at HEAD `e9cfba70`: 169 tracked files changed (+2876/−2455), 47 untracked
paths, one stash (`stash@{0}: On main: pre-push Platform mirror 2026-08-27`). Three overlapping
streams:

### D1. Plan 077 — implemented but not closed (the largest stream)

Landed and consistent with `plans/077` Locked design:

- Server identity: migration 10 `environment_identity` (`apps/server/src/db/migrations.ts:39,519-530`),
  table (`db/schema.ts:15-20`), `readEnvironmentIdentity` (untracked
  `apps/server/src/db/environment-identity.ts:5-18`, structured error `db.ENVIRONMENT_IDENTITY_INVALID`).
- Handshake carries `environmentId`, protocol **4**, `1008 'unauthorized'` close, wrapper forwards
  code/reason (`apps/server/src/orchestration/ws-rpc.ts` diff: `:44-48`, `:103`, `:474-475`;
  `packages/contracts/src/orchestration-ws.ts:30-32,224`). WS routes moved **before** `authGuard`
  in `app.ts:195-197` ("Auth runs after the WS upgrade so the browser receives the explicit 1008").
- `/health` descriptor (`app.ts:199-211`) and `healthDescriptorSchema` (untracked
  `packages/contracts/src/health.ts`, exported from `index.ts:313`).
- Web client registry: `apps/web/src/lib/client.ts` now `createEnvironmentClient`,
  `activeServerOrigin`, `setActiveServerOrigin`, `environmentClientFor`, `getClient`, `setClient`
  (diff `:9-43`); `serverUrl` deleted; residue grep is clean (`rg serverUrl apps/web/src` → none).
- Environments store landed at **`apps/web/src/lib/environments/`** (not the plan's
  `features/environments/state/`): `state/store.ts` (`activate`, `recordHandshake`,
  `recordDescriptor`, drift → `phase: 'identity-drift'` and a thrown structured error, `:129-146`),
  `utils/connection.ts` (`EnvironmentEntry`, `ServerConnectionState`, `connectionAfterHandshake`),
  `state/query-clients.ts` (`queryClientFor`, `originForQueryClient`, owner conflict errors),
  `state/server-restart-invalidation.ts` (per-origin), `state/activity.ts` (per-origin AbortSignal).
- `features/chat/environment/` deleted; new `features/chat/transport/chat-transport.ts`,
  `create-chat-transport.ts`, `structured-errors.ts`; `ChatModeSession.environment → transport`
  (`session-context.ts:4-10`); `ChatModeSessionProvider` split into `ChatTransportProvider` +
  `ChatModeSessionController` (`providers/session-provider.tsx`, untracked
  `providers/session-controller.tsx`, `providers/transport-provider.tsx`, `hooks/use-chat-transport.ts`).
- Dev switch: `keymap/environment-commands.ts` (`environment.devSwitchOrigin`, DEV-only),
  `features/environments/components/dev-origin-dialog.tsx`, `features/environments/utils/dev-origin.ts`.
- Test factories (untracked): `apps/web/test/factories/orchestration-socket.ts` (`FakeOrchestrationSocket`),
  `in-process-orchestration-socket.ts` (drives the real WS hooks in-process — the pattern a TUI test
  harness should reuse), `orchestration-server-config.ts`, `chat-transport.ts`
  (`unsupportedChatTransport`), and `apps/server/test/orchestration-socket.ts`; tests
  `features/chat/transport/tests/create-chat-transport.test.ts` (two servers, two transports, close
  semantics), `lib/environments/tests/{store,query-clients}.test.ts`,
  `apps/server/src/orchestration/tests/ws-rpc.test.ts`, `packages/contracts/src/tests/orchestration-ws.test.ts`.

Not yet done from 077 (so the plan is still open and its files are still hot):

- `features/chat/state/server-connection-store.ts` and `features/chat/state/server-restart-invalidation.ts`
  still exist with a modified test, though no production consumer imports them (grep) — 077 Phase 2
  step 2 says fold and delete.
- `plans/077` Phase 4 gate `features/environments/tests/two-server-switch.test.tsx` does not exist
  (`ls apps/web/src/features/environments` → `components utils`).
- `attachment-image.ts` tripwire comment, `client-logging.ts` `environmentId` base field, and
  `language-server-plugin.ts:296` origin residue need diff review; 077 itself is not deleted and
  `plans/README.md` still lists it as READY.
- `active-transports.ts` (untracked) keeps a module-level `Set` and resets the entire projection
  store on origin switch (`:93-99`) — 077's "one chat connection at once", which 078 replaces.

### D2. Operator-owned "application runtime" refactor (not described by any plan)

- `apps/web/src/main.tsx` diff: `createApplicationRuntime(...)` (untracked
  `apps/web/src/state/application-runtime.ts`) owns a `Map<origin, {queryClient, editor}>`,
  `activateEnvironment(origin)` (suspends activity, resets LSP pool, suspends editor, cancels
  queries, closes chat transports, then `useEnvironmentsStore.activate`), and `commandBinding`
  from `keymap/state/runtime-binding.ts`. Mounted via `ApplicationRuntimeProvider` →
  `FocusProvider` → `HotkeysProvider` → `CommandBusProvider` → `ActiveEnvironmentApplication`
  (`components/active-environment-application.tsx:100-124`, which keys `QueryClientProvider` by
  origin and passes `runtime={active.editor}` to `EditorStateProvider`). `App.tsx` lost its provider
  stack and the "never put a route hierarchy above EditorStateProvider" comment.
- Editor side: `features/editor/providers/state-provider.tsx` (−210 lines), `workspace-edit-provider.tsx`
  (−94), `utils/save.ts` (−112), new `state/save-service.ts`, `utils/file-sync-ports.ts`,
  `providers/runtime-context.ts`, `hooks/use-runtime.ts`; `lib/file-server.ts`, `lib/server-sockets.ts`,
  `lib/query-client.ts` deleted. `test/render.tsx` and `test/factories/command-runtime.tsx` changed.
- This is exactly the "concurrent client API changes outside Plan 056" that block the final web
  typecheck (`plans/056:12-13`, `plans/README.md:38-41`). A TUI plan must treat `apps/web/src/main.tsx`,
  `state/`, `providers/`, `hooks/`, `lib/environments/`, `lib/client.ts`, and `features/editor/**`
  as owned by someone else until this lands.

### D3. Plan 056 chord keymap — implemented, pending typecheck

- `plans/056:10-13` "Implemented. Focused tests and trusted browser integration pass. Final web
  typecheck is blocked by concurrent client API changes." Files: `apps/web/src/keymap/**` (17
  modified + untracked `utils/chord-machine.ts`, `utils/chord.ts`, `utils/keymap-trie.ts`,
  `utils/format-keys.ts`, `utils/keyboard-event.ts`, `utils/app-bindings.ts`, `state/chord-session.ts`,
  `state/runtime-binding.ts`, `providers/bus-{context,provider}.ts(x)`, `hooks/use-bus-binding.ts`,
  `components/pending-chord-indicator.tsx`), `features/terminal/hooks/use-keybindings.ts`,
  `features/settings/components/widgets/chord-recorder.tsx`, `features/menus/utils/shortcut.ts`
  deleted, `packages/contracts/src/settings.ts:108-122` chord schema, `keys.ts` description,
  `docs/vscode-keymap-development.md` rewritten, `@tanstack/hotkeys` added to `apps/web/package.json`.
- A keyboard-centric TUI will want the pure pieces (`keymap/utils/chord-machine.ts`,
  `keymap/utils/keymap-trie.ts`, `keymap/utils/chord.ts`, `keymap/utils/format-keys.ts`) and the
  `keybindings.overrides` chord grammar; do not fork them while 056 is unmerged.

### D4. Doc/plan edits in the same tree

- `docs/environments-and-remote-plan.md` (+40: §2.2 checkout identity paragraphs, §2.4 unsaved-buffer
  ownership, new §5.6 "Git overview across checkouts, unscheduled"), `plans/068` (+11 main-checkout
  and `(environmentId, worktreeId)` rules), `plans/069` (+9), `plans/078` (+21), `plans/README.md`
  (056/057 state rows). A TUI plan must reference the **dirty** wording of these files, and its
  README row must be added on top of the uncommitted table.
- `docs/settings-reference.md`, `docs/settings-registry-inventory.md`,
  `packages/contracts/src/settings/schema.json` regenerated for the chord description.

### D5. Collision rules a TUI plan should state

- Do not touch: `apps/web/src/lib/client.ts`, `apps/web/src/lib/environments/**`,
  `apps/web/src/features/chat/transport/**`, `apps/web/src/features/chat/state/**`,
  `apps/web/src/features/chat-mode/providers/**`, `apps/web/src/main.tsx`, `apps/web/src/state/**`,
  `apps/web/src/providers/**`, `apps/web/src/keymap/**`, `apps/server/src/orchestration/ws-rpc.ts`,
  `apps/server/src/db/{migrations,schema}.ts`, `apps/server/src/app.ts`,
  `packages/contracts/src/{orchestration-ws,health,settings}.ts` until 077 and the runtime refactor
  are committed and 077 is deleted.
- Migration numbering: 10 is taken by 077; 068 appends 11 (`plans/068:544-546`); 069 appends the
  next (`plans/069:520-522` says "migration 11" but is stale — it predates 077's 10; reconcile). A
  TUI plan must not add a migration.
- New workspace `apps/tui` is additive and safe; anything it needs from `apps/web/src` must be
  copied only after 068 or extracted in the same pass as 068's Phase 5 rename.

---

## Key files (absolute)

- /work/projects/platform/PLAN.md
- /work/projects/platform/plans/README.md
- /work/projects/platform/plans/077-environment-runtime-origin.md
- /work/projects/platform/docs/session-domain.md
- /work/projects/platform/plans/078-federated-environments.md
- /work/projects/platform/docs/worktree-lifecycle.md
- /work/projects/platform/docs/product-vision.md
- /work/projects/platform/docs/environments-and-remote-plan.md
- /work/projects/platform/docs/t3code-reference.md
- /work/projects/platform/docs/t3code-parity-implementation-plan.md
- /work/projects/platform/AGENTS.md
- /work/projects/platform/apps/server/src/auth.ts
- /work/projects/platform/apps/server/src/orchestration/ws-rpc.ts
- /work/projects/platform/packages/contracts/src/orchestration-ws.ts
- /work/projects/platform/apps/web/src/lib/client.ts
- /work/projects/platform/apps/web/src/lib/environments/state/store.ts
- /work/projects/platform/apps/web/src/features/chat/transport/chat-transport.ts
- /work/projects/platform/apps/web/src/features/chat/transport/create-chat-transport.ts
- /work/projects/platform/apps/web/src/features/chat/transport/orchestration-rpc-client.ts
- /work/projects/platform/apps/web/src/state/application-runtime.ts
- /work/projects/platform/apps/web/src/features/address/utils/grammar.ts
- /work/projects/platform/apps/web/test/server.ts
- /work/projects/platform/apps/web/test/factories/in-process-orchestration-socket.ts
