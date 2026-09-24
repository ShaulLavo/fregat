# 145 · Fork a session from any turn

- Status: PROPOSED.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

"Fork from here" on any completed turn creates a new session that carries the conversation up to
and including that turn. The original session is untouched. The fork appears in the rail next to
its source and runs in the same project and checkout.

## What exists today

- Platform never forks. `apps/server/src/provider/adapters/utils/claude-query-options.ts`, above
  `claudeSessionOptions`: "`resume` and `sessionId` are mutually exclusive — the SDK rejects the
  pair unless `forkSession` rides along, which we never want."
- Rewind rewrites the current session instead: `apps/web/src/features/chat/utils/rewind.ts`
  restores the rewound message into the composer; the server side is
  `orchestration/rewind-admission.ts` and `provider-command-reactor.ts`.
- Claude cannot rewind its conversation at all: `ClaudeProviderAdapter.prepareRollbackSession`
  throws ("Claude prepareRollbackSession is not supported.", `claude.ts` ~337). Codex rewinds with
  `thread/revert` (`utils/codex-rewind.ts`).
- Claude turn ids are synthetic (`claude-turn:<uuid>`, `claude.ts` ~658); the adapter does not
  record the SDK message UUIDs a fork point needs.

## Harness support

- Claude (verified, `sdk.d.ts`): `forkSession(sessionId, { dir?, upToMessageId?, title? })` copies
  the transcript into a new session with fresh UUIDs and returns `{ sessionId }`. "Forked sessions
  start without undo history (file-history snapshots are not copied)." `getSessionMessages` reads a
  transcript and is already used by `apps/server/src/provider/claude-discovery-worker.ts`.
- Codex (verified in installed 0.156.1; absent from our pinned schema): `thread/fork` with
  `threadId` and `lastTurnId` ("turns after `last_turn_id` are omitted … cannot be in progress").

## Decisions

- **D1 — Fork point.** Recommended: completed turns only, inclusive of that turn's reply. Matches
  both harnesses' constraints.
- **D2 — Files.** Recommended: a fork shares the source's checkout and does not restore files;
  the dialog says so. Forking into a new worktree is a follow-up, and the compare view stays in
  reserve per `docs/product-vision.md`.
- **D3 — Claude rewind.** Recommended: out of scope here, but record that fork-then-archive is a
  possible Claude conversation rewind for a later plan.

## Steps

1. Codex schema refresh (see the index), adding `thread/fork`.
2. Adapter operation `forkSession({ sessionId, throughTurnId })` behind a capability flag.
   - Claude: resolve the turn to the last SDK message UUID of that turn by reading the transcript
     with `getSessionMessages` (count user prompts), then `forkSession`. Start the new Platform
     session with `resume` set to the returned id.
   - Codex: `thread/fork` with `lastTurnId`, then bind the new thread.
3. Orchestration command that creates the forked session record with the source's project,
   checkout and model selection, and a `forkedFrom { sessionId, turnId }` field for the rail.
4. Web: "Fork from here" in the message menu (`chat/utils/message-menu.ts`) for completed turns,
   run as a mutation; navigate to the new session on success.

## Verification

- Server tests: the Claude path through the `createQuery` seam with a fixture transcript; the
  Codex path through the Codex test client. Forking an in-progress turn is rejected with a catalog
  error.
- Real run on each provider: fork turn 2 of a 3-turn session; the fork answers a question about
  turn 2 and knows nothing of turn 3; the source still has 3 turns.
- `bun run agent:browser look` on the message menu and the rail showing the fork.

## Not copied

- Codex `thread/revert`-style chat-only rewind that leaves files changed: forks do not claim to
  restore files.
- A fork compare view: held in reserve by the product vision.
