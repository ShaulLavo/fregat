# Plan 161: Honest states — approvals, stopped turns, streaming, folding

## Status and authorization

- Status: PROPOSED — ready; D1–D4 accepted as recommended on 2026-09-25. The owner asked for it on 2026-09-25.
- Priority: P1 in the UI refresh lane. Two tabs, a double click and a restart mid-approval are
  daily events now that Platform is the owner's main agent tool.
- Effort: M–L. Server: approval admission, request lifetime and turn end reasons. Web: the
  approval panel and receipts, the stopped-turn row, one markdown rule, a reproduction for a code
  flash, and folding tests.
- Risk: MED. Approval admission changes a command the harness answers; every change keeps today's
  happy path byte for byte and adds refusal paths only.
- Depends on: [Plan 131](131-provider-codes-not-prose.md) Phase 2 for the "request is gone" code
  (step 1.3 below). Try again gets better once the [Plan 145 fork](145-harness-controls/fork.md)
  lands (D1).
- Planned at: Platform `9c1c45d1`, 2026-09-25. Research:
  [scrimui.md](../docs/ui-research/scrimui.md) (the per-component failure modes, the approval
  gate, the streaming-markdown hold), [tinkerers-ui.md](../docs/ui-research/tinkerers-ui.md) item 1
  (stopped run), [agentui.md](../docs/ui-research/agentui.md) items 1 and 4,
  [ai-elements.md](../docs/ui-research/ai-elements.md) item 5, and
  [seamui.md](../docs/ui-research/seamui.md) (the permission-card receipt). Clones in `references/`.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Server changes: deploy with `bun run deploy --server`.

## Outcome

Every agent surface tells the truth about its state, including under hostile conditions:

- A double click, two tabs or a retried request produces one approval decision.
- An answer that arrived too late never shows as allowed.
- A pending approval admits it may already have been answered while the socket reconnects.
- An approval whose turn ended says so instead of hanging.
- The transcript keeps what was decided.
- A stopped turn looks unfinished, says why it stopped, and offers Carry on and Try again.
- Streaming text never renders a half-token wrong, and code keeps its colours as it streams.
- Folded work never hides a failure or a wait.
- Each of these has a named hostile state and a scenario that drives it.

## 1. Approvals

### What exists (verified)

- **Admission.** `apps/server/src/orchestration/decider.ts:198` turns every
  `session.approval.respond` into `session.approval-response-requested` after checking only that the
  session is not deleted. It does not check that the request is still open. `command-receipts.ts`
  dedupes by `commandId`, so a network retry of the same command is already safe. A second click
  or a second tab creates a new command and gets through.
- **The second answer.** `provider-command-reactor.ts:631` forwards it. The adapter no longer has
  the request (`claude.ts:829`, `codex.ts:825`: `Unknown pending approval request`). The reactor
  rewrites that into a synthesized `stale pending …` sentence (`provider-command-reactor.ts:1005`)
  and appends `provider.approval.respond.failed`. The server fold (`pending-requests.ts`) matches
  that prose to close the request. Plan 131 row 3 already names these string matchers as a defect.
- **Client in-flight state.** `features/chat/providers/pending-requests-provider.tsx` keeps
  `submitting` / `accepted` / `failed` in a per-tab `useState` map. That breaks the `AGENTS.md` rule
  that in-flight state is a TanStack mutation (`useMutationState`), and it is why a second tab
  never sees that the first is sending.
- **Buttons.** `pending-approval-actions.tsx` already keeps the buttons visible and disables them
  while submitting or accepted, and `pending-request-feedback.tsx` says "Sending response…" and then
  "Response sent. Waiting for agent…". This part of scrim's rule is met; keep it.
- **Connection.** `chat-view.tsx:83` sets `disabledReason` whenever the composer connection is not
  live, and the buttons disable. The panel never shows the reason, and never says the request may
  already be decided elsewhere.
- **Lifetime.** Neither harness expires an approval. A request dies with its turn. On an interrupt,
  Claude's `abortApproval` (`claude.ts:1883`) resolves the SDK callback with a deny and **emits no
  `request.resolved`**. Codex emits one through `serverRequest/resolved` (`codex.ts:1299`). The
  client derives open approvals as requested minus resolved (`client-core/src/chat/pending-approvals.ts:62`).
  It does not close them on dead-request failures, as the server fold does, or when the turn
  settles. From reading the code, an approval open at a Claude interrupt or a server restart stays
  on screen with live buttons. Reproduce this first (step 1.1).
