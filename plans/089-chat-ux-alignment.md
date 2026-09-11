# Chat UX alignment

Reference: `references/t3code`, revision `d29c56a5`. Scope is the prompt-to-result chat experience, including progress, tool history, plans, requests, interruption, connection feedback, and scrolling. Shared platform controls, theme tokens, and loaders remain the implementation vocabulary.

## Verification contract

A user can identify the current action without opening raw tool output. One stable live timeline row survives reasoning/tool transitions. Completed work stays inspectable without burying the response. Sending, starting, waiting for a response, stopping, and disconnected states have visible and accessible feedback. Expanding history or reading older messages preserves the reader's position. Settled turns show truthful completion or interruption state.

Use focused tests of production derivation and components for lifecycle transitions, plus a reusable Playwright check against the running Vite server for actual layout, follow, disclosure, and narrow composer behavior. No new development server, real provider run, or mutation of saved user conversations is needed.

## Work sequence

- [x] Ground local reference and existing implementation; inspect logs and baseline working tree.
- [x] Capture the scroll baseline and establish focused component/lifecycle checks.
- [x] Normalize tool lifecycle and concise labels; preserve real reasoning and raw detail.
- [x] Derive a stable live row, compact historical groups, and truthful message/turn completion.
- [x] Wire composer progress, current plan, sending/stopping, request answers, and connection feedback.
- [x] Align anchor release, history expansion, nested scrolling, and jump-to-latest behavior.
- [x] Verify integrated rendering, types, focused tests, and changed-file lint; review the result independently.

## Ownership

- Parent: timeline derivation, live activity model/rendering, history row components, message metadata, integration and decision log.
- Timeline worker: work-log normalization, lifecycle, tool labels, activity visibility and their focused tests.
- Composer worker: chat view/composer/actions, approval and question responses, runtime notices and their focused tests.
- Scroll worker: timeline scroll component, anchoring helpers, scroll tests and live browser proof.

Workers write disjoint files. Cross-cutting contracts are agreed before edits. The parent inspects every worker diff and runs integration checks.

## Decisions

- Follow the local reference's behavior. Use truthful labels such as `Running rg`; do not invent the agent's intent from opaque shell commands.
- Keep current activity derivation in a pure feature utility. The timeline owns ordinary live progress; the composer owns plan progress, requests, commands, and connections, avoiding duplicate announcements.
- Explicit lifecycle status owns liveness. A successful tool completion does not mean the entire turn has finished.
- Preserve proposed plans as decisions and show executable step progress near the composer.
- Keep a decision trail at `/work/tmp/platform-chat-ux/decisions.tsv` and rendering evidence beside it.

## Backend boundary

Sending a second prompt while a turn runs remains unavailable. `apps/server/src/orchestration/decider.ts:720` rejects that transition with `START_STATE_CONFLICT`; `/work/tmp/platform-chat-ux/steering-contract-check.txt` records the contract/implementation search. This UI pass keeps draft/stash and Stop, and does not claim to add provider steering.

## Evidence limits

The before/after browser comparison swaps the two original scroll modules and proves the disclosure/follow fix. Work-state captures exercise the updated production components; they are not screenshots of a running T3 instance. Provider work and saved user conversations are not mutated by the proof. The existing preview requires `/platform/` and its original configured API origin, both restored from the captured baseline HTML when building.

## Completed verification

- Focused production tests passed across 20 test files; the final cleanup check passed after removing the obsolete history-selection helper and its tests.
- Final web typecheck and changed-file lint passed. Production build passed; the preview build preserves the existing base path and API URL.
- Real Chromium checks passed for disclosure/follow, viewport resize, action transitions, settlement, folded tool details, and physical inner scrolling at 320px above the production composer.
- The deployed preview loaded the connected workbench with no page errors.
- Independent GPT-5.6 Sol review prompted fixes to announcements, timestamp boundaries and verification assertions. Evidence and decisions are in `/work/tmp/platform-chat-ux/`.

## Review corrections

- Correlate provider interruption failures with their command ID. A failed Stop restores the control and displays its error; a previous failure cannot release a pending retry.
- Treat Ctrl+Home as transcript navigation and make the transcript focusable so native keyboard events reach its listener.
- Retain inner activity/output scroll positions across virtual unmounts. Follow appended content only while the reader is at its end. Share disclosure identity when a live work group moves into history.
- Display only trailing work in the live drawer. Keep response-wide detection for running tools and pending requests without duplicating earlier groups or reporting a completed action after newer commentary.
- Read Claude tool identity from its actual `data.name` field and retain that identity through result events that omit it.
- Preserve explicit reasoning chunks verbatim, including literal `Thinking` and whitespace, while hiding metadata placeholders.

The new provider-label and reasoning checks drive `ProviderRuntimeIngestion`. The Stop check drives the real ChatView and projection, with a real-engine provider-failure check for command correlation. These regressions failed before their fixes. The integrated focused run passes 194 tests across 21 files.

The extended Chromium proof passes physical Ctrl+Home, overflowing groups, streamed detail growth, disclosure reading position, raw output scrolling, virtual unmount restoration, and live-to-history transfer. Web/server typechecks and builds pass; lint and formatting pass for all 74 changed source, test, and script files. The existing backend was refreshed with no active chat sessions. The rebuilt preview loads the connected workbench without page errors. Results are in `/work/tmp/platform-chat-ux/after-scroll.json` and the `review-fixes-*` artifacts beside it.
