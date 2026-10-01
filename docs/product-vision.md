> [!IMPORTANT]
> **STATUS: 🟢 ACTIVE STRATEGY (2026-08-27).** This is the product-direction document for the
> agent-view initiative. Like all `docs/` strategy, it describes scope and does not authorize
> implementation — executable plans in `plans/` do that, ordered by root `PLAN.md`. Where this
> document conflicts with older strategy docs, this one wins (see
> [Amendments to existing docs](#amendments-to-existing-docs)).

# Product Vision — Agent View First

## What the product is

A chat-first agent app is the face of the product. The full IDE workbench — everything the app is
today — becomes a **pushed navigation state** behind it, entered per project with a back button.

The identity in one sentence: T3Code's agent ergonomics + real terminal workflows + a genuinely
great code/diff viewing surface, reconciled by a navigation stack instead of a mode toggle.

The category context: agent-first apps (T3Code, Codex app, Cursor's agents window) give you a
cross-project chat list but a shallow landing — a pop-out diff you cannot browse. IDEs give a deep
landing but rooted in one workspace, so hopping projects means another window. Cursor ships both as
two awkward peers (two windows / a toggle). Our resolution: **shallow hop, deep landing** — the
agent view is the root, and the IDE is its drill-down, never its sibling.

## The navigation stack

- **Root — agent view.** Sidebar lists chats, terminal sessions, and projects, cross-project. The
  main area renders the selection: a chat opens as GUI (inline terminal blocks where the agent ran
  commands are fine), a terminal session opens as a full-bleed ghostty pane.
- **Pushed — IDE mode.** A button on a project (or worktree) row pushes the full existing
  workbench: file tree, editor, diff browser, diagnostics, tiling. A back button pops to the agent
  view exactly where it was.
- There is **no toggle and no "current project" setting.** IDE mode inherits its project from the
  row it was entered through. Ambiguity about which project the IDE shows cannot exist by
  construction.
- Layout persists per project; re-entering IDE mode is instant restoration.

The existing app is already IDE mode. The new construction is the root shell and the stack; the
workbench is demoted, not rebuilt.

## Session model

- A **session** is one agent conversation. Some wear a chat face (SDK-invoked, rendered as GUI),
  some wear a terminal face (a CLI agent in a PTY). Both appear in the sidebar.
- **One id, two doors.** For harnesses whose SDK and CLI share a session store (Claude Code today:
  `~/.claude/projects/<project>/<session>.jsonl`, `claude --resume <id>`), a session started in the
  GUI can be reopened in a raw terminal and vice versa. Any chat gets an "open in terminal"
  affordance; terminal-born sessions appear in the list.
- **Chats stay siloed per harness.** There is no unified cross-harness chat history and none is
  wanted. The silo is invisible because the reviewable artifact — the diff — is shared ground truth
  beneath every harness (see data model).
- **Simultaneous dual-drive of one session is out of scope permanently.** Handoff-by-resume is the
  bridge. Live read-only mirroring of terminal sessions (tailing Claude's JSONL) is an
  **opportunistic garnish**: build it only where cheap, never load-bearing, drop it without pain if
  the undocumented format churns.

## Data model

```
project (repo)  1 ─── N  worktree  1 ─── N  session (chat or terminal)
```

- The **worktree is a property of the session**, chosen at creation ("send to current branch" vs
  "new worktree") and shown as a chip. Multiple sessions may share a worktree. This is the
  T3Code/Codex model and the correct foreground.
- Orca's inversion (worktree-first: race N agents on sibling worktrees, compare results) is a
  **held reserve**, not a target. Getting the data model above right makes it a later feature (a
  compare view over sessions sharing a base branch), not an architecture change. Do not build the
  compare view now; do not make it impossible either.

## The escalation ladder (diff viewing)

The "IDE view" demand is concretely: browse the whole file tree with a real editor, and browse all
diffs file by file in a real diff view — not the category-standard pop-out list. It is delivered as
an escalation ladder, not a jump:

1. "View changes" on a chat opens the diff **inline** in the conversation.
2. A button pops it to a **side pane**.
3. A button opens it **full screen / in IDE mode**, deep-linked to that project + worktree with the
   diff panel focused. Back returns to the chat.

Exact UX at each rung is open; the ladder shape and the invariants below are settled.

## Decided invariants

1. **One diff component.** Inline, side-pane, and IDE renderings are one component
   (`editor-diff`-based) in three containers. Three implementations would drift and recreate the
   pop-out problem.
2. **Addressable IDE state.** IDE mode is reachable by link — project + worktree + panel + target
   (file/line) — not just "open". Every escalation button is a link, not a mode switch.
3. **Sessions point to worktrees point to projects.** Many-to-one at each step, modeled explicitly
   from day one.
4. **Cross-frontend session ids.** Where a harness supports it, the session id is the shared key
   between GUI and terminal; never fork per-frontend session identity.

## Sidebar rows

Codex-clean rows (title, no dashboard chrome) with T3Code-style **state grouping**: needs-input /
working / settled visible at a glance via sections and badges, not per-row stat clutter. Rows should
be able to carry worktree/diff status later without redesign.

## What already exists (verify via audit, do not trust blindly)

- `features/chat` is already substantially the T3Code-style agent UI; backend
  `orchestration/`/`persistence/` implement the event-log/projection spine per
  [t3code-parity-implementation-plan.md](../plans/t3code-parity-implementation-plan.md).
- The tiling workbench, editor, diff package, terminal (ghostty), git, and search are IDE mode.
- The biggest genuinely new UI surface is **terminal sessions inside the agent view**.

## Amendments to existing docs

- [t3code-parity-implementation-plan.md](../plans/t3code-parity-implementation-plan.md): its product shape
  ("V1 side-panel chat, V2 standalone agent app later") is **inverted** — the standalone agent view
  is now the face and the priority. Its architecture spine (events, projections, receipts,
  recovery) remains authoritative.
- [logseq-parity-implementation-plan.md](../plans/logseq-parity-implementation-plan.md) and companions:
  **deferred until further notice** (banner applied 2026-08-27).
- Editor/terminal executable plans 055–067 live inside IDE mode and are unaffected.

## Non-goals

- Unified cross-harness chat history.
- Simultaneous dual-frontend driving of one session.
- Orca-style parallel compare view (reserve — data model must permit, nothing may build it yet).
- A "current project" global or an IDE/agent toggle, in any form.