- **Receipt.** Ingestion writes `approval.resolved` with the decision (`provider-runtime-ingestion.ts:958`).
  The work-log row title is the constant "Approval resolved" (`activity-presentation.ts:158`), so the
  transcript does not say what was allowed. `live-activity.ts:72` already pairs requested and
  resolved rows by `requestId`.

### Change

1. **Reproduce the lingering approval.** Add a `native-codex.mjs` fixture branch plus a Claude
   `createQuery` server test: open an approval, interrupt the turn, and assert the panel and the
   open-request fold. Fix only what reproduces.
2. **Admission is idempotent by request id.** In the decider, look the request up through the same
   fold `pending-requests.ts` uses, over `model` session activities, as `session.user-input.dismiss`
   already does. If it was already answered with the same decision, accept as a no-op that returns
   the recorded outcome. If it was answered with a different decision, refuse with a catalog error
   `APPROVAL_ALREADY_DECIDED` that carries the recorded decision. If it is gone, refuse with
   `APPROVAL_REQUEST_ENDED`. The adapter never sees a second answer.
3. **Gone is a code.** The adapters raise a coded error for an unknown request (Plan 131 Phase 2),
   the fold and the reactor branch on the code, and the synthesized `stale pending` sentence is
   deleted. If Plan 131 Phase 2 has not landed, do its row 3 here first.
4. **A request ends with its turn.** When a turn completes, is interrupted or is recovered at boot,
   every approval still open for that turn gets an `approval.resolved` with `resolution: 'ended'` and
   no decision. Claude's `abortApproval` emits the same through `request.resolved`. The client
   derivation also closes an approval whose turn has settled. "Ended" is therefore derived from
   turn state and renders correctly on any later reload.
5. **Late answers.** An answer the harness received after it stopped waiting is recorded as
   `stale`. The panel says "Your answer arrived after the agent stopped waiting. It was not used."
   in muted text, never as a success and never as an error toast.
6. **In-flight state is a mutation.** `respondToApproval` becomes a `useMutation` with a
   `mutationKey` from the chat feature's `mutation-keys.ts` and `scope: { id: requestId }`, so a
   double click queues behind the first and then observes that the request is already answered.
   `responseState` reads `useMutationState`. The per-tab `useState` map is deleted. The user-input
   responses move with it.
7. **Connection-aware pending.** While the composer connection is not live, the panel keeps the
   request, disables the buttons, and shows `disabledReason` plus "It may already have been answered
   in another window." The line is replaced by the true state on reconnect.
8. **Receipts.** The `approval.resolved` row title comes from the decision: "Allowed once",
   "Allowed for this session", "Always allowed in this project", "Always allowed", "Denied",
   "Cancelled", "Ended unanswered" or "Answer not used". Labels come from
   `utils/approval-presentation.ts`, the same place the buttons get theirs. The detail shows the
   request's key/value arguments (command, cwd, path) when they parse (agentui item 4), with the
   `<pre>` fallback.

## 2. Stopped turns

### What exists (verified)

- A turn ends as `completed`, `interrupted` or `error` (`contracts/src/chat-model.ts:349`), with no
  reason. `timeline-items.ts` labels every interrupted turn "You stopped after N"
  (`appendEmptyTurnStatus`, `turnFoldLabel`). That includes the turns boot recovery marks interrupted
  after a `--server` deploy (`projection-pipeline.ts` `recoverRuntime`), so the transcript blames the
  user for a restart. The runtime alert already titles that case "Turn interrupted"
  (`runtime-state.ts:158`); the transcript disagrees with it.
- Claude maps result subtypes to `completed`, `interrupted` or a rejected turn (`claude.ts:1552`);
  Codex maps turn status. Neither passes on why a turn failed: output limit, turn limit, refusal,
  provider error.
- The partial assistant message of an unfinished turn renders exactly like a finished one.
- There is no Carry on and no Try again. Claude has no rewind (`prepareRollbackSession` throws,
  `claude.ts:436`); Codex has `thread/revert` (`codex.ts:330`).

### Change

