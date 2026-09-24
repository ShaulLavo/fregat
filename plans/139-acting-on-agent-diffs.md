# Plan 139: Act on the agent's diff

## Status and authorization

- Status: RESEARCH PLAN — scope agreed by the owner 2026-09-24; the research phase rewrites
  "Phases" before implementation, and may split review mode into its own plan.
- Priority: P1. `docs/product-vision.md` makes the diff the reviewable artifact under every
  harness, and today it ends in a view the user cannot act on.
- Effort: L overall. Risk: MED — per-hunk undo writes to a worktree an agent may still be
  writing to.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (VS Code
  chat editing, Void, Orca, Codex app-server, OpenCode, Copilot review, pstack `interrogate`).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

After a turn, the user steps through what the agent changed and undoes any single hunk or file
without reverting the whole turn. They leave several line-anchored comments across the diff and
send them to the agent as one message. They can ask an agent — the same one or a second model —
to review a change, and the findings land as comments on the diff lines they refer to. A proposed
plan takes the same line comments before it is approved.

## What exists today

- Checkpoints are git refs per turn: `refs/platform/checkpoints/<session>/turn/<n>`
  (`apps/server/src/orchestration/checkpoint-refs.ts`). Turn diffs are read through
  `orchestration/checkpoint-diff-query.ts` and `apps/web/src/features/chat/utils/checkpoint-diff-query.ts`.
- Turn files are a read-only list: `apps/web/src/features/chat-mode/components/turn-files.tsx`
  renders `GitFileRow`s; `features/chat/hooks/use-open-checkpoint-diff-document.ts` opens the
  diff.
- Undo is whole-turn only: `features/chat/components/checkpoint-revert-dialog.tsx` →
  `session.checkpoint-revert-requested` → `revertCheckpoint` in
  `apps/server/src/orchestration/provider-command-reactor.ts:536`, which runs
  `assertRewindIsolation` and `git.restoreRef`.
- A reverse-patch primitive exists with no client caller: `POST /git/apply-patch`
  (`apps/server/src/git/routes.ts:94`) → `GitService.applyPatch` (`git/service.ts:467`) runs
  `git apply [--cached] [--reverse]`.
- Diff line comments attach one range at a time:
  `features/git/components/diff-line-comment-action.tsx` calls `attachText` from
  `features/chat/hooks/use-attach-to-composer.ts`. That cross-feature import is frozen in
  `scripts/lint/web-feature-allow.json` with a "move to lib" reason.
- Plans: `features/chat/components/proposed-plan-card.tsx` offers copy and download;
  `plan-follow-up-banner.tsx` offers implementation. No line feedback.
- Review: Codex `review/start` is not in the generated method list
  (`apps/server/src/provider/adapters/codex-protocol/generate.ts`). A second model is used only
  for commit messages, via `apps/server/src/provider/text-generation.ts`.
- Scenarios to extend: `checkpoint-rewind`, `checkpoint-states`, `git-diff-line-comment`
  (`scripts/agent/scenarios/`).

## What the references do

| Reference | Feature                                                      | Paths                                                                                                               |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| VS Code   | Keep/undo per hunk and file, "n of m" stepping, overlay      | `src/vs/workbench/contrib/chat/browser/chatEditing/` (`chatEditingEditorOverlay.ts`, `chatEditingEditorActions.ts`) |
| VS Code   | Line-anchored feedback on a plan                             | `src/vs/workbench/contrib/chat/browser/planReviewFeedback/`                                                         |
| Void      | Accept/reject diff zones and a command bar                   | `src/vs/workbench/contrib/void/browser/editCodeService.ts`, `voidCommandBarService.ts`                              |
| Orca      | Batched diff comments that follow their line, then send      | `src/renderer/src/components/diff-comments/` (`diff-comment-line-range.ts`)                                         |
| Codex     | `review/start` over uncommitted, base branch, commit, custom | `codex-rs/app-server-protocol/src/protocol/v2/review.rs`                                                            |
| Copilot   | Review with applicable comments                              | `extensions/copilot/src/extension/review/node/doReview.ts`                                                          |
| pstack    | Adversarial review by other models, judged by a lead         | `skills/interrogate/` (`references/rubric.md`, `lead-judgment.md`)                                                  |

