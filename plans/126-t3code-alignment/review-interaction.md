# Independent review of interaction.md

Reviewed against Platform `3c9b88c35784e571e706600b0cee8e95a2656f77` and pinned T3 Code `7445aa733ada33e45289e5aa5055f79142556513`, using Git object reads for upstream. Scope: queued sends/Stop, attachments/stash, questions, rewind, multi-model sends, source context/workflows, and compaction/usage overlap. No source edits or tests executed. Only this review was written.

The core gaps are supported. The report needs one material correction, two additional behavior requirements, and a missing runtime dependency before its plan is complete.

## Material correction

### REVIEW-I01 — Preserve the working diff-selection entry point

- **Applies to:** INTERACTION-09; HIGH confidence.
- **Evidence:** Local `apps/web/src/features/git/components/diff-line-comment-action.tsx:54-71` captures precise selected rows; `:85-95` resolves them against the stacked diff and calls `attachText('git-diff', diffLineSelectionText(...))`. `apps/web/src/features/git/utils/diff-line-selection.ts:117-133` serializes file path, old/new line addresses and selected lines. `apps/web/src/features/chat/hooks/use-attach-to-composer.ts:63-69` queues the text and reveals the composer. Upstream structured review attachment consumer remains `apps/web/src/components/diffs/AnnotatableCodeView.tsx:207` at the pinned commit.
- **Correction:** “Users cannot send a precise review selection” is false. They can send precise diff text today, including its path/range. The missing behavior is structured provenance, a separately editable review comment/context chip, and return navigation to the exact source; browser annotations and assistant-selection citations remain separate valid gaps.
- **Implementation consequence:** Extend the existing diff selection/attachment boundary to carry typed context. Do not build a second selection control or remove the existing plain-text serialization without preserving provider input semantics.
- **Acceptance addition:** Existing split/stacked diff selection still sends both sides with correct path/range; new source navigation resolves the recorded environment/resource and reports unavailable source rather than jumping to unrelated lines. Keep `features/git/utils/tests/diff-line-selection.test.ts` and `features/chat/hooks/tests/use-attach-to-composer.test.tsx` as characterization owners.

## Missing requirements and dependencies

### REVIEW-I02 — Specify Stop's restore order and held overflow

- **Applies to:** INTERACTION-01; HIGH confidence; P1 plan refinement.
- **Evidence:** Upstream `apps/web/src/components/ChatView.tsx:3971-3983` drains queued messages back into the composer before awaiting the interrupt RPC. `:7203-7208` appends queued prompts after the current draft. `:7209-7241` respects the shared eight-attachment capacity and requeues excess attachments with `holdUntilUserAction:true`; `:7243-7247` tells the user to use Send now. `:7651-7658` immediately clears moved attachment refs to prevent an immediate Stop restoring them twice.
- **Refinement:** The present “Stop drains/restores exactly once” acceptance is necessary but insufficient. Restored overflow is held for explicit action; restoration must not automatically submit that content at the next tool boundary. A failed interrupt still leaves the user's queued content recovered because restore happens first.
- **Acceptance additions:** With a nonempty draft and queued content totaling more than eight attachments, Stop retains every attachment exactly once, fills available composer capacity, and leaves the remainder visibly queued/held. Later tool completion does not send the held remainder. Interrupt RPC rejection does not re-hide restored content. The queue/settings/request gates and alternate-send behavior in INTERACTION-01 were independently confirmed at upstream `:7630-7659,8604-8660`.

### REVIEW-I03 — Implement async question ingestion and reply semantics before dismissal UI

- **Applies to:** INTERACTION-04 plus runtime; HIGH confidence; P1 missing prerequisite.
- **Evidence:** Upstream `apps/server/src/provider/Layers/CodexAdapter.ts:1691-1707` turns a completed `agentMessage` with `delivery:'async'` and `questions` into `user-input.requested`, with `responseMode:'message'` and stable native-item-derived IDs. Upstream `apps/server/src/orchestration/decider.ts:1662-1690` atomically records resolution and starts/steers a message-based reply; `:1766-1773` allows dismissal only for that response mode. Local `apps/server/src/provider/adapters/codex.ts:1552-1586` treats completed assistant messages as text/item completion; `apps/server/src/provider/types.ts:240-246` has questions but no response mode. Search for `responseMode`, `dismissible`, and async-question paths in local provider/orchestration/contracts found no corresponding production model.
- **Correction to impact:** The local limitation is not only an optional question panel staying open. These upstream asynchronous native questions do not enter the equivalent local interaction path in the first place. The current blocking callback question path must remain separate.
- **Implementation boundary:** Add native async-question normalization, stable request identity and `responseMode` to projection/contracts; implement message-based answers and durable dismissal; then add UI controls and per-question attachments. Do not respond to an async notification using a stored JSON-RPC callback that never existed.
- **Acceptance additions:** A completed async assistant item creates exactly one dismissible request; replay does not duplicate it. Answer while parent running steers the correct session, answer while idle resumes it; resolution and message commit together. Dismiss sends no provider message. A native `item/tool/requestUserInput` callback remains nondismissible and responds through its original JSON-RPC request. Each carries independent parent/child and environment ownership.

### REVIEW-I04 — Record the hidden-by-default Plan and context-meter controls

