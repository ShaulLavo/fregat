# Platform TUI

The TUI connects to the existing Platform server. The Agent view provides prompts, streamed
conversations, session management, models, and approvals. The workbench provides files, terminals,
Git, search, diagnostics, logs, settings, and address navigation.

Run from the repository root:

```sh
bun run dev:tui
bun run dev:tui --origin http://127.0.0.1:3001
```

The launcher attaches to `VITE_SERVER_URL`, or `FS_HOST`/`PORT`. Dev/prod launchers register
`platform-tui://local` in the server's exact origin allowlist. An older running server needs
its normal launcher restarted to accept that origin. Custom launchers must include it in
`SERVER_ALLOWED_ORIGINS`.

## Keyboard controls

These are the defaults. Settings overrides take effect immediately, including displayed hints.

| Action                                  | Keys                 |
| --------------------------------------- | -------------------- |
| Command palette                         | F1 or Ctrl+K, then P |
| File picker                             | Ctrl+P               |
| Agent view                              | Ctrl+K, then R       |
| New session                             | Ctrl+N               |
| Focus prompt                            | Ctrl+K, then C       |
| Choose model                            | Ctrl+K, then M       |
| Open workbench                          | Ctrl+K, then W       |
| Choose another workbench folder         | Ctrl+K, then O       |
| Settings                                | Ctrl+K, then S       |
| Views                                   | Ctrl+K, then V       |
| Back / Forward                          | Ctrl+K, then B / N   |
| Edit / change scope / reset setting     | F2 / F3 / F4         |
| Retry / discard failed settings changes | F5 / F6              |
| Confirm an editing dialog               | F2                   |
| Change focus                            | Tab / Shift+Tab      |
| Close or return                         | Escape               |
| Reconnect                               | Ctrl+R               |
| Quit / suspend to shell                 | Ctrl+C / Ctrl+Z      |
| Quit while a terminal owns input        | Ctrl+K, then Q       |

Type to search settings. Up and Down move immediately while search keeps accepting text.
Every selectable list wraps in both directions. Tab moves between search, list, and details.
When settings have issues, Tab also reaches their scrollable panel. Arrows scroll the focused
panel. In the file picker, Tab completes the path, Shift+Tab moves between filter, path, and
places, and Enter opens a directory or preview. A narrow
terminal shows the preview in place of the file list; the dismiss shortcut returns to the list.
Every dialog follows `workspace.dismiss`, including its footer hint. Rebinding or disabling that
command changes dismissal everywhere.

The palette uses the shared prefixes: `>` for commands, `sess ` for sessions, `view`, `color`, and `theme`.
Unprefixed text opens filtered file browsing. Other recognized modes explain which later
surface they need. Open Address and Copy Address preserve the settings filter or file location.
Switching between those address modes starts a fresh dialog with the appropriate input.
Copy uses the terminal's OSC 52 clipboard support, with the address displayed for manual copying.
Opening a settings editor closes the file picker so the two dialogs cannot overlap.

Edit the Keybindings overrides setting to select a command and record its shortcut. The recorder
shows collisions and terminal restrictions, and can disable a command or restore its defaults.
Enhanced Ctrl+Shift+P is enabled only when the terminal advertises Kitty keyboard support.

Ctrl+Z suspends the foreground TUI job, including its launcher. Run `fg` in the shell to resume.
Suspension is unavailable when the TUI shares its process group with an enclosing shell.
Outside an embedded terminal, Ctrl+C quits. SIGTERM restores terminal modes and closes the application.

## Start an agent conversation

Select a project in the session rail. For an empty environment, use **F1 → Add project** and
enter an absolute folder path on the server. The stage shows the selected project and a prompt.
Type a request and press **Enter** to send it. **Shift+Enter** inserts a newline. Use
**Ctrl+K, then M** to choose a model and its reasoning effort.

Use **Tab** after `@file`, `/command`, or `$skill` to open completion choices. The palette also
provides image attachments from local files, built-in prompt editing, stash and restore,
interaction mode, access mode, stop, and transcript export. Drafts survive navigation and
reconnection. A rejected submission retains its content for retry.

Use **Paste clipboard image** to attach an image from this machine's clipboard. **Previous prompt**
and **Next prompt** browse submitted prompts. Large pastes appear as compact placeholders; submission
expands the original text. **Open prompt inbox** reviews terminal context attached to the draft.

Approvals and questions appear in place of the prompt after you pause typing. Select an approval
with its displayed digit. Questions accept choices or text, and secret answers stay masked.
When a plan is ready, use **Implement proposed plan** or **Implement plan in a new session** in the palette.