1. **An end reason on the turn.** `endReason` on the turn projection and `latestTurn`, as a code:
   `user-stop`, `server-restart`, `runtime-stopped`, `output-limit`, `turn-limit`, `refusal` or
   `provider-error`. The first three come from our own events (`session.turn-interrupt-requested`,
   `session.runtime-recovered`, `session.runtime-stop-requested`). The rest come from what each
   harness reports. The research step lists exactly which Claude result subtypes and `stop_reason`
   values, and which Codex turn statuses and error codes, exist. Anything unmapped is
   `provider-error`, never a guess.
2. **The row.** The partial answer keeps its text but gets a bottom fade mask (a token, in the
   primitive; not the scroll-fade from Plan 157) and `aria-label="Incomplete answer"`. The status
   line reads by reason, with the existing elapsed format:

   | Reason            | Line                                                    |
   | ----------------- | ------------------------------------------------------- |
   | `user-stop`       | You stopped it after 42s                                |
   | `server-restart`  | Interrupted by a server restart after 42s               |
   | `runtime-stopped` | The session was stopped after 42s                       |
   | `output-limit`    | Hit the output limit after 42s                          |
   | `turn-limit`      | Hit the turn limit after 42s                            |
   | `refusal`         | The model declined to continue                          |
   | `provider-error`  | Failed after 42s (the error stays in the runtime alert) |

3. **Carry on and Try again**, on the latest turn only, when nothing is running.
   - **Carry on** sends a new turn in the same session with a fixed continuation prompt (D2). Both
     harnesses keep the conversation, so no resume API is involved.
   - **Try again** re-sends the stopped turn's user message and attachments as a new turn (D1).
   - Both are TanStack mutations on the existing send path, so the queue and steering rules apply
     unchanged.
4. **Reading position.** A new attempt never pulls a reader who is scrolled up in an older one.
   The timeline follows only in `following-end` (`timeline-viewport.tsx`). A scenario pins this.

## 3. Streaming

1. **Hold an ambiguous tail.** `packages/markdown/src/utils/session.ts` `healedTail` runs remend on
   the live tail. Add a hold before it: while the stream is live, a trailing construct that cannot
   yet be rendered right renders nothing for one delta. That covers a line of only `#` marks, an
   unmatched trailing backtick run outside a fence, a list marker with nothing after it, and a
   table row with no separator row yet. Settled text is never held, and the hold never lasts past
   the next delta or the stream's end. Tests go in `packages/markdown/src/utils/tests/session.test.ts`.
   It matters most in `token` streaming mode (`chat.responseStreamingMode`).
2. **Code-block colour while streaming: reproduce before fixing.** Reading
   `packages/markdown/src/hooks/use-highlighted-code.ts`: every chunk changes the cache key, the
   render returns `null` (plain text) until the effect's highlight result lands, and passive effects
   run after paint. So each chunk may paint one frame of plain code. Prove it first:
   - Add a `native-codex.mjs` branch that streams a fenced TypeScript block in about ten
     `item/agentMessage/delta` chunks, with `token` streaming mode.
   - A scenario samples the streaming block every animation frame (the `countBlankFrames` pattern
     in `scripts/agent/blank-frames.ts`) and fails if the count of coloured token spans ever drops.

   Only if it drops, fix it. Either keep the previous tokens and render only the new tail plain
   when the new code extends the old (agentui), or take the synchronous highlight result during
   render when the grammar is loaded. Choose by `compiler:explain` and a `trace`. If it does not
   reproduce, record that in this plan and close the item.

## 4. Work-log folding

### What exists (verified)

The rule already mostly holds:

- `work-log.ts` `collapseWorkLogEntries` folds a tool call's lifecycle by provider call id, and
  merges text-keyed neighbours only while the earlier one has not completed. The same command run
  twice stays two rows.
- `activity-group-row.tsx` keeps failures, approvals and user-input rows visible in a collapsed
  group.
- `timeline-items.ts` keeps failed entries out of turn folds.

### Change

Pin it, and close the gaps. Tests in `utils/tests/work-log.test.ts` and `timeline-items.test.ts`:

- a failed, waiting or running entry is never hidden by any fold
- a retry (new call id, same command) appends a row and never rewrites the failed one
- a lifecycle merge never turns a failed row into a success unless that same call completed

Add `running` to the always-visible filter if the tests show a running entry can sit inside a
collapsed group.

## 5. Hostile states per surface

Scrim's reusable idea: each component page lists the states it must survive. Add a **Hostile
states** section to `.agents/skills/verify-fregat/features/chat.md`, one short list per surface
(approval panel, user-input panel, timeline stream, stopped turn, queue, composer, changed files).
Each state names the scenario that drives it. Seed list:

