# Fregat's platform beneath the UI

Track A research for [Plan 336](../../../plans/336-packages-as-products.md). Topic: the server,
clients, agent harness integration, remote machines, installation and observability. Read at
Fregat `0df5eb872` on 2026-10-08. Sources are code, `docs/`, `plans/`, git log subjects and
`/work/reports/`. Nothing here was run live; "shipped" means merged on main with tests or a
scenario, and owner checks still pending are named.

The short version: under the editor and terminal sits a substantial local platform (about
109k lines of server TypeScript, 307 server test files, 394 browser scenarios). Its best stories
are about **work that keeps going**: terminals that survive server restarts, updates that wait
for running agents, agents that keep their schedules while you are away, and one machine server
that every client shares. Those are things Cursor, VS Code and T3 Code do not sell, and they are
real in code today.

## 1. Top 10 headline-worthy things, ranked

### 1. Close any window; nothing stops

**Pitch:** One server per machine owns your files, terminals and agents; browser tabs, the
installed app, the terminal UI and your phone are all just windows onto it.

- **Evidence:** socket activation through systemd or launchd (`apps/server/src/system/activation.ts`),
  one server per state home (`system/state-home-lock.ts`), installed-app contracts in
  [Plan 114](../../../plans/114-installed-app.md) ("Closing the app preserves mesh services,
  terminals…"; `launch_handler: focus-existing`). Clients: `apps/web`, `apps/desktop` launcher
  with native hosts (`apps/desktop/native/macos/platform-webview.m`, `linux/platform-webview.c`),
  `apps/tui` (OpenTUI + React, ~18k lines), phone shell (`apps/web/src/features/phone`).
  Commits `Plan 114 U3: socket-activated machine server…` (#333), `Plan 114 A1/A2` (#355, #356).
- **Status:** shipped (Plan 114 Gates 1–4 done 2026-10-03, owner-accepted on Mac).
- **Demo:** split screen: start a long `npm test` in a Fregat terminal and a Claude turn in the
  desktop app, quit the app, open the same workspace in the TUI and on a phone; the test output
  and the turn are still streaming.

### 2. Terminals that survive a server restart

**Pitch:** Your shells live in their own host process, so restarting or upgrading Fregat
reattaches them mid-output instead of killing them.

- **Evidence:** [docs/terminal-host.md](../../terminal-host.md): one authenticated Unix-socket
  host per state root, Linux `platform-pty-<id>.scope` cgroup, 1 MiB replay ring per shell,
  byte-offset resume, lease adoption elected through an exclusive SQLite transaction.
  Code in `apps/server/src/terminal-host/`, PTYs from `packages/pty` (Bun native terminal, waits
  for the last byte). Verified 2026-09-25 with two real server processes: shell PID survived and
  output advanced 124 → 198 bytes. Scenarios `terminal-offline-host`, `server-restart`.
- **Status:** shipped on Linux. macOS uses a detached-process fallback; owner check pending.
- **Demo:** run `htop` or a dev server, press Restart server in the app, watch the pane reconnect
  with its scrollback intact and the program still running.

### 3. Updates that wait for your agents

**Pitch:** Fregat stages an update, shows "Update available", and restarts only when your agent
turns finish, then checks itself live and can roll back.

- **Evidence:** `apps/server/src/update/service.ts` (busy-session gate, serialized restart,
  `interrupted` record), `staged-release.ts`, `GET <base>/release` with `pending`, `phase`,
  `liveCheck`; web-only installs swap live "while open terminals and sessions continue"
  ([docs/development.md](../../development.md)). Sleeping sessions are listed separately at restart
  (Plan 144 Phase 2). Scenarios `server-update`, `server-update-deadline`, `client-update`.
  Portable `bun run build-release` (#548) bundles its own Bun.
- **Status:** shipped. The installer (`install-release`) is a Linux + Mesh + systemd integration;
  the portable build runs anywhere Bun builds.
- **Demo:** start a turn, trigger an update; the popover lists the busy session and waits; the
  turn finishes, the server restarts, the terminal from item 2 is still there.

### 4. Bring your own agents, on the plans you already pay for

**Pitch:** Claude Code and Codex run inside Fregat on their own logins and subscriptions, side by
side, each session with its own permission mode.

- **Evidence:** drivers in `apps/server/src/provider/drivers/` (Claude via the Agent SDK, Codex
  via its app-server protocol pinned to `rust-v0.157.0`, plus Cursor over ACP and OpenCode, both
  off by default). `credential-watch.ts`: a `codex login` in any terminal flips the provider to
  signed in "within a second, with no restart and no polling". Multiple provider instances with
  their own homes (`providers.instances`, deliberately `application` scope so a cloned repo cannot
  point a provider at another binary). Runtime modes `full-access`, `approval-required`,
  `auto-accept-edits` (`packages/contracts/src/provider.ts`). "Always allow" writes a real harness
  permission rule ([Plan 145](../../../plans/145-harness-controls.md) approval-rules, `89c58188`).
  Model discovery reads each CLI's catalog (Plan 138).
- **Status:** shipped for Claude and Codex. Cursor and OpenCode: shipped behind a switch, not
  default.
- **Demo:** one workspace, two sessions in the rail: Claude in approval mode asking to run a
  command, Codex in full access editing in its own worktree. Click "Always allow" and show the
  rule landing in Claude's own settings.

### 5. The agent sees the compiler

**Pitch:** When Claude edits a file, Fregat's running language server reports the errors that
edit introduced back to the agent within 1.5 seconds, before its next step.

- **Evidence:** [Plan 140](../../../plans/140-editor-agent-advantage.md) Phase 4a/4b:
  `apps/server/src/lsp/agent-diagnostics.ts`, `provider/adapters/utils/claude-diagnostics-hooks.ts`
  (PreToolUse baseline, PostToolUse `additionalContext` on `Edit|Write|MultiEdit|NotebookEdit`),
  only errors new since the baseline, max 10 per file, reuses the already running backend and
  spawns nothing. Tested against real TypeScript 7 (pull) and tsserver (push) in
  `lsp/tests/typescript-server.test.ts`. Setting `agent.diagnosticsFeedback`, on by default.
  Also from Plan 140: `Mod+L` sends an editor selection to chat; "Fix with AI" hands any error
  toast to a new session.
- **Status:** shipped for Claude. Codex (4c) not built, waits on an owner check.
- **Demo:** ask Claude to rename a function's parameter type; it breaks a caller; the timeline
  shows the hook's diagnostic and Claude fixes the caller unprompted.

### 6. Every agent turn is a checkpoint you can act on

**Pitch:** Fregat snapshots the worktree at every turn, so you can undo one hunk of an agent's
change, rewind the conversation and files, fork from any turn, or have a second model review it.

- **Evidence:** `apps/server/src/git/checkpoint-store.ts`, `orchestration/checkpoint-hunks.ts`,
  `rewind-admission.ts`; [Plan 139](../../../plans/139-acting-on-agent-diffs.md) (hunk/file
  Undo/Reapply with `git apply --check`, review draft of line comments sent with the next
  message, comments on proposed plans); fork (Plan 145, Claude `forkSession`, Codex
  `thread/fork`); [Plan 169](../../../plans/169-agent-review-mode.md) agent review mode: any
  provider reviews uncommitted changes, a turn, a branch or a commit, findings land as diff
  comments (#96). Transcript export to Markdown/JSON. Scenarios `checkpoint-rewind`,
  `checkpoint-restore`, `session-fork`, `chat-agent-review`.
- **Status:** shipped. Owner checks pending on hunk undo and plan comments with a real turn.
  Comment re-anchoring after code moves is left.
- **Demo:** agent edits three files; undo one hunk with `Mod+Backspace`; ask Codex to review
  Claude's turn; its findings appear on the lines; send them back in one message.

### 7. Agents that keep working while you are away

**Pitch:** Scheduled wake-ups, goals and background tasks keep a session alive, Fregat shows
when it will wake, and your phone gets a push when it needs you.

- **Evidence:** [Plan 144](../../../plans/144-unattended-agent-work.md) Phases 1–3: harness-started
  turns adopted and labelled ("Scheduled wake-up"), `provider/session-schedules.ts` (sleeping
  sessions with `sleepingUntil`, moon button, cancel), `session-goals.ts` (Claude `/goal` and
  Codex `thread/goal/*`, with pause/resume/clear). Background task list and stop, hook results
  visible (Plan 145). Web Push from the server with every tab closed
  ([docs/web-push.md](../../web-push.md)), suppressed while any window is focused, one shared
  notice derivation checked against T3 Code in 900 cases. Scenarios `chat-sleeping-session`,
  `chat-session-goal`.
- **Status:** shipped. Push is opt-in (`chat.pushNotifications`, off); iOS and Android device
  checks pending.
- **Demo:** set a Codex goal, close the laptop, receive a push on the phone when it finishes or
  asks a question, tap it, approve from the phone.

### 8. Every machine you own, in one window

**Pitch:** Connect any machine over SSH or Tailscale and its projects, terminals and agents
join the same rail; Fregat installs or updates its own server there.

- **Evidence:** [docs/federated-environments.md](../../federated-environments.md):
  `apps/server/src/machines/` (SSH control connection, `SSH_ASKPASS` prompts relayed to the
  browser and never stored, `ssh_config` alias discovery including `Include` globs, tailnet peers
  from `tailscale status --json`), one proxy relaying HTTP and WebSocket including terminal binary
  frames, so a phone reaches a remote machine through the primary. "Update server" copies the
  primary's own release over SSH ([docs/remote-server-releases.md](../../remote-server-releases.md)).
  Unreachable machines keep readable cached rows. Auto placement scores machines by preference,
  CPU and free memory (#272, [Plan 311](../../../plans/311-automatic-machine-placement.md)).
  Scenarios `machine-balancing`, `machine-protocol-mismatch`.
- **Status:** shipped. Live remote update verification pending; Auto placement UI completion is
  Plan 311 (approved).
- **Demo:** add the Mac from the tailnet list, open its repo, start a Claude session there from
  the Linux box, open a terminal on it, then view both from the phone.

### 9. See your plan limits before the agent stops

**Pitch:** A usage meter shows each account's five-hour and weekly windows and reset times, and
a usage page reads cost per model from transcripts already on your disk.

- **Evidence:** [Plan 141](../../../plans/141-usage-and-rate-limits.md) Phases 1–5:
  `provider/usage-store.ts`, `usage-recorder.ts`, `transcript-history.ts` (scans local Claude and
  Codex transcripts, bounded), `model-prices.json`, settings UI `usage-section.tsx`. Codex quota
  refreshed every minute (#697). Codex reset-credit redemption behind a confirm, serialized per
  account with an idempotency key (Phase 5). Scenarios `chat-usage-meter`, `settings-usage`,
  `reset-credit-redemption`.
- **Status:** meter and history shipped. Reset-credit redemption shipped on fixtures; the owner's
  one live redemption is pending.
- **Demo:** the composer's meter at 82% of the weekly window with "resets Thursday 09:00", then
  the usage page breaking last week down by model.

### 10. Pair a phone with one link, and read every failure

**Pitch:** A one-time link or QR code pairs a device; every operation writes one structured
event, and every error says why and how to fix it, with a button that hands it to an agent.

- **Evidence:** `apps/server/src/devices/` (loopback is trusted, other devices need the cookie a
  five-minute single-use code gives; 30-day idle expiry; fails closed if settings cannot answer),
  `pairing-qr.tsx`, `bun run pair` for headless machines. Observability: evlog wide events in
  `logs/<date>.jsonl`, client logs ingested and sanitized (`observability/client-ingest.ts`), in-app
  Logs timeline (`apps/web/src/features/logs`), `bun run logs --since 5m`, error catalogs with
  `why`/`fix` enforced by `errors:census`, log noise gated by `logs:census`
  ([Plan 147](../../../plans/147-log-hygiene-and-noise-gate.md)). Scenario `device-pairing`.
- **Status:** shipped.
- **Demo:** Settings, Pair a device, scan the QR on a phone, land in the session list. Then
  break a git remote and show the toast with its fix and "Fix with AI".

## 2. Inventory by area

### Server (`apps/server`, Bun + Elysia + SQLite/Drizzle)

- **Orchestration engine** (`orchestration/`, ~90 files): event-sourced sessions (event store,
  deciders, projection pipeline, reactors), WebSocket RPC with protocol version handshake,
  command receipts for idempotent retries, live stream budget, replay paging. Ported from and
  checked against T3 Code ([Plan 126](../../../plans/126-t3code-alignment.md)).
- **Worktrees per session** ([docs/worktree-lifecycle.md](../../worktree-lifecycle.md)): "Send to
  current branch" or "New worktree"; the fork commit is fixed at acceptance; managed paths under
  the git common dir; idle shells close when the last session on a worktree settles.
  Setup scripts in terminals (Plan 187, approved).
- **Session titles** generated by a model with citations (`title-*.ts`); commit message
  generation with a 200k patch budget (`git/commit-message-generator.ts`).
- **Git** (`git/`): status, history search, branches, worktrees, submodules, auto-pull, upstream
  fetch, pull requests; **forges**: GitHub, GitLab, Forgejo, Azure DevOps, Bitbucket, including
  self-hosted detection through CLI logins; read and post PR discussion and reviews (#267, #293,
  #305). PR sync rate is Plan 186.
- **Filesystem** (`fs/`): atomic writes with fsync, workspace edit journals, watch worker, tree
  watch, ripgrep search with gitignore, drives/places, native folder picker endpoint, language
  census. Opening `/work` (huge tree) fixed in Plan 175.
- **LSP** (`lsp/`): pooled stdio proxy, pinned installers (`installer-manifest.ts`), TypeScript 7
  and tsserver, diagnostics budget, agent diagnostics (item 5).
- **External MCP servers** ([Plan 174](../../../plans/174-external-mcp-servers.md), phases 1–6):
  status per server, reconnect, OAuth sign-in from any device, machine-level page that writes each
  harness's own config, per-session off switches, trust gate for Claude project servers.
- **Fregat's own MCP endpoint** (`mcp/`): two read tools (`workspace_info`, `read_file`) with a
  descriptor-pinned file boundary. Small.
- **Attachments**: uploads with ownership lanes and fork copying.
- **Settings**: layered JSON documents (application, machine, workspace scopes) with a
  registry of 165 keys, a JSON Schema, secret store, write coordinator and transactions;
  execution values are never `window` scope so cloned repos cannot change binaries
  ([docs/settings-reference.md](../../settings-reference.md)).
- **Themes, fonts, wallpapers**: Fontsource and Nerd Font catalog, theme bundles paired with
  wallpapers.
- **Push** (`push/`, `packages/push`): VAPID, subscriptions, expired-device cleanup.
- **Update, installation, system**: staged releases, service descriptor, machine ID, identity
  key, locality checks.

### Agent harness integration (`apps/server/src/provider`, ~10k lines)

- Drivers: Claude (Agent SDK), Codex (generated app-server protocol), Cursor (ACP, #290),
  OpenCode, Mock (tests and the browser harness only).
- Surfaced harness controls ([Plan 145](../../../plans/145-harness-controls.md)): approval rules,
  fork, MCP status, background tasks with stop, hooks, custom agents, export. Compact is owned by
  Plan 126.
- Subagents: running child agents render in `agents-panel.tsx`; background-task liveness from
  `task_started`/`task_notification`.
- Steering: queued follow-ups, steer a running turn, explicit steering traits per provider.
- Session reaper and idle stop that respect schedules and goals.
- "One id, two doors" for Claude: a GUI session can be resumed in a raw terminal
  (`claude-terminal-resume.ts`, [docs/product-vision.md](../../product-vision.md)).
- Usage: rate-limit events, per-turn recording, transcript import, price catalog, reset credits.

### Clients

- **Web** (`apps/web`): the workbench and chat; instant reload restores the visible workspace
  before first paint ([docs/instant-reload-design.md](../../instant-reload-design.md)).
- **Phone** ([Plan 143](../../../plans/143-phone-layout.md)): a separate lazy shell chosen before
  paint, stack navigation driven by the address (Back gesture works), long-press context menus,
  the same PTY and diff surfaces, phone first-load script cut from 1.68 MB to 1.07 MB gzip. 13
  `phone-*` scenarios. Dictation in the composer (#903).
- **Desktop** (`apps/desktop`): launcher picks the native WKWebView host on macOS
  (`Fregat.app`, materials none/frosted/glass) and an installed Chrome app on Linux, with a
  C/GTK webview fallback. Works from Dock and OS launchers with no launcher running. Electrobun
  removed (#440).
- **TUI** (`apps/tui`): agent view with streaming, sessions, models, approvals; workbench with
  files, terminals, git, search, diagnostics, logs, settings; same keymap and settings as web.
  Redesign on OpenTUI is [Plan 202](../../../plans/202-tui-ui.md).
- **Native Swift** (`apps/mac`): an editor-core benchmark harness and stub window (about 2k
  lines of Swift, mostly EditorBench; the app is a 32-line `main.swift`). The shipped Mac window
  is the 418-line Objective-C WKWebView host in `apps/desktop/native/macos/`.
  Strategy in `plans/native-plan-of-plans.md`, gated on beating the web editor.

### Shared packages

- `packages/contracts`: valibot schemas for every wire type (orchestration, provider, usage,
  machines, pairing, push, settings registry, server update). Shared by server, web and TUI.
- `packages/client-core`: shared client logic for web and TUI.
- `packages/pty`: one-function PTY API over Bun's native terminal; private.
- `packages/push`: a six-line lazy wrapper over `web-push` (kept separate to defer the MPL
  dependency). Not a product.
- `packages/observability`: env, retention, runtime config.

### Verification tooling (useful as proof, not as product)

- `bun run agent:browser look|scenario|trace|renders|caches` with 394 scenarios, mock provider,
  `--touch` phone emulation, isolated state homes.
- Heavy-job runner with memory-aware admission ([Plan 284](../../../plans/284-resource-aware-heavy-jobs.md)).

### What Mesh adds (optional, separate repo)

[Mesh](https://github.com/ShaulLavo/mesh) is Go, host-owned terminal sessions over Tailscale.
Fregat uses it for: the HTTPS route that makes a phone reach the loopback-only server
(`mesh serve <host> 3301 --at /fregat --isolate`), serve-on-demand dev routes that start and
stop Vite and the API with use (`bun run dev:serve`), `install-release`'s deployment target,
`bun run show` private pages, and the TV usage dashboard. Mesh also has agent hibernation and
exact agent-conversation recovery after crashes, which Fregat does not reuse. Plan 336 keeps Mesh
out of scope, but the phone story currently depends on it or on a proxy the user sets up.

## 3. The honest story as it exists in code

### Local first

True in structure. The server binds loopback only (`assertLoopbackHost`, `apps/server/src/index.ts:64`;
`server.address` must be `http://127.0.0.1:<port>`). Files, git, PTYs, LSPs, agent processes,
settings, the event store and logs live in the state home (`~/.platform` in production).
Nothing calls a Fregat cloud; there is none. The agents call their own vendors, as they would
in a terminal. Fonts can be fetched from Fontsource.

Gaps: no downloadable build. Getting it means cloning, `bun install`, `bun run dev`, or building
`Fregat.app` from source (ad-hoc codesign; Developer ID signing, notarization, DMG and AppImage
wait for a public release, Plan 114). No Windows support in launchers or native hosts.

### Bring your own tools

True for Claude Code and Codex. Fregat drives the vendors' own harnesses with their own
credential files, so the user's Pro/Max or ChatGPT plan applies and the harness keeps its own
session store, rules, hooks, MCP config and goals. The design rule is "surface the harness, do
not reimplement it" (Plan 145), which is a good public line: Fregat adds views, not a second
agent.

Gaps: Cursor and OpenCode are disabled by default. Codex lacks the diagnostics hook. The
harness `/ide` integration does not work inside Fregat sessions (Plan 140 Q3), so Claude's own
IDE features (open files, selection) arrive through Fregat's attach path instead.

### Share it

True for **your own devices**: pairing gives a device full access (one trust level), remote
machines join over SSH, and the primary proxies everything to a paired phone. Notifications reach
devices with all tabs closed.

Gaps: the phone path needs an HTTPS origin on your tailnet. The repository documents only the
Mesh route; a contributor without Mesh must configure something like `tailscale serve` and
`SERVER_ALLOWED_ORIGINS` alone, and no doc says so. Phase 5 real-device checks (Safari toolbar,
keyboard, safe areas) and iOS/Android push checks are pending. There is no multi-user sharing:
connecting a machine "is equivalent to handing it a root shell as your user, in both directions"
(docs/federated-environments.md), and collaborative editing is planned work (Plan 336, E066).

## 4. What a landing page must not claim yet

1. **"Native Mac client"** as a Swift app. `apps/mac` is a benchmark harness and stub. Say
   "a native macOS window" (WKWebView host with its own app identity), which is true. The current
   README's "native mac" is ambiguous; fix it.
2. **"Download"** or one-click install, signed builds, Windows, Linux packages. Source build only.
3. **"Works on your phone over Tailscale" with no qualifier.** Needs an HTTPS proxy (Mesh or
   self-configured) plus pairing; device checks pending. Say "open it on your phone through your
   tailnet" and link setup docs once they exist.
4. **Cursor, OpenCode or "any agent".** Experimental and off. Claim Claude Code and Codex.
5. **Pooling accounts or a usage proxy.** The `claude-gpt` gateway and multi-account routing in
   the git log are the owner's private infrastructure; a Claude account was banned on
   2026-10-02. Never mention it.
6. **Reset-credit redemption, remote server updates, Codex diagnostics feedback** as working:
   each lacks its live check or is not built.
7. **"Agents control the editor" or a Fregat MCP toolset.** Two read tools exist; agent UI tools
   are [Plan 319](../../../plans/319-agent-ui-mcp.md), scheduled far later.
8. **Team sharing, collaboration, multi-user permissions, sandboxing.** None exist; pairing is
   full trust and machines trust each other completely.
9. **Speed numbers for the platform layer** (server latency, restart time, reconnect time).
   No benchmark exists. The 1.5 s diagnostics budget and the 1 MiB replay ring are design limits,
   not measurements. Terminal and editor speed claims belong to ghostty-webgpu and Singapore's
   benchmark pages.
10. **"Terminals survive restarts" on macOS** without the qualifier, until the fallback's owner
    check passes. Linux is verified.
11. **A finished TUI.** It works and is broad, but its redesign (Plan 202) is pending; present it
    as "a terminal client" without screenshots implying the final design.

## Checklist for Tracks B–D

- [ ] Lead the Fregat pitch's platform section with items 1–3 (work that keeps going); they are
      the least imitated and fully shipped on Linux.
- [ ] Use items 4–6 as the agent section: harness-native, compiler feedback, checkpoints.
- [ ] Record demos from existing scenarios where possible (`server-restart`, `terminal-offline-host`,
      `checkpoint-rewind`, `chat-agent-review`, `chat-sleeping-session`, `device-pairing`,
      `phone-shell`, `chat-usage-meter`) so the visuals are reproducible.
- [ ] Before publishing the phone claim, write a contributor doc for exposing the server on a
      tailnet without Mesh.
- [ ] Replace "native mac" in `README.md` with an accurate phrase.
- [ ] Produce one measured number for the platform story (for example restart-to-reattached
      terminal time) through `agent:browser trace`, or keep the copy number-free.
- [ ] Mark Cursor/OpenCode, Codex diagnostics, collaboration and signed downloads as planned or
      omit them.