Focus the rail to use **J** and **K** for rows, **M** to mark a session, **/** to filter, and
**Shift+F10** for actions. The palette provides rename, archive, restore, delete, project scope,
reorder, and bulk actions. **Toggle session rail** switches between the rail and stage below
100 columns. These letter shortcuts remain ordinary text in the prompt.

Focus the timeline to scroll with arrows and Page Up or Page Down. At a window boundary,
Page Up loads earlier content and Page Down advances. **Jump to latest message** resumes the
latest view. The palette provides activity expansion, changed files, and checkpoint revert.
Opening a changed file pushes the workbench; Back returns to the conversation.

Use the model picker's provider account action to sign in, refresh, cancel, or sign out when the
provider supports that action. Browser sign-in runs on the server machine; the TUI also displays
the URL and any device code.

**Open session terminal** opens a shell in the selected checkout. **Resume Claude in terminal**
opens a settled Claude session through its configured executable. The server reserves that
session while its CLI runs. Close the terminal to return to chat; raw attach uses the same
controls as workbench terminals below.

Select terminal output and use **Ask agent about terminal selection** to attach the excerpt to
a prompt. Excerpt line numbers start at one within the captured text. A dropped terminal connection
shows **F1 → Reconnect terminal**, which reattaches the existing PTY or retries pending history sync.

## Choose and manage worktrees

Before the first send, use **F1 → Choose session worktree** or click the choice above the prompt.
**Send to current branch** uses the selected checkout. **New worktree** creates a separate Git
checkout from its current commit when you send. Uncommitted changes stay in the original checkout.
The choice and prompt survive navigation and reconnection. Existing sessions keep their checkout.

**Choose existing checkout** filters the project's branches and paths. Each checkout retains its
own draft. **New session in a new worktree** opens a draft based on the focused session's checkout
or the selected project. It creates nothing until the first send.

The session row and stage header show branch, shared use, and worktree lifecycle state. Open
**Manage project worktrees** from F1 or the rail actions to retry failed creation, open a checkout,
or start a session there. The manager remains available after the last session is deleted.

**Clean up…** asks for confirmation and preserves working changes. If cleanup finds changes,
**Discard changes…** shows a separate preview and confirmation. Changed files require a new
confirmation. Running processes, remaining sessions, and protected checkouts prevent cleanup.
Cleanup retains branches and commits. **Retain checkout** keeps a blocked checkout; **Release…**
keeps its files and transfers cleanup responsibility outside Platform. Missing and unclaimed
checkouts have explicit resolution and adoption actions.
In worktree action and confirmation dialogs, **Page Up** and **Page Down** scroll the details.
Arrow keys select actions; the selected action stays visible in small terminals.

See the [TUI worktree record](../../docs/tui-worktrees.md) for ownership and verification.

## Open a workbench

Press **Ctrl+K, then W** to open the selected project's checkout, or the server's start folder
outside Agent view. To choose a folder, press
**Ctrl+K, then O**, navigate with the file picker, and press **Ctrl+K, then W** there.
Within a workbench, **Ctrl+P** opens files directly into the viewer. Back and Forward traverse
agent, file, and settings locations. The last workbench, file position, pane, and terminal tabs persist
per environment and folder.

| View or action         | Default keys   |
| ---------------------- | -------------- |
| File tree              | Ctrl+K, then E |
| File viewer            | Ctrl+K, then I |
| Git                    | Ctrl+K, then G |
| Workspace search       | Ctrl+K, then F |
| Terminal               | Ctrl+K, then T |
| Problems               | Ctrl+K, then D |
| Logs                   | Ctrl+K, then L |
| Hide or show file tree | Ctrl+K, then U |
| Find in the viewer     | Ctrl+F         |
| Next or previous match | F3 or Shift+F3 |
| Go to line             | Ctrl+K, then J |
| Go to definition       | F12            |
| Hover information      | Ctrl+K, then H |
| Edit file              | Ctrl+K, then X |

The wide layout keeps the tree beside the active view. At narrow widths, the file tree and
viewer share the available space. Use their commands to switch. Problems lists diagnostics
for the active file. Hover and definition navigation use the server's configured language server.
The file edit action opens the built-in editor and uses a snapshot check
before committing the result. Conflicts retain a durable draft with the original snapshot.
Use **Edit file** to recover it or **Revert file** in the palette to discard it and reload.
Long lines scroll horizontally. Home, End, and find keep their target visible as the layout changes.

The Git palette includes stage, unstage, discard, commit, generated commit messages, fetch,
pull, push, and draft pull requests. Git changes use the shared diff model and the
**Diff view mode** setting. Split mode needs 120 available columns and falls back to stacked
below that width. **Tab** reaches the diff, and **Expand diff context**
reveals omitted lines. Commit progress and failures remain visible.

Search accepts include and exclude globs, regular expressions, case-sensitive matching,
and whole-word matching. Tab moves between its input fields. **Replace workspace matches**
previews replacements and applies them through one workspace-edit transaction. Files changed
since the preview cause rejection. Logs shows a histogram, event list, live tail, and full
JSON details. Use **Pause or resume logs** to hold the current list.

## Use a terminal

With the terminal focused, **Ctrl+K, then N** creates another shell. **Ctrl+K, then Left or Right**
switches shells, and **Ctrl+K, then W** closes one. The palette also provides copy, paste, and clear.
Shell input, mouse events, and layout changes reach the server PTY as bytes and resize controls.
Default Ctrl+C, Ctrl+Z, Tab, and Escape reach the inner program. **F1** opens the palette;
**Ctrl+K, then Q** quits Platform. Explicit user keybinding overrides remain active.

Press **Ctrl+K, then A** to attach the host terminal directly. To return to Platform, press
**Ctrl+]**, then **d**. Press Ctrl+] twice to send one literal Ctrl+] to the shell. Ctrl+B passes
through for tmux. Detaching leaves the server shell running. Multiple web and TUI viewers may
share the same shell, and the most recent resize controls its dimensions.

## Settings and connection

Settings use the server's semantic mutations, scope restrictions, optimistic projection, and
live event stream. A failed change stays visible with retry/discard actions. Workspace settings
cannot select executables or bind keys. Secret values remain in the server's secret store.

The issues panel identifies settings that were not applied by key, scope, and reason. Syntax
errors identify the broken file and explain that the last valid settings or defaults remain in
effect. Tab into the panel to scroll its repair instructions. Details distinguish ignored entries
from the effective value. The warning clears when the server accepts a corrected value.

Choose **Edit settings JSON** from the palette to edit the current scope.
The built-in editor saves through a revision check. Conflicts retain the draft and require explicit reload.
Closing an editor ends its request lifetime. A late completion cannot close a newer editor or
discard its draft. A semantic save already submitted to the server may still complete.

`Live` means the WebSocket handshake matches the environment verified over HTTP. On disconnect,
cached settings remain read-only and network-dependent actions become unavailable. Prompt drafts
remain editable. Reconnect
verifies identity again before restoring live writes. A replacement database at the same origin
is refused. Settings remain authoritative on the server.

Recent commands and the last picker directory use a mode-0600 SQLite database per environment at
`~/.platform/tui/<environment-id>.sqlite`. WAL and per-key writes preserve unrelated changes from
simultaneous TUI processes. Transactions merge their recent-command histories. The earlier JSON
convenience cache is not migrated. If a cache is invalid, delete the file named in the error and
press Ctrl+R to retry.

`workbench.colorTheme` selects light, dark, or terminal-derived system colors.
`workbench.palette` selects Graphite or Sage. Syntax uses shared Shiki theme registration.
Truecolor degrades to 256 or 16 colors according to terminal capabilities; `NO_COLOR` uses
terminal defaults. `workbench.reduceMotion` slows the shared loaders.

## Frames and development

```sh
bun run dev:tui --headless-frame /work/tmp/platform-tui.txt --width 100 --height 30
```

A failed connection still writes an error frame and exits 1; a live frame exits 0. Interactive
mode requires a TTY other than `TERM=dumb`. The supported minimum is 40 columns by 12 rows.

Tests use real in-process Elysia routes, isolated settings/databases, and OpenTUI's native renderer.
They never open a socket to the Platform server.

Permanent PTY tests also exercise direct and repository-launcher startup, Ctrl+Z and `fg`, built-in
editor cancellation, Ctrl+C, SIGTERM, and protection of a shared shell process group. These checks use
Python 3 and Bash on supported POSIX hosts.

```sh
cd apps/tui
bun --bun vitest run
bun run typecheck
bun run build
```

The build checks the generated terminal palette before emitting Bun modules. After shared UI
token changes, run `bun run theme:generate`. Standalone binaries belong to the distribution slice.

Use `Select` from `@/components/select` for lists. It owns wrapping and arrow routing from search
inputs; lint rejects raw `<select>` elements elsewhere. Prompts own Enter submission and supply
the native value, including input that arrived before React committed its next render.

See the [foundation record](../../docs/tui-foundation.md),
[workbench record](../../docs/tui-workbench.md), and [Agent view record](../../docs/tui-agent.md)
for implementation and verification details. Worktree creation parity and distribution remain
separate slices in [the TUI strategy](../../docs/tui-plan.md).
The [binding audit](../../docs/tui-bindings.md) records the original foundation dispositions;
the command catalog and in-app shortcut help contain the current defaults.