| Surface      | Hostile state                                           | Scenario                                          |
| ------------ | ------------------------------------------------------- | ------------------------------------------------- |
| Approval     | two tabs answer; double click; reload while sending     | `approval-two-tabs`                               |
| Approval     | the turn is interrupted while the approval is open      | `approval-turn-ended`                             |
| Approval     | the socket drops while pending                          | `approval-reconnect`                              |
| Stopped turn | user stop vs `--server` restart vs error                | `stopped-turn-reasons`                            |
| Stream       | a code fence streams in chunks                          | `stream-code-colour`                              |
| Stream       | the tail ends in `#`, a backtick or a table row         | `stream-ambiguous-tail`                           |
| Timeline     | a new attempt arrives while the reader is scrolled up   | `stopped-turn-reasons`                            |
| Lists        | empty vs failed vs pending (changed files, agents, MCP) | existing `checkpoint-states` plus component tests |

All of them run on the native fixtures (`scripts/agent/fixtures/native-codex.mjs`, the
`isolatedNativeScenario` harness), so none spends provider tokens. Two tabs means two browser
contexts on one isolated server. Selectors go in `scripts/agent/selectors.ts`, with a feature-map
line per scenario.

## Order

1. Reproductions: the lingering approval (1.1) and the code-colour flash (3.2).
2. Approvals: codes (1.3, or confirm Plan 131 Phase 2), admission (1.2), request lifetime (1.4),
   the mutation (1.6), then the panel and receipts (1.5, 1.7, 1.8).
3. Turn end reasons and the stopped row (2.1, 2.2), then Carry on and Try again (2.3, 2.4).
4. The markdown hold (3.1), and the code-colour fix if it reproduced.
5. Folding tests (4).
6. The hostile-states section and the remaining scenarios (5).

Each step lands green and deploys on its own.

## Decisions

Decided 2026-09-25: the owner accepted every recommendation below ("whatever seems best"). The
alternatives stay only as a record of what was weighed.

- **D1 — What Try again means.** Recommended: re-send the prompt as a new turn now. The partial
  answer stays in the harness's context, and the button's tooltip says so. When the Plan 145 fork
  lands, Try again forks from before the stopped turn instead (Codex can already revert). The
  alternative is to ship Try again only with the fork.
- **D2 — Carry on.** Recommended: send a fixed continuation prompt ("Continue from where you
  stopped.") immediately. The alternative is to put it in the composer for editing first.
- **D3 — Unanswered approvals of ended turns.** Recommended: keep an "Ended unanswered" receipt in
  the transcript. The alternative is to remove them silently.
- **D4 — Where the markdown hold applies.** Recommended: every live stream, whatever the streaming
  mode; it costs nothing when the tail is unambiguous. The alternative is `token` mode only.

## Verification

- Server tests through the real in-process server and `MockProviderAdapter`:
  - two responds with the same decision give one adapter call and one success
  - different decisions refuse with `APPROVAL_ALREADY_DECIDED`
  - a respond after the turn ended refuses with `APPROVAL_REQUEST_ENDED`
  - interrupt and boot recovery close open approvals with `ended`
  - `endReason` for each of our own causes
- Claude adapter tests through the `createQuery` seam: `abortApproval` emits `request.resolved`,
  and the result subtypes map to their `endReason`.
- Web tests: derived pending approvals close on turn settle, receipt titles per decision, the
  stopped-row line per reason, and the markdown hold cases.
- The scenarios in section 5, each read back from its evidence directory. `caches` during a double
  click shows one approval mutation per request id.
- `bun run logs --area chat`: the approval wide event carries `outcome` (`decided`, `duplicate`,
  `ended`, `stale`), and a stopped turn carries `endReason`. No tool input is logged.
- `bun run gates`, `bun run errors:census` (new catalog entries carry facts in `internal`), and
  `bun run compiler:memos` on the touched components.
- Deploy with `bun run deploy --server` and check `GET /platform/release`.

## Not in this plan

- The turn anatomy (reasoning fold, tool group receipts, live tail, plan step marks): the chat
  turn plan.
- Context and cost honesty: [Plan 162](162-context-and-cost.md).
- Per-hunk accept of agent changes: [Plan 139](139-acting-on-agent-diffs.md).
- Response versions and sources: Platform has neither today. The reading-position rule in 2.4
  covers the one case that exists, a new attempt below an old one.
