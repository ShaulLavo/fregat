# Chat

Agent sessions per project, with a rail of projects and sessions, worktrees, and the composer.

## Sub-features

Create session, send a message, stop the agent, rename, archive, delete, project rename and delete, worktree cleanup, session search.

## How to get to it (user POV)

The chat mode button in the window toolbar, or an address URL with `/chat/`.

## Driving it with agent:browser

`scenario sidebar-settings-button` checks Settings in both workspace modes and verifies chat's tool pane still collapses and reopens without losing its shared app actions.

`scenario chat-follow-up` creates a verification session with the selected provider, sends a correction after commentary while a shell command runs, then closes only that session's runtime through the command API and resumes it with another message. It uses real provider tokens and leaves its transcript for inspection. `caches` shows chat mutations while an action is in flight; `bun run logs --area chat` shows the command wide event.

`scenario chat-timeline` reads an existing conversation without sending messages, verifies that measured rows do not overlap, scrolls to earlier content, and returns to the latest message. It requires an existing transcript longer than the viewport.

`scenario chat-icon-hints` hovers the model-options control, opens its menu, attaches a temporary image and opens its preview, then stashes and removes a draft prompt. Each control must show the shared tooltip without a native title. It clears its local draft and sends no message.

## Gotchas

`scenario chat-diff-syntax --url <session-diff-address>` checks painted syntax colors in a session checkpoint diff.

Commands dispatch over the orchestration socket when it is live and over HTTP otherwise. The HTTP path refetches the shell snapshot itself.
