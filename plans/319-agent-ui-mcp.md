# Plan 319: agents drive the Fregat UI over MCP

## Status and ownership

Status: APPROVED, 2026-10-03, scheduled far in the future: not in the current execution order.
Builds on [Plan 087](087-stateless-mcp.md)'s native MCP endpoint. Opening and placing content waits
for the new layout system (splits anywhere), which has no plan yet.

## Scope

Agents show the user something (a file at a
line, a diff, a commit, a preview URL, later an embedded browser) and drive the live UI the way a
user does: type into an editor or terminal, press keys, run commands, then read what the UI shows.
This lets an agent check that its change works, or debug one, in the real app.

- Driving needs the client: keystrokes, focus, selection and rendered output exist only in the
  page. Each client registers its tools (open, type, press, run command, read view state) with the
  server over its existing socket. The server's MCP endpoint lists them beside the native tools and
  forwards each call to the attached client, which runs it through the same command registry and
  input path the keymap uses. Agents run on the server, so this is the one route that reaches them.
- Two MCP servers on the same Fregat server. `fregat` holds everyday work: native tools plus
  reveal (open a file, diff, commit or terminal), which changes server state and lets the app
  redraw. `fregat-ui` holds the client-run tools (type, press keys, run a command through the
  UI, focus and selection, read what is rendered) for checking and debugging through the real UI.
  Its tools would bloat everyday sessions, so chats get it only when a setting
  (`application` scope, off by default) or the session turns it on. No tool exists in both.
- Rename the built server from `platform` to `fregat` first (`McpServer` name, auth realm, the
  Codex and ACP injection, the Codex name match for startup failures, tests), so tools read
  `mcp__fregat__*`. A user config that names its own `fregat` server takes over the hazard Plan
  087 M1 records for `platform`.
- Outside agents (Claude Code or Codex in a terminal, any MCP client) reach the same tools through
  the same endpoint. Plan 087 M1 issues tokens only to Fregat's own provider sessions, so add an
  owner-issued external-client grant: named, scoped to a workspace, revocable from settings,
  reaching remote machines over the existing SSH access.
- Also register the same tool definitions with Chrome's in-page tool API (`navigator.modelContext`)
  where it exists, so a browser-resident agent can call them too. One definition, two transports.
- Opening and placing things is blocked on the new layout system (splits anywhere, easy to place
  content), which is still being ideated and has no plan yet. Where a revealed item lands, and
  which window receives a call (the chat's own window or the last-focused one), are that system's
  decisions. Typing into and reading an already-open editor or terminal does not wait for it.
- Driving the window the owner is using fights them for focus. Calls target a window by id, and an
  agent can open its own window or tab to work in.

Exit: an agent opens a file, types into it, and reads the result back; types a command into a
terminal and reads its output; a call with no attached client returns a domain error the agent
can read.
