# 145 · Export a transcript

- Status: PROPOSED.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

A session can be exported as Markdown (readable: user and assistant messages, plans, tool calls
summarised) or JSON (complete: the session's projected messages and activities). Export is a
download or a clipboard copy. Nothing leaves the machine.

## What exists today

- The session actions menu (`apps/web/src/keymap/menus/utils/session-actions-menu.ts`) copies the
  path, branch and session ID; there is no export.
- A single assistant message has "Copy as Markdown" (`chat/utils/message-menu.ts`, backed by
  `chat/utils/markdown-clipboard.ts`).
- A proposed plan downloads as Markdown (`chat/components/proposed-plan-card.tsx`,
  `downloadPlanMarkdown`, using `proposedPlanExportMarkdown`).

## Context menus (owner, 2026-09-25)

The owner asked for export in the context menu too, not only in the session menu button. Most of
that comes for free: `sessionActionsMenu` (`keymap/menus/utils/session-actions-menu.ts:90`) builds
both the header button (`components/session-actions-button.tsx`, in `stage-header.tsx` and
`chat-panel-header.tsx`) and the rail row's right-click menu (`chat-mode/utils/session-menu.ts` →
`chat-mode/components/session-menu.tsx`, a `ContextMenu` through `MenuSurface`, also reachable
with the ContextMenu key and Shift+F10 in `session-rail.tsx:174`). Adding the export items to
`sessionActionsMenu` puts them in both.

One more surface: the conversation's own context menu. `chatMessageMenu`
(`chat/utils/message-menu.ts:39`, opened from `message-bubble.tsx`) has "Copy as Markdown" for one
message. Add a conversation section below it: "Copy conversation as Markdown" and "Export
conversation as Markdown…", so right-clicking anywhere in the timeline offers the whole-chat
export. Both call the same `transcriptMarkdown`. Add a command-palette command for the active
session too, with its id in the command table.

Still a read, not a mutation: nothing is written to the server or workspace, and no other
consumer reads the result. If D1 lands on the server path, the transcript is a query
(`queryOptions` with a key from the feature's `query-keys.ts`), which is the read-over-POST rule.

## Harness support

Not needed. The export is built from Platform's own projection, which covers both providers the
same way. Harness transcripts (Claude JSONL, Codex rollout files) stay where they are; the menu
can offer "Copy transcript path" if a harness file is wanted.

## Decisions

- **D1 — Where the export is built.** Recommended: a pure formatter in the chat feature over the
  session's projected messages and activities, run in the web. First verify that the web
  projection holds the whole session rather than a loaded window; if it does not, the formatter
  runs on the server behind a read endpoint (a query, not a mutation).
- **D2 — Tool output.** Recommended: Markdown includes each tool call's label and summary, not its
  full output; JSON includes everything the projection has.

## Steps

1. `utils/transcript-export.ts`: `transcriptMarkdown(session)` and `transcriptJson(session)`,
   pure, with a test per shape (user message, assistant markdown, plan, tool call, approval,
   attachment reference).
2. Session actions menu: "Export as Markdown", "Export as JSON", "Copy as Markdown", enabled for
   any session with messages.
3. Download through the same helper the plan card uses; move `downloadPlanMarkdown` to a shared
   place only when it has two consumers (the `lib/` rule), and name it for what it does.
4. Nothing is written to the workspace or the server, so no mutation is involved. If a later
   "save into the workspace" option is added, it is a mutation with a key from the feature's
   `mutation-keys.ts`.

## Verification

- Formatter tests over a fixture session built with `test/factories/`.
- Real run: export a session with a plan, a tool call and an image; open the Markdown; the JSON
  parses and has the same message count as the timeline.
- `bun run agent:browser look` on the session menu.

## Not copied

- Public share links and auto-share (OpenCode `packages/opencode/src/share`): the transcript would
  live on a third-party server. The mesh is private; export covers the need.
