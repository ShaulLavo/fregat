# Fregat workbench: what is worth selling

Track A discovery for [Plan 336](../../../plans/336-packages-as-products.md). Topic: the Fregat web
app and workbench (`apps/web`, `packages/ui`, `packages/tree`, `packages/client-core`) plus the
server features it fronts. Read from Fregat `0df5eb872`, 2026-10-08. Every "shipped" item below
was checked in source; commit hashes are the landing commits found with `git log`. Plans that were
finished and retired from `plans/` are cited by commit (`git show <hash>^:plans/<file>` recovers
the text).

Status words: **shipped** (in code on main), **partial** (some phases in code, named gaps),
**planned** (approved plan, no code). "Demo" says whether it reads well in a screenshot or a short
looping video.

## 1. Top ten, ranked

### 1. Your own agents, side by side, in one workspace

Pitch: Claude Code and Codex run in Fregat on the subscriptions you already pay for, next to each
other, and one draft can go to several models at once, each in its own git worktree.

- Evidence: server drivers `apps/server/src/provider/drivers/{claude,codex,cursor,opencode}.ts`
  (registry in `drivers/built-in.ts`). Codex speaks its typed app-server protocol
  (`adapters/codex-protocol/`). Cursor over ACP (`96bb942f7`, #290). Fan-out of one draft to
  several models, each in a new worktree: `cfe206ea4` (Plan 126 INTERACTION-08,
  `features/chat/components/chat-draft-view.tsx`). Draft context strip picks machine, workspace or
  new worktree, branch and agent before sending (`chat/components/draft-context-strip.tsx`).
  Approval rules write real SDK permission rules ("this session", "always in this project",
  "always everywhere"): `apps/server/src/provider/adapters/utils/claude-permissions.ts`, Codex
  execpolicy amendments in `codex-command-approval.ts` (Plan 145, `89c581887`, `60c277ad8`).
  Model lists come from the CLIs themselves (Plan 138, `f4e6cb708`). Subagents get their own
  panel with per-agent summary, tokens and activity (`chat/components/agents-panel.tsx`,
  `21ab5198e`). Local Claude and Codex chats started outside Fregat can be imported
  (`apps/server/src/orchestration/session-discovery.ts`, `e265d8095`).
- Status: shipped for Claude Code and Codex. Cursor shipped as an isolated ACP provider. OpenCode
  is partial (its own commit `8ced03193` says "partial").
- Demo: yes. Two sessions side by side, or fan-out producing three worktrees, is the shot that
  separates Fregat from "another Cursor".

### 2. Review agent work like a pull request

Pitch: every agent turn is a checkpoint you can review hunk by hunk, comment on line by line,
undo or reapply, and hand to a second agent for review.

- Evidence: checkpoints are git refs per turn (`apps/server/src/orchestration/checkpoint-refs.ts`).
  Undo or reapply one change of a turn: `44cc72185` (server), `efe2c2910` (client),
  `chat-mode/components/turn-hunk-row.tsx`. Many diff line comments batched into one review message:
  `309193843` (`review-draft-bar.tsx`). Comments on selected lines of a proposed plan: `7c7633285`
  (`plan-comment-bar.tsx`). Agent review mode, where any provider reviews a change and its findings
  land on the lines in your review draft: `ec8c0575e` (#96, `apps/server/src/review/agent-review.ts`).
  Drag a line range in any git diff to send it to the composer: `3281e3aeb`
  (`git/components/diff-line-comment-action.tsx`). Checkpoint revert with confirmation: `eb9269254`.
  An agent's edit returns with the diagnostics it introduced (Claude): `f9ed276d2`.
- Status: shipped (Plan 139 mostly, Plan 169). Comments do not re-anchor when code moves; Plan 169's
  native `review/start` path and Plan 252's keep/reject-all are not built.
- Demo: yes, strongly. Word-level diff tint plus a batched review draft is a clean video.

### 3. Nothing is lost: terminals and sessions survive restarts and reloads

Pitch: restart the server, reload the tab or close the laptop; shells keep running, scrollback
replays, and agent conversations continue in the same thread.

- Evidence: a separate authenticated terminal host owns every PTY with a 1 MiB ring per shell; a
  new server adopts the leases and replays from each byte offset ([terminal-host.md](../../terminal-host.md),
  Plan 149 `8e3592a55`, `2a9980b51`; verified with two server processes, shell PID survived).
  The last terminal screen paints instantly on reload (`terminal/components/saved-viewport.tsx`,
  `d1ca64722`). Provider resume cursors persist (`provider/provider-session-directory.ts`).
  Before a restart the update popover lists busy sessions and affected files; on boot the server
  settles exactly the turns it interrupted (Plan 148 `668b56468`, `features/server-update/`).
  Warm reload restores tree, settings, git, diffs, search, chat, logs, diagnostics and terminal
  output before any network response ([instant-reload-implementation.md](../../instant-reload-implementation.md)),
  and the active editor paints from a saved snapshot on the first frame
  ([boot-and-first-load.md](../../boot-and-first-load.md)).
- Status: shipped.
- Demo: medium. A "kill the server, the shell keeps counting" clip works; it needs narration.

### 4. Undo that goes further than any editor

Pitch: undo is a branching graph you can browse, it survives closing the file, and it covers the
file tree, so a deleted folder comes back with its open tabs and unsaved edits.

- Evidence: undo graph and History pane (`editor/components/history-pane.tsx`,
  `history-graph-strip.tsx`; Plan 121, `5e01d8907`), diff any two states. Undo history kept after
  close in IndexedDB, returned only if the file's content hash still matches
  (`editor/state/history-persistence.ts`, `2acc3b73f`). File tree undo through a server-owned
  journal per drive; delete goes to history, not `rm` (`apps/server/src/fs/workspace-edit-journal.ts`,
  `workspace/hooks/use-file-operation-history.ts`; Plan 136, `38630c73e`).
- Status: shipped. Shared undo across all panes (Plan 172) is planned; phase 2 routing shipped
  (`446dbd732`).
- Demo: yes for the History pane and the folder-delete undo; both are short and surprising.

### 5. Every error explains itself, and "Fix with AI" is one click

Pitch: errors say why they happened and how to fix them, and every error toast, inline error,
failed git command and diagnostic can open a new agent chat with the full structured report.

- Evidence: error catalog with `message`, `why`, `fix` (`apps/web/src/lib/structured-errors.ts`,
  enforced by `bun run errors:census`). `lib/toast-error.ts` and `lib/fix-with-agent.ts` attach the
  action; `packages/ui/src/patterns/error-action-context.ts` puts it on every UI error state.
  Git failure notice with agent assist `7a0b5995c`; diagnostic fix in hover, peek and Problems
  (`lib/diagnostic-ai/hooks/use-diagnostic-fix.ts`, `e1d615027`, `7e7072132`).
- Status: shipped.
- Demo: yes. Toast with why/fix, click, a drafted chat appears.

### 6. A workbench you want to look at: theme bundles, Theme Studio, wallpapers, glass

Pitch: one click changes palette, code theme, wallpaper and window material together, and Theme
Studio lets you edit any palette live with a contrast checker.

- Evidence: six bundles (Graphite, Sage, Tokyo Night, Rosé Pine, Catppuccin, Gruvbox), each with
  light and dark palette, code theme, wallpaper and material, wallpapers pinned by sha256
  (`packages/contracts/src/themes/bundles.ts`, `bundle-wallpapers.ts`). Palettes are JSON data
  (Plan 115, `1e456e827`). Theme Studio drawer with Themes, Colors, Code, Wallpaper, Surfaces tabs,
  contrast checker, palette import, fork/save, bundle export (`features/theme-studio/`, `01ca17a75`).
  Wallpaper library with color extraction (Plan 123, `f6630b8c3`; `apps/server/src/themes/wallpapers/`).
  Materials none / frosted / glass with NSVisualEffectView on macOS (`f7523bf1c`,
  `apps/desktop/native/macos/platform-webview.m`). About 2,000 fonts (Nerd Fonts and Fontsource)
  searchable in settings (Plan 165, `d9c6069e6`). Code theme live preview inside the command palette.
- Status: shipped. Native glass is macOS only; Linux and plain browsers get CSS blur sliders.
- Demo: the best visual in the app. Lead the site's replica with a bundle switch.

### 7. Opens a 200 MiB file and keeps editing

Pitch: files up to 200 MiB open, edit and save byte-exact; larger ones open in a paged viewer,
and huge folders open without freezing.

- Evidence: [resident-20260928.md](../../large-file-ceiling/results/resident-20260928.md): 200 MiB
  plain text opens in 1.24 s, typing p95 15.5 ms, saves exactly 209,715,200 bytes (SHA-256 checked);
  100 MiB open went 2,574 → 622 ms. Size tiers pause analysis above 10 Mi code units and the minimap
  above 50 Mi, with a notice row (`large-file-notice.tsx`). Paged read-only viewer above the limit
  (`paged-file-viewer.tsx`, `e4a13fa9a`). Large-folder opening with a "live updates limited" chip
  (Plan 175, `49fbb50fb`, `d103638de`). Plan 112 closed in `ae166b7f2`.
- Status: shipped, with caveats: the numbers are single trials from a dirty integration build
  (the report says so), and 10/50/150 MiB typing p95 was 23–32 ms, above one 60 Hz frame.
- Demo: yes, if filmed honestly (scroll and type in a 200 MiB log).

### 8. Feels instant: prefetch on intent, no flicker, rolling numbers

Pitch: Fregat starts loading what you are about to open while you point at it, and lists never
blank or jump while new results arrive.

- Evidence: [prefetch-every-press.md](../../prefetch-every-press.md) (Plan 177): a file-tree row
  hovered 1.5 s paints text and colour together at 40–44 ms (markdown) and 60–67 ms (TypeScript)
  after the press, with no uncoloured gap; one prefetch gate `47e020792`, diff prefetch on row
  intent `70780a3e3`, every press timed press-to-first-paint `531b2672d`. No-flicker hold
  (`apps/web/src/hooks/use-held-until-ready.ts`, 14 consumers) and a written rule. Loading states
  announce at once and show a skeleton only after 120 ms (`packages/ui/src/components/loading-state.tsx`,
  26 content-shaped skeletons). Rolling ticker digits in git counts, diff stats, context ring
  (`packages/ui/src/components/ticker.tsx`, `ce8fb98aa`).
- Status: shipped. Measurements are dev-build headless runs from 2026-09-26.
- Demo: the ticker and skeletons show well; prefetch itself needs a side-by-side timer overlay.

### 9. One server, every device: browser, desktop, terminal, phone, other machines

Pitch: everything runs on your machine; open the same workspace from a browser tab, the installed
desktop app, a terminal UI or your phone, and reach your other machines over SSH or Tailscale.

- Evidence: installed desktop app with native webview hosts in C (Linux) and Objective-C (macOS),
  socket-activated shared server (Plan 114 done 2026-10-03; `bfcfa1f9a`, `7d3204442`, `4c1b9797d`).
  TUI with agent view, workbench, git, search, logs and settings (`apps/tui`, about 300 files).
  Phone shell with stack navigation, sessions, changes, file and terminal screens, terminal key row,
  swipe-back (`features/phone/`, Plan 143 `bd4517f36`, `4bc8d7ec1`). Device pairing
  (`apps/server/src/devices/`, `164bccf34`). Web Push when a session needs input, with every tab
  closed, suppressed while a tab is focused ([web-push.md](../../web-push.md), Plan 142). Remote
  machines from `~/.ssh/config` hosts and tailnet peers ([federated-environments.md](../../federated-environments.md)).
  The URL is the location: every view is addressable and copyable (`4d262d458`,
  [workspace-navigation.md](../../workspace-navigation.md)).
- Status: desktop, TUI, remote machines, push shipped. Phone partial: phases 1–4 landed, real
  iPhone/Android checks pending. The desktop app is unsigned and not distributed.
- Demo: yes. A three-device shot (laptop, phone, terminal) on one session sells "local first".

### 10. Know what your agents cost and how much you have left

Pitch: a live usage meter, context ring, per-session cost and cache savings, with an effort picker
whose "ultra" levels burst in rainbow.

- Evidence: composer usage meter (`chat/components/usage-limits-meter.tsx`), context ring and token
  breakdown (`context-usage-ring.tsx`, `context-token-breakdown.tsx`), session cost from a price
  catalog (`apps/server/src/provider/price-catalog.ts`, `8ae8d8cee`), Settings › Usage with day
  chart, per-model rows and cache savings (`cf0bf21e4`), recent-turn cache counters (`41634c0f3`),
  persisted allowances and local transcript history (`0917cfe87`, `738f44622`, `8744d8134`).
  Effort burst for any `/ultra/i` level (`chat/components/effort-burst.tsx`, `bed2fd6c3`); typing
  "ultrathink" in the prompt is detected and overrides the picker (`chat-input-ultrathink-plugin.tsx`).
- Status: shipped (Plan 141). Plans 308/309 partial; Plan 310 (allowance visibility) planned.
- Demo: yes; the rainbow burst is a good three-second loop.

## 2. Inventory by area

### Agents and chat (`features/chat`, `features/chat-mode`, `apps/server/src/{provider,orchestration}`)

| Feature                                                                      | Status  | Evidence                                                                          |
| ---------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Several instances per provider, model switch rows in the timeline            | shipped | `providerInstanceId`; `chat/components/model-switch-row.tsx`                      |
| Fork from any finished turn                                                  | shipped | `0cf857844`                                                                       |
| MCP server status, reconnect, sign-in from any device (paste-back)           | shipped | `e92e76b64`, `86843435b`; `.mcp.json` servers stay off until approved `e63c9b4f1` |
| Background tasks with stop, hook rows, custom agent definitions              | shipped | `7793c8083`, `4688071de`, `ea4215b4e`                                             |
| Transcript export (Markdown, JSON)                                           | shipped | `4af47cba4`                                                                       |
| Queued follow-ups, "send now", prompt stash, receipt-checked retry           | shipped | `a05689c19`, `486bdae0b`, `state/follow-up-store.ts`                              |
| Attachments, image lightbox, terminal-context and active-file chips          | shipped | `apps/server/src/attachments/`, `0faedf609`                                       |
| Add editor selection or file to chat                                         | shipped | `bd00466b1`                                                                       |
| Goals (Claude `/goal`, Codex thread goals), sleeping sessions with schedules | shipped | `e3675ffcc`, `61ce9b1f7` (Plan 144 P1–P3)                                         |
| Start a session in the background from a new draft                           | shipped | `1089b199b`                                                                       |
| Worktree per session, setup scripts from `t3.json`, delete-with-worktree     | shipped | `1def0f450`, `f92ff2430`, `session-delete-worktree-option.tsx`                    |
| Machine balancing for new drafts by capacity and preference                  | shipped | `9e95b5adb`                                                                       |
| Dictation in the composer (browser speech API)                               | shipped | `3cbb055d7`, [chat-dictation.md](../../chat-dictation.md)                         |
| Mermaid, favicons, file links in assistant markdown; timeline minimap        | shipped | `assistant-markdown-mermaid.tsx`, `timeline-minimap.tsx`                          |
| Session attention labels (approval, input, failed, sleeping…)                | partial | `session-attention-indicator.tsx`; Plan 316's fade not built                      |
| Queue commands, composer/model commands, agent profiles, keep/reject all     | planned | Plans 250–253                                                                     |
| Agents drive the UI over MCP                                                 | planned | Plan 319, deferred                                                                |

### Editor surface (Singapore inside Fregat; see the Singapore research file for the engine)

| Feature                                                                          | Status  | Evidence                                              |
| -------------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| External edits: reload clean buffers, keep undo when bytes match, conflict toast | shipped | Plan 134 `a985b43f0`, `filesystem-conflict-toast.tsx` |
| LSP: hover, completion, signature help, rename, code actions, semantic tokens    | shipped | `editor/packages/lsp-plugin/`                         |
| Diagnostic peek with AI fix                                                      | shipped | `4fca151be`, `diagnostic-peek-fix-button.tsx`         |
| Inline merge conflict actions                                                    | shipped | `b0bd4b67d`                                           |
| Edit-surviving jump history; styled multi-selection copy                         | shipped | `2ba1fd26c`                                           |
| Markdown live preview, split view, source-preserving authoring commands          | shipped | Plan 108 `1d8e4aded`, `84c70dab6`, `0e2395cef`        |
| CSV as an editable table over the live text document                             | shipped | Plan 156 P2 `f621b6a54`                               |
| PDF in file tabs (scripting disabled)                                            | shipped | `87340481c`, `lib/pdf-viewer/`                        |
| Spellcheck (English; plain text and Markdown by default)                         | shipped | E058, `e000bbd25`; Plans 303–305 planned              |
| Editor groups, drag to split, move tabs between groups                           | shipped | `becdf7228`, `editor-groups-layout.tsx`               |
| Grammar preload from a per-root language census                                  | shipped | Plan 170 `fe39528db`, `df2a09b87`                     |
| Office documents, image files in a tab, Mermaid in Markdown files                | planned | Plan 156 P3+, Plan 264                                |

### Git and review (`features/git`, `apps/server/src/git`)

| Feature                                                               | Status  | Evidence                                                |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| Virtualized changes list, one shared file row everywhere              | shipped | `4ede7a794`, `apps/web/src/components/git-file-row.tsx` |
| AI commit messages from the chat providers, cancellable               | shipped | `3c1b324ac`, `git/commit-message-generator.ts`          |
| History graph, clone, publish, submodules, auto-pull, commit progress | shipped | `70872a40d` and git feature                             |
| Pull request discussion, approve and request changes in-app           | shipped | `06a054bec`, `pull-request-discussion.tsx`              |
| Split and stacked diffs with word-level tint; hover inside a diff     | shipped | `4e068e260`, `a7d4a8f40`                                |
| Branch picker shows worktree parents                                  | shipped | `732ec5e0b`                                             |
| Hunk and line staging                                                 | partial | server `/git/apply-patch` exists, no UI; Plans 242/243  |
| Blame, stash, branch and remote management                            | planned | Plans 243–245                                           |

### Files, search, navigation

| Feature                                                                          | Status  | Evidence                                                                   |
| -------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| File tree with sticky ancestors, middle truncation, filter, persisted cache      | shipped | `workspace/components/tree-sticky-overlay.tsx`, `tree-middle-truncate.tsx` |
| Catppuccin-derived file icons in two app hues, generated rules                   | shipped | Plan 180 `09dc3f600`, `a762e9880`                                          |
| Project search streamed over SSE, includes unsaved buffers, recycled editors     | shipped | Plan 182 `74bfd0d61`, `use-run-dirty-buffer-overlay.ts`                    |
| Quick open with preview, finds new files and symlinked folders                   | shipped | `a8ce3b81c`, Plan 177                                                      |
| File picker: Pinned, Places, Projects, Drives with space; column/list/icon views | shipped | Plans 159/191, `046d224c8`, `2e112a428`                                    |
| Two devices on one workspace share one search index per root                     | shipped | Plan 173 `dbe87afcf` (#55)                                                 |
| In-app structured log viewer with live timeline                                  | shipped | `features/logs/`, Plan 147                                                 |
| Tree rebuilt on app primitives (virtualization, drag, keyboard)                  | partial | Plan 178 sub-plans, several proposed                                       |

### Terminal (ghostty-webgpu inside Fregat; engine claims belong to the ghostty research file)

- Shipped: ghostty-webgpu renders every terminal (`terminal/state/runtime.ts`), the renderer tier
  is logged and shown (`4ff7e5f15`), terminal hotkey ownership (`ef4b534da`), two-stroke chords
  across app and terminal (`0f5b06181`), shells outlive sessions that used them, idle shells close
  when the last session on a worktree archives ([terminal-host.md](../../terminal-host.md)).

### Appearance, feel and polish (`packages/ui`, `lib/appearance`, `features/theme-studio`)

| Feature                                                                                   | Status  | Evidence                                                                    |
| ----------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Physical feel profiles (Flat, Seam, Brisk, Relaxed, Playful) with sampled spring easings  | shipped | [physical-feel.md](../../physical-feel.md), `workbench.feel`, Plan 154 P1–6 |
| Synthesized feedback sounds per channel (controls, errors, git, bell, agent), default off | shipped | `packages/ui/src/patterns/feedback-layer.ts`                                |
| No-hairlines design language, tone-only separation, enforced by census                    | shipped | [web-design-language.md](../../web-design-language.md), `design:census`     |
| Compact and cozy density                                                                  | shipped | `36bf483c3`                                                                 |
| Spinner, shimmer, 26 skeletons, 120 ms delayed placeholders                               | shipped | Plan 103, `ae1431b16`, `ec78c45da`                                          |
| Restart that spins its own icon; one-click update of server and page with progress        | shipped | `0cbbb7ce4`, `bf671685a`, `0555da0df`                                       |
| `/dev` gallery: Loaders, Physical, Shortcuts, Handles, Icons, Updates                     | shipped | `features/dev/`                                                             |

### Keyboard and commands (`apps/web/src/keymap`, hotkeys package)

| Feature                                                                           | Status  | Evidence                                            |
| --------------------------------------------------------------------------------- | ------- | --------------------------------------------------- |
| Context-aware `when` bindings, one command foundation for app and terminal        | shipped | Plans 204–206, PR #603 `8d4694a20`                  |
| Shortcut editor for desktop and phone: record, conflicts, browser-grabbed warning | shipped | Plan 166 `bca5c1aef`, `shortcut-recorder.tsx`       |
| Several shortcuts per command, VS Code and Zed presets, held-modifier hints       | shipped | `2ea344523`, `keymap/presets/`, `held-modifiers.ts` |
| Command palette with 12+ modes and live previews (code theme, file, wallpaper)    | shipped | `features/command-palette/`, `863136117`            |

### Settings

- Shipped: one registry for every knob with application, machine and window scopes
  (`packages/contracts/src/settings/keys.ts`; generated [settings-reference.md](../../settings-reference.md)),
  User / Workspace / Defaults tabs, JSON view with schema-aware language support (`9c6f45710`),
  conflict-safe transactional updates (`3583ca4dd`), parent-toggle dependencies (`6ad8ac642`).
  Execution values can never be set by a cloned workspace file (scope rule in `AGENTS.md`).

### Architecture that makes it feel fast (claims for a "how it works" section)

- Async work goes through TanStack Query with cache settlement before mutations resolve, enforced
  by `bun run query:check` (`AGENTS.md`, "Async Effects Go Through TanStack").
- Boot is defined as the first usable frame of the last layout; non-boot features load behind
  boundaries with idle prefetch ([boot-and-first-load.md](../../boot-and-first-load.md)), and hashed
  assets carry across releases so an open page keeps loading lazy chunks after a deploy (`7c3605918`).
- React Compiler handles memoization (`ce8fb98aa`); render counts and cache dumps are checked with
  `bun run agent:browser renders|caches` before claims ship.
- One structured log event per operation with release and commit on every line; noise is gated by
  `logs:census`.

## 3. Weak or absent: do not claim these

- **"Typing lands within one 120 Hz frame."** Not measured. Plan 201 (the one-frame typing bar) has
  "Implementation has not started". Its own table shows TypeScript files with analysis on at
  56 ms p95 (1 MiB) to 254 ms p95 (10 MiB), and the benchmark metric is quantized to 60 Hz frames.
  The 120 Hz bar is a target. Until Plan 201 or a Track B trace produces numbers, say "typing in
  ordinary files stays within a frame" only with a fresh measurement attached.
- **Native Mac app.** `apps/mac` opens an empty window titled "Platform"; it is a bench and an
  editor-core spike. Fregat.app on macOS is the webview desktop app (Plan 114). Say "desktop app
  for macOS and Linux", not "native Mac client". The desktop app is unsigned and not publicly
  distributed.
- **Phone.** Phases 1–4 landed but real iPhone and Android checks are pending (Plan 143). Show it
  as "works from your phone's browser", not as a mobile app.
- **Collaborative editing.** Research and a plan only (E066/E067, `docs/collab-editing/`). Two
  devices can open the same workspace through one server, but live shared editing of unsaved text
  between two people is not built. Label as planned.
- **VS Code staples that are missing:** debugger (Plans 258–260), extension marketplace (268–269),
  Vim mode (274–280), settings sync, notebooks (261–262), tasks (257), multi-root workspaces (239),
  multibuffer (229–230), pinned/MRU tabs (236), git blame, stash and hunk staging (242–245).
  Do not use a feature-matrix comparison against VS Code or Zed.
- **Localization.** Plan 208 approved, not started; English only.
- **Glass and frosted materials** are native only on macOS. Linux and browser tabs get CSS blur.
- **Images and Office files.** Image files open as file details, not a preview (Plan 264). Word,
  Excel and PowerPoint are planned (Plan 156 P3+). Mermaid renders in chat, not in Markdown files.
- **Agent providers beyond Claude Code and Codex.** OpenCode is partial; Cursor is isolated ACP.
  Pitch two first-class providers, mention others as "also connects to".
- **Allowance visibility and agent-edit keep/reject-all** (Plans 310, 252) are planned.
- **Theme breadth.** Six bundles drawn from four upstream palette families. Do not say "hundreds of
  themes"; say "edit any palette live" instead.
- **Naming drift.** The TUI README says "Platform TUI" and the Mac stub says "Platform". Fix before
  screenshots are taken.
- **Site.** Plan 155's animated replica is approved but not built; the current site embeds the live
  app (31 MB). Not a claim problem, but no visual asset exists yet beyond `docs/images/workbench.webp`.
- **Large-file numbers** come from single trials on a dirty integration build; rerun on a committed
  build before quoting them on a landing page.

## Checklist for Tracks B–D

- [ ] Lead the Fregat pitch with items 1–3 (own agents side by side, PR-style review of agent work,
      nothing lost on restart). They are shipped and competitors lack them as a set.
- [ ] Make the site's hero replica (Plan 155) show a bundle switch, a fan-out to two models and a
      hunk-level review; these are the three most visual shipped features.
- [ ] Track B: produce a typing-latency trace on a committed build before any frame-budget claim;
      rerun the 200 MiB row on a committed build.
- [ ] Track B: record short loops for the History pane, folder-delete undo, Fix with AI toast,
      ultra effort burst, ticker counts and terminal survival across a server restart.
- [ ] Track C: replace "native mac" in the root README with "desktop app"; keep phone as browser.
- [ ] Rename remaining "Platform" user-facing strings in `apps/tui` and `apps/mac` before capture.
- [ ] Label collaborative editing, debugger-class features and localization as planned or omit.
