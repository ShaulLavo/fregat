# INTERACTION-04 asynchronous question core delivery

Source pin: `references/t3code` commit `7445aa733ada33e45289e5aa5055f79142556513`.

Delivered on mesh server `20260920T135727Z-b915d3e0-plan126-lifecycle-search`, web `20260920T135934Z-b915d3e0-plan126-row-navigation`.

## Behavior

Completed Codex `agentMessage` items carrying `delivery: async` and questions produce stable `codex-async:<canonical-session>:<item-id>` message-mode requests, including child ownership. Repeated native notifications retain the same identity. These requests neither allocate a JSON-RPC callback nor pause the assistant segment.

Answers validate every question and commit resolution plus an ordinary user message atomically. Running turns receive native steer; idle turns start a new turn. Message-mode dismissal records resolution without a provider reply. Native callback requests remain nondismissible. Web and TUI advertise dismissal only for message-mode questions.

Pending optional requests survive the bounded server activity window and reload. Client detail snapshots carry a separate pending-question collection so retaining an old request does not move the history pagination cursor. Live resolved activities remove retained requests; committed dismissal cannot be answered again.

Rewind admission now blocks a late optional-question response during deferred native rewind. Conditional settlement release is covered by a real serial-reactor barrier: a queued old stop cannot terminate a session whose new turn was committed before the stop executes.

## Evidence

- `/work/tmp/fregat-evidence/20260920T140014Z-scenario-async-questions`: native running answer emits `turn/steer`; idle answer emits `turn/start`; exact question/newline/answer payloads captured. A third question survives reload, is dismissed through UI, and stays absent after another reload. Screenshots inspected.
- `/work/tmp/fregat-evidence/20260920T135957Z-scenario-mcp-approval`: existing MCP flow rerun after shared isolated-fixture extraction; reloaded choices and exact always-persist reply verified. Screenshot inspected.
- Each scenario registered its own native fixture through real provider settings, created its own session, and removed both in `finally`. Captured process records show all fixture processes exited. No external app grants were made.
- Focused checks passed: async adapter parent/child IDs; parser; runtime ingestion; answer/start/steer/dismiss/retention; web derivation and panel; TUI dismissal presentation; rewind admission and queued conditional-release race. Server typecheck and local command census check passed.

The first MCP run exposed disabled-sortable attributes incorrectly making active rows inaccessible. Root fixed and deployed that regression before both successful proofs. Successful scenario log windows contain unrelated Git pull-request lookup warnings and GPU console warnings, not question-provider failures.

## Remaining work

Release `20260920T142351Z-b915d3e0-plan126-ordering-questions` adds guarded web digit shortcuts, independent per-question image drafts/preparation, attachment-only custom answers, and attachment-bearing native and message-mode replies. Failed replies retain drafts. Image metadata is persisted without data URLs; native callback answers append validated quoted paths, and ordinary Codex turns use native `localImage` input for persisted images.

`/work/tmp/fregat-evidence/20260920T142803Z-scenario-async-questions` verifies digit selection and an image-bearing running reply, an idle reply, and dismissal observed by a second browser page before reload. Screenshots were inspected; native replies and complete fixture cleanup are captured in `inspection.json`. The panel suite passes 12 cases, including two pending requests exposing only one shortcut target. Initial repeated fixture IDs exposed a cross-session native message-ID collision; root owns that production correction and regression proof.

The later `20260920T151610Z-b915d3e0-plan126-titles-files` release adds general files and durable upload references, documented in `attachment-upload-delivery.md`. Its completed run at `/work/tmp/fregat-evidence/20260920T152410Z-scenario-async-questions/` records image/file native replies, reload and two-page dismissal. `file-preview-delivery.md` records local component tests for native submitted-answer history. Browser proof of that history remains open. Unsent per-question attachment drafts survive rejected responses but are not restored after reload.