## Scope

1. Undo one hunk or one file of a turn's diff, from the turn view and from the diff itself.
2. Step through a turn's changes hunk by hunk ("n of m"), with the undo action on each.
3. A review draft: many line-anchored comments across files, sent to the agent as one message.
4. Comments keep their line while the diff shifts, and can be resolved.
5. Review mode: ask a provider to review uncommitted changes, a turn, a branch or a commit.
6. Review findings render as comments on the diff lines they cite.
7. Second-model review: run the review on a different provider or model than the one that wrote the change.
8. Line comments on a proposed plan, sent with "refine".
9. Move `useAttachToComposer` out of `features/chat` so git, terminal, editor and this plan stop importing across features.

## Decisions

- **D1 — What "keep" means.** The agent's edits are already on disk, so VS Code's accept has no
  equivalent. Recommended: no keep action; a hunk is either left alone or undone, and stepping
  tracks position only. Alternative: persist per-hunk "reviewed" marks.
- **D2 — Undo against which base.** Recommended: reverse-apply the hunk from the turn's
  checkpoint diff to the working tree, and refuse with a named reason when later edits overlap
  (git apply fails) rather than forcing it.
- **D3 — Where findings live.** Recommended: findings are comments in the same review-draft
  model as the user's own (scope 3), marked by author, so one surface serves both directions.
- **D4 — Second-model default.** Recommended: the user picks the reviewer per request; a
  remembered default is a setting (application scope) only after the flow is used.

## Research phase

Answer, then rewrite "Phases" (and split review mode into its own plan if it is larger than
M):

1. Hunk addressing: what the diff plugin (`@singapore-editor/diff`, `diffRowAtEvent`) exposes
   per hunk, and whether a hunk can be turned into a patch the server applies in reverse without
   re-diffing.
2. Safety: does `assertRewindIsolation` cover a per-hunk write, or does a running turn need a
   different guard? Read `provider-command-reactor.ts` and the checkpoint reactor.
3. After a hunk undo, what the next checkpoint captures, and whether the turn diff view must
   invalidate (`checkpoint-diff-query`) or re-read.
4. Comment anchoring: read Orca's `diff-comment-line-range.ts`; pick an anchor (path, side, line
   range, content hash) that survives a re-render and a new turn.
5. Review mode per provider: wire Codex `review/start` (inline delivery; detached is
   deprecated); find what Claude Code offers (its `/review` command in our command catalog, or a
   prompt contract) and how findings can be parsed back to file and line.
6. Second-model review: can `text-generation.ts` carry a diff-sized review, or does it need a
   full session turn? Measure the prompt size on a real turn.
7. Plan comments: how `proposed-plan-card.tsx` renders markdown lines, and whether the diff
   comment model can anchor to plan lines.

Deliverable: rewritten Phases with named files, mutations and mutation keys, scenarios, and the
list of settings (if any) with their scopes.

## Phases (provisional)

1. Move `useAttachToComposer` to its shared home; composer inbox entries carry environment and
   root (the gap `docs/diagnostic-ai-fix-plan.md` step 4 also names).
2. Per-hunk and per-file undo over the checkpoint diff, as a keyed mutation that settles the
   checkpoint and git status queries; stepping in the diff view.
3. Review draft: multi-comment model, anchoring, resolve, one send.
4. Review mode on Codex, then Claude; findings as comments.
5. Second-model review.
6. Plan line comments.

## Verification

- Each phase: `bun run agent:browser look` on the changed surface; extend `checkpoint-rewind`
  and `git-diff-line-comment`, and add a scenario for hunk undo on a real temp repo.
- Hunk undo: server test driving `applyPatch` through real routes on a `git init` repo,
  including the overlap refusal.
- Logs: one wide event per undo and per review send (hunk count, outcome, refusal reason); no
  diff text in logs.
- Deploy with `bun run deploy --server` for phases that change the server.

## Out of scope and not copied

- Streaming model edits into open editors (Void diff zones): the agent already writes to disk,
  and a second writer would conflict.
- Chat-only revert that leaves files changed (Codex `thread/revert`).
- LLM-judged risk scores on changes.
- Side-by-side compare of several agents' results: held in reserve by `docs/product-vision.md`.