- **Applies to:** INTERACTION-11 / settings inventory; HIGH confidence; P2 additional default mismatch.
- **Evidence:** Upstream `packages/contracts/src/settings.ts:426,429` defaults `planModeEnabled` and `contextWindowMeterEnabled` to false. These are consumed, not inert: `apps/web/src/components/chat/ChatComposer.tsx:2006-2010` resolves interaction availability; `:4928,5056` gates the mode toggle; `:6978-6979` passes context usage only when the meter setting is enabled. Local `apps/web/src/features/chat/components/composer-controls-menu.tsx:51-61,135-145` always offers Build/Plan, and `chat-input-actions.tsx:88` renders the context meter whenever usage exists. No matching setting was found in local chat/settings registry.
- **Refinement:** “Plans are present” and “context occupancy exists” remain correct feature statements, but are not matched presentation defaults. Record the opt-in settings and their actual consumers in the hard-alignment plan. Do not delete working plan follow-up functionality; match the controls' availability/defaults while preserving stored interaction state deliberately.
- **Acceptance:** Fresh settings hide legacy Plan toggle and context occupancy; opting in shows working controls. Quota windows remain separate and are not hidden by the context-meter switch. Changing the setting does not silently convert a pending message into a different mode without the upstream resolver semantics.

### REVIEW-I05 — Require an isolated worktree for each multi-model target

- **Applies to:** INTERACTION-08; HIGH confidence; P1 safety refinement to a P2 capability.
- **Evidence:** Upstream `apps/web/src/components/ChatView.tsx:7966-7980` uses per-target uncertain receipt identity; `:8007-8025` bootstraps each target with `prepareWorktree.requireWorktree:true`, a temporary branch, and setup script. This is stronger than merely assigning two session IDs.
- **Refinement:** Make separate prepared worktrees an explicit acceptance requirement. Two independently running models must not edit the same default project checkout because a local “owned session” contract is satisfied.
- **Acceptance additions:** Two selected models start on distinct isolated worktrees based on the chosen branch. Worktree preparation failure sends no provider turn for that target; other target receipt identity is preserved. An uncertain dispatched target is not retried as a fresh thread. Current INTERACTION-08 partial-success/ownership acceptance is otherwise supported.

## Confirmed claims and boundaries

- **Stash pairing defect confirmed.** Local `use-prompt-stash.ts:73-79` clears text only, leaving images and terminal slices in the draft; restore at `:53-64` swaps text only. Upstream `ChatComposer.tsx:4390-4417` snapshots images/files/context and blocks pending pasted attachment work. INTERACTION-03 should remain independent of general file upload delivery.
- **Attachment durability/general-file gap confirmed.** Upstream `composerDraftStore.ts:2363-2389,4054-4064` decodes persisted image bytes through the wired persisted store. `ChatView.tsx:7906-7925` gates uploaded file versus legacy image transport. Local `features/chat/utils/draft-storage.ts:28-31` explicitly omits images. The upstream attachment cap is exactly eight (`packages/contracts/src/orchestration.ts:166`). Do not claim every provider accepts every file; retain capability-gated fallbacks.
- **Rewind restoration confirmed.** Upstream `ChatView.tsx:7030-7049` checks pending preparation/capacity before the command; `:7051-7084` awaits canonical removal, then appends recalled text to the existing draft and restores attachments. Route checks at `:7085-7090` protect focus. Local `chat-view.tsx:364-390` only dispatches turn count and synchronization. INTERACTION-05 correctly depends on RUNTIME-01's preflight/isolation fix.
- **Question keyboard/dismiss/attachment controls confirmed.** Upstream `ComposerPendingUserInputPanel.tsx:137-165` guards digit selection against editable targets, modifiers and collapsed/responding state; `ChatView.tsx:8701-8758` scopes uploaded references to each question. Native async semantics need REVIEW-I03.
- **Workflow presentation path confirmed; backend completion still open.** Upstream `AgentsPanel.tsx:266-278` fetches a script using environment/thread ownership and `:524` consumes grouped agent model. Current local flat agent rows do not establish workflows. INTERACTION-12 appropriately avoids promising unverified direct side-agent controls; require protocol ingestion/script containment evidence before closing it.
- **Compaction and usage should stay single combined chains.** INTERACTION-06/RUNTIME-05 and INTERACTION-07/RUNTIME-08 reference distinct client and server boundaries. Do not implement duplicate command dispatch or account usage stores. No contradictory source finding emerged here.
- **Native permission approval regression is not covered by “responses present.”** RUNTIME-11 remains required even though generic command approvals/questions work; avoid summarizing the interaction coverage row as complete approval parity.

## Validation command review

Correction after author reconciliation: the registered name is `chat-timeline`; the source
filename is `chat-timeline-pattern.ts`. The original confirmation below confused the two.
The actionable interaction report uses the registered name.

Every existing test path in V1–V10 exists. Node-only commands name `.test.ts`; DOM commands name `.test.tsx`; mixed V2 selects both projects. This matches `apps/web/vitest.config.ts:24,35`. The separate browser-test path exists. Referenced scenarios `chat-follow-up`, `chat-model-picker`, `chat-timeline-pattern`, and `chat-diff-syntax` are registered in `scripts/agent/scenarios/index.ts`. No broken command or silently empty project selection was found by inspection.

No command was executed as a test, and no fresh pass result is claimed. Before implementation, add the new adversarial cases to the specified owners and ensure each browser scenario reaches the actual new controls. This bounded review did not fully execute file upload cleanup, all artifact-template parsing branches, editor undo/IME sequences, workflow native streams, or reconnect while answering questions; those remain acceptance work rather than inferred parity.
